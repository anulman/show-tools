#!/usr/bin/env python3
"""Fixed caller for signed app-data staging on the assigned Proxmox user."""
import argparse
import base64
from dataclasses import dataclass
from enum import IntEnum
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import stat
import subprocess
import sys
import time

EXECUTION_APPROVED = True
EXECUTOR_SHA256 = '91b2a881420f33183dec48c7499470a84e3641d5091a9e82ea3260f2b6a89b90'
CHECKER = Path('/usr/local/libexec/show-tools-delegation-check.py')
GRANT = Path('/etc/homelab/delegations/show-tools.json')
SIGNERS = Path('/etc/homelab/delegations/show-tools.allowed_signers')
LEDGER = Path('/home/anulman/.local/state/show-tools-mailbox/authorization.jsonl')
ROOT = Path('/home/anulman/.local/share/show-tools')
STAGING = ROOT / 'staging'
TARGET = 'proxmox/anulman/show-tools-web'
CHECKER_SHA256 = 'ff28dab2fc95eb4b4e7937a547529d4edd110874f87fd5e7de19d47f6d654d7d'
GRANT_SHA256 = '74defe726c332337bb773873310c5786217002b9d9d8e517d754344cf8d29943'
SIGNERS_SHA256 = 'd5a1cc72bb6b0631907c7cad1b1285ecb26d4c712fd858bcc2d7588968798de8'
VALIDATOR_SHA256 = '4fd35fce4131918823b5970952e0112702122151244f72c9b5aa6b01e38c2260'
CURRENT_FILES = {
    '/home/anulman/.config/show-tools/session.json': ('2a631abee39896be801dab0d6e7305ca518ca82c47f00a8e0d4f2ef6d9ca5347', 0o600),
    '/home/anulman/.config/systemd/user/show-tools-web.service': ('d056c086cf583045fab8b9d2f324f9778efe7eeaf067b7bc8404e55b4cf897f2', 0o600),
    '/home/anulman/.local/bin/show-tools-session': ('c71067fe1120baaadbe53879470c00f70ae9c92af0b819883125760a7e815401', 0o700),
}
ENV = {'HOME': '/home/anulman', 'USER': 'anulman', 'LOGNAME': 'anulman', 'PATH': '/usr/bin:/bin', 'LANG': 'C',
       'XDG_RUNTIME_DIR': '/run/user/1000', 'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/1000/bus'}
ROW_KEYS = set('at operation requestId payloadSha256 nonce grantSha256 grantVersion action outcome evidenceSha256'.split())


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON field')
            result[key] = value
        return result
    def number(value):
        result = float(value)
        require(math.isfinite(result), 'Nonfinite JSON number')
        return result
    return json.loads(data.decode('utf-8') if isinstance(data, bytes) else data, object_pairs_hook=pairs, parse_float=number,
                      parse_constant=lambda _value: (_ for _ in ()).throw(RuntimeError('Nonfinite JSON')))


def metadata(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def open_parent(path, owner):
    require(path.parent.is_absolute() and path.parent.resolve(strict=True) == path.parent, 'Need canonical parent')
    descriptors = [os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)]
    try:
        for name in path.parent.parts[1:]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=descriptors[-1])
            descriptors.append(child)
            info = os.fstat(child)
            sticky = owner[0] != 0 and info.st_uid == 0 and info.st_mode & stat.S_ISVTX
            require(info.st_uid in (0, owner[0]) and (not info.st_mode & 0o022 or sticky), 'Unqualified file ancestry')
        return descriptors
    except BaseException:
        for fd in reversed(descriptors):
            os.close(fd)
        raise


def capture(path, limit, owner, modes):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Need canonical absolute file')
    descriptors = open_parent(path, owner)
    try:
        parent = descriptors[-1]
        fd = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        descriptors.append(fd)
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and (before.st_uid, before.st_gid) == owner
                and stat.S_IMODE(before.st_mode) in modes and 0 <= before.st_size <= limit, 'Unexpected file metadata')
        data = bytearray()
        while len(data) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        require(len(data) == before.st_size and metadata(before) == metadata(os.fstat(fd))
                == metadata(os.stat(path.name, dir_fd=parent, follow_symlinks=False)), 'File changed during capture')
        return bytes(data), metadata(before)
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


@dataclass(frozen=True)
class CapturedRequest:
    envelope: bytes
    payload: bytes
    pins: dict
    plan: dict

    @classmethod
    def decode(cls, envelope, plan_bytes):
        require(0 < len(envelope) <= 16000 and 0 < len(plan_bytes) <= 65536, 'Request or plan exceeds bound')
        outer = strict_json(envelope)
        require(type(outer) is dict and set(outer) == {'kind', 'payloadBase64', 'signature'}
                and outer['kind'] == 'show-tools-signed-action-v1' and type(outer['payloadBase64']) is str
                and type(outer['signature']) is str, 'Wrong signed envelope')
        payload = base64.b64decode(outer['payloadBase64'], validate=True)
        require(0 < len(payload) <= 8192 and base64.b64encode(payload).decode() == outer['payloadBase64'], 'Invalid payload encoding')
        pins, plan = strict_json(payload), strict_json(plan_bytes)
        require(type(pins) is dict and type(plan) is dict and pins.get('action') == plan.get('action') == 'stage'
                and pins.get('targetId') == plan.get('targetId') == TARGET, 'Wrong stage target')
        require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', pins.get('requestId', ''))
                and re.fullmatch(r'[a-f0-9]{32}', pins.get('nonce', '')), 'Invalid request identity')
        require(pins.get('planSha256') == sha(plan_bytes) and pins.get('archive') == plan.get('archive')
                and pins.get('sourceRevision') == plan.get('sourceRevision'), 'Plan pins differ')
        require(pins.get('grantSha256') == GRANT_SHA256 and plan.get('protected') == {
            'checkerSha256': CHECKER_SHA256, 'grantSha256': GRANT_SHA256, 'signersSha256': SIGNERS_SHA256}, 'Protected pins differ')
        require(plan.get('currentFiles') == {path: value[0] for path, value in CURRENT_FILES.items()}, 'Managed file pins differ')
        require(plan.get('stagingHelperSha256') == VALIDATOR_SHA256, 'Validator pin differs')
        require(pins.get('profileSha256') == CURRENT_FILES['/home/anulman/.config/show-tools/session.json'][0]
                and pins.get('unitSha256') == CURRENT_FILES['/home/anulman/.config/systemd/user/show-tools-web.service'][0]
                and pins.get('cliSha256') == CURRENT_FILES['/home/anulman/.local/bin/show-tools-session'][0], 'Signed managed file pins differ')
        require(type(pins.get('evidence')) is list and len(pins['evidence']) <= 8
                and [item for item in pins['evidence'] if type(item) is dict and item.get('kind') == 'artifact-manifest']
                == [{'kind': 'artifact-manifest', 'sha256': plan.get('artifactManifestSha256')}], 'Signed manifest evidence differs')
        return cls(envelope, payload, pins, plan)


def bounded_process(argv, data=b'', seconds=10, cap=65536):
    child = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                             env=ENV, start_new_session=True)
    selector = selectors.DefaultSelector()
    streams = [bytearray(), bytearray()]
    pending = memoryview(data)
    started = time.monotonic()
    try:
        for index, stream in enumerate((child.stdout, child.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, index)
        os.set_blocking(child.stdin.fileno(), False)
        if pending:
            selector.register(child.stdin, selectors.EVENT_WRITE, 2)
        else:
            child.stdin.close()
        while selector.get_map():
            remaining = seconds - (time.monotonic() - started)
            require(remaining > 0, 'Fixed command deadline exceeded')
            for key, _events in selector.select(min(.05, remaining)):
                if key.data == 2:
                    count = os.write(key.fileobj.fileno(), pending)
                    pending = pending[count:]
                    if not pending:
                        selector.unregister(key.fileobj)
                        child.stdin.close()
                else:
                    chunk = os.read(key.fileobj.fileno(), min(65536, cap + 1 - len(streams[key.data])))
                    if not chunk:
                        selector.unregister(key.fileobj)
                    else:
                        streams[key.data].extend(chunk)
                        require(len(streams[key.data]) <= cap, 'Fixed command output cap exceeded')
        exit_code = child.wait(timeout=max(.001, seconds - (time.monotonic() - started)))
        require(exit_code == 0, 'Fixed command failed')
        return bytes(streams[0])
    finally:
        selector.close()
        if child.returncode is None:
            child.terminate()
            try:
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=2)
        for stream in (child.stdin, child.stdout, child.stderr):
            stream.close()


class FixedChecker:
    def __init__(self, request):
        self.request = request

    def call(self, operation, outcome=None, digest=None):
        argv = ['/usr/bin/python3', '-I', str(CHECKER), operation, self.request.pins['requestId']]
        if operation == 'record':
            require(outcome in ('running', 'completed', 'uncertain') and re.fullmatch(r'[a-f0-9]{64}', digest or ''), 'Invalid outcome')
            argv += [outcome, digest]
        else:
            require(operation in ('inspect', 'claim'), 'Invalid fixed checker operation')
        report = strict_json(bounded_process(argv, self.request.envelope if operation != 'record' else b'', seconds=5))
        require(type(report) is dict and report.get('executable') is False, 'Unexpected checker report')
        if operation != 'record':
            require(set(report) == {'kind', 'executable', 'hostPreconditions', 'sshSourceProvenance',
                                   'checkerSha256', 'payloadSha256', 'pins', 'receipt'}, 'Unexpected inspection fields')
            require(report.get('kind') == 'authenticated-candidate' and report.get('checkerSha256') == CHECKER_SHA256
                    and report.get('payloadSha256') == sha(self.request.payload) and report.get('pins') == self.request.pins
                    and report.get('hostPreconditions') == 'unverified' and report.get('sshSourceProvenance') == 'not-attested', 'Checker pins differ')
        else:
            require(set(report) == {'kind', 'executable', 'receipt'} and report.get('kind') == 'recorded-local-outcome', 'Wrong outcome report')
        row = report.get('receipt')
        require(type(row) is dict and set(row) == ROW_KEYS and row['requestId'] == self.request.pins['requestId']
                and row['payloadSha256'] == sha(self.request.payload) and row['nonce'] == self.request.pins['nonce']
                and row['grantSha256'] == self.request.pins['grantSha256'] and row['grantVersion'] == self.request.pins['grantVersion']
                and row['action'] == 'stage' and row['operation'] == operation
                and type(row['at']) is int and 0 <= time.time() - row['at'] <= 5
                and row['outcome'] == {'inspect': 'inspected', 'claim': 'claimed', 'record': outcome}[operation]
                and row['evidenceSha256'] == digest, 'Checker receipt differs')
        return report

    def request_rows(self):
        data, info = capture(LEDGER, 8388608, (1000, 1000), (0o600,))
        require(data.endswith(b'\n') and len(data.splitlines()) <= 20000
                and all(len(line) <= 4096 for line in data.splitlines()), 'Incomplete or oversized ledger')
        rows = [strict_json(line) for line in data.splitlines()]
        genesis = rows[0]
        require(genesis.get('kind') == 'show-tools-authorization-genesis' and genesis.get('device') == info[0]
                and genesis.get('inode') == info[1], 'Ledger identity differs')
        return tuple(row for row in rows[1:] if row.get('requestId') == self.request.pins['requestId'])


class HostPreflight:
    def __init__(self, archive_observation):
        self.archive_observation = archive_observation

    def snapshot(self):
        result = {}
        archive_path, archive_metadata = self.archive_observation
        require(metadata(archive_path.lstat()) == archive_metadata, 'Reviewed archive snapshot changed')
        result['archiveMetadata'] = archive_metadata
        for path, digest in ((CHECKER, CHECKER_SHA256), (GRANT, GRANT_SHA256), (SIGNERS, SIGNERS_SHA256)):
            data, info = capture(path, 65536, (0, 0), (0o644,))
            require(sha(data) == digest, 'Protected file pin changed')
            result[str(path)] = info
        for path, (digest, mode) in CURRENT_FILES.items():
            data, info = capture(Path(path), 1048576, (1000, 1000), (mode,))
            require(sha(data) == digest, 'Managed file pin changed')
            result[path] = info
        output = bounded_process(['/usr/bin/systemctl', '--user', 'show', 'show-tools-web.service',
                                  '--property=LoadState,ActiveState,SubState,MainPID,ControlGroup,FragmentPath,Restart,DropInPaths'])
        values = dict(line.split('=', 1) for line in output.decode().splitlines())
        require(values.get('LoadState') == 'loaded' and values.get('ActiveState') == 'active'
                and values.get('SubState') == 'running' and values.get('Restart') == 'no'
                and values.get('DropInPaths') == '' and values.get('FragmentPath') == '/home/anulman/.config/systemd/user/show-tools-web.service'
                and re.fullmatch(r'[1-9][0-9]*', values.get('MainPID', '')), 'Named web service differs')
        pid = values['MainPID']
        executable = os.readlink('/proc/' + pid + '/exe')
        require(executable == str(ROOT / 'releases/session-d8fa3cf/runtime/node'), 'Named server executable differs')
        result['service'] = values
        result['serverExecutable'] = executable
        result['serverStartTicks'] = Path('/proc/' + pid + '/stat').read_text().rsplit(') ', 1)[1].split()[19]
        arguments = Path('/proc/' + pid + '/cmdline').read_bytes()
        expected = [str(ROOT / 'releases/session-d8fa3cf/runtime/node'),
                    str(ROOT / 'releases/session-d8fa3cf/gateway/server.mjs'),
                    '--profile', '/home/anulman/.config/show-tools/session.json']
        require(arguments == b'\0'.join(value.encode() for value in expected) + b'\0', 'Named server arguments differ')
        result['serverArgvSha256'] = sha(arguments)
        return result


class Evidence:
    def __init__(self, directory):
        self.path = Path(directory)
        self.fd = None
        descriptors = open_parent(self.path, (os.getuid(), os.getgid()))
        try:
            parent = descriptors[-1]
            info = os.fstat(parent)
            require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (os.getuid(), os.getgid(), 0o700), 'Evidence parent must be private caller-owned')
            os.mkdir(self.path.name, 0o700, dir_fd=parent)
            os.fsync(parent)
            self.fd = os.open(self.path.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            info = os.fstat(self.fd)
            require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (os.getuid(), os.getgid(), 0o700), 'Evidence must be private caller-owned')
            require(metadata(info) == metadata(os.stat(self.path.name, dir_fd=parent, follow_symlinks=False)), 'Evidence pathname changed')
            os.fsync(self.fd)
        except BaseException:
            if self.fd is not None:
                os.close(self.fd)
            raise
        finally:
            for fd in reversed(descriptors):
                os.close(fd)

    def put(self, name, value):
        require(re.fullmatch(r'[a-z-]+\.json', name), 'Invalid evidence name')
        data = (json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False) + '\n').encode()
        require(len(data) <= 1048576, 'Evidence exceeds bound')
        before = os.fstat(self.fd)
        linked = self.path.lstat()
        require((before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid)
                == (linked.st_dev, linked.st_ino, linked.st_mode, linked.st_uid, linked.st_gid), 'Evidence directory changed')
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=self.fd)
        try:
            remaining = memoryview(data)
            while remaining:
                count = os.write(fd, remaining)
                require(count > 0, 'Evidence write made no progress')
                remaining = remaining[count:]
            os.fsync(fd)
        finally:
            os.close(fd)
        os.fsync(self.fd)
        readback, _info = capture(self.path / name, 1048576, (os.getuid(), os.getgid()), (0o600,))
        require(readback == data, 'Evidence readback differs')
        return sha(data)

    def close(self):
        os.close(self.fd)


class Phase(IntEnum):
    CAPTURED = 0
    INSPECTED = 1
    CLAIM_ATTEMPTED = 2
    CLAIMED = 3
    RUNNING = 4
    STAGING = 5
    COMPLETED = 6


def unclaimed_request(request, rows, inspection):
    require(type(rows) is tuple and 0 < len(rows) <= 64 and rows[-1] == inspection['receipt'],
            'Preclaim ledger observation differs from inspection')
    expected = {'requestId': request.pins['requestId'], 'payloadSha256': sha(request.payload),
                'nonce': request.pins['nonce'], 'grantSha256': request.pins['grantSha256'],
                'grantVersion': request.pins['grantVersion'], 'action': 'stage'}
    for row in rows:
        require(type(row) is dict and set(row) == ROW_KEYS and row.get('operation') == 'inspect'
                and row.get('outcome') == 'inspected' and row.get('evidenceSha256') is None
                and all(row.get(key) == value for key, value in expected.items()),
                'Request already claimed, recorded, denied or bound to different pins; reconcile without retry')


def reconcile_unverified_claim(checker, baseline):
    rows = checker.request_rows()
    require(type(rows) is tuple and len(rows) <= 64 and all(type(row) is dict for row in rows),
            'Claim reconciliation is unavailable')
    new_claims = tuple(row for row in rows if row.get('operation') == 'claim' and row not in baseline)
    return {'status': 'new-claim-observed-owner-unconfirmed' if new_claims else 'no-new-claim-observed',
            'preclaimRows': baseline, 'currentRows': rows,
            'auditOwnershipEstablished': False, 'terminalRecordAttempted': False}


def stage(request, archive, validator, executor, checker, preflight, evidence):
    phase = Phase.CAPTURED
    observations = []
    owned_claim = None
    preclaim_rows = ()
    try:
        baseline = preflight.snapshot()
        observations.append(checker.call('inspect'))
        phase = Phase.INSPECTED
        preclaim_rows = checker.request_rows()
        unclaimed_request(request, preclaim_rows, observations[0])
        preflight_hash = evidence.put('preflight.json', {'snapshot': baseline, 'payloadSha256': sha(request.payload), 'planSha256': request.pins['planSha256']})
        require(preflight.snapshot() == baseline, 'Preclaim target snapshot changed')
        preclaim_rows = checker.request_rows()
        unclaimed_request(request, preclaim_rows, observations[0])
        phase = Phase.CLAIM_ATTEMPTED
        owned_claim = checker.call('claim')
        observations.append(owned_claim)
        phase = Phase.CLAIMED
        observations.append(checker.call('record', 'running', preflight_hash))
        phase = Phase.RUNNING
        observations.append(checker.call('inspect'))
        require(preflight.snapshot() == baseline, 'Pre-execution target snapshot changed')
        admission = executor['ExpectedAdmission'](request.payload, preflight_hash)

        def before_publication(expected):
            require(expected == admission and preflight.snapshot() == baseline, 'Publication target snapshot changed')
            report = checker.call('inspect')
            rows = checker.request_rows()
            require(sum(row.get('operation') == 'claim' for row in rows) == 1
                    and observations[1]['receipt'] in rows and observations[2]['receipt'] in rows
                    and rows[-1] == report['receipt'], 'Observed claim, running or fresh inspection differs')
            observations.append(report)
            return executor['AdmissionObservation'](report, rows, time.monotonic_ns())

        pins = executor['ReleasePins'](request.pins['sourceRevision'], request.pins['archive']['sha256'],
                                       request.pins['archive']['bytes'], request.plan['artifactManifestSha256'])
        phase = Phase.STAGING
        result = executor['stage_local_archive'](archive, pins, validator, ROOT,
                                                  prepublish_guard=before_publication, admission=admission)
        require(result.get('status') in ('staged-only', 'already-staged') and result.get('executablesStarted') is False
                and result.get('source') == pins.source and result.get('archiveSha256') == pins.archive_sha256
                and result.get('manifestSha256') == pins.manifest_sha256 and result.get('prepublishGuardObserved') is True
                and result.get('requestId') == request.pins['requestId'] and result.get('payloadSha256') == sha(request.payload), 'Executor result differs')
        require(preflight.snapshot() == baseline, 'Postpublication target snapshot changed')
        verify = executor['verify_local_release'](archive, pins, validator, ROOT / 'releases' / ('session-' + pins.source[:7]))
        accounting = request.plan['expectedAccounting']
        require(verify.get('status') == 'verified-read-only' and verify.get('source') == pins.source
                and verify.get('archiveSha256') == pins.archive_sha256 and verify.get('manifestSha256') == pins.manifest_sha256
                and verify.get('validatorSha256') == VALIDATOR_SHA256
                and verify.get('files') == accounting['files'] and verify.get('manifestRecords') == accounting['manifestRecords']
                and verify.get('rawHeaders') == accounting['rawHeaders'] and verify.get('expandedBytes') == accounting['expandedBytes'],
                'Independent published readback differs')
        result_hash = evidence.put('result.json', {'outcome': 'completed', 'executor': result, 'readback': verify,
                                                  'payloadSha256': sha(request.payload), 'checkerReceipts': observations})
        receipt = checker.call('record', 'completed', result_hash)
        terminal_rows = checker.request_rows()
        require(terminal_rows[-1] == receipt['receipt'] and observations[1]['receipt'] in terminal_rows
                and observations[2]['receipt'] in terminal_rows
                and sum(row.get('outcome') == 'completed' for row in terminal_rows) == 1,
                'Completed audit reconciliation differs')
        evidence.put('completed-receipt.json', receipt)
        phase = Phase.COMPLETED
        return {'outcome': 'completed', 'resultSha256': result_hash, 'receipt': receipt}
    except Exception as failure:
        result = {'outcome': 'uncertain' if phase >= Phase.CLAIM_ATTEMPTED else 'blocked-preclaim',
                  'phase': phase.name, 'error': str(failure)[:1000], 'payloadSha256': sha(request.payload),
                  'claimVerifiedByThisInvocation': owned_claim is not None}
        if phase == Phase.CLAIM_ATTEMPTED and owned_claim is None:
            try:
                result['claimReconciliation'] = reconcile_unverified_claim(checker, preclaim_rows)
            except Exception as reconciliation_failure:
                result['claimReconciliationError'] = str(reconciliation_failure)[:1000]
        try:
            digest = evidence.put('failure.json', result)
            if owned_claim is not None and phase != Phase.COMPLETED:
                try:
                    result['receipt'] = checker.call('record', 'uncertain', digest)
                except Exception as audit_failure:
                    result['auditError'] = str(audit_failure)[:1000]
            result['evidenceSha256'] = digest
        except Exception as evidence_failure:
            result['evidenceError'] = str(evidence_failure)[:1000]
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('envelope', 'plan', 'archive', 'executor', 'validator'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    require(EXECUTION_APPROVED and EXECUTOR_SHA256 is not None, 'Admission runner remains source-only pending review')
    require(sys.flags.isolated == 1 and sys.platform == 'linux' and socket.gethostname().split('.')[0] == 'proxmox'
            and (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000), 'Need assigned Linux host user')
    def interrupted(_signal, _frame):
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(number, signal.SIG_IGN)
        raise RuntimeError('Stage admission interrupted; claimed outcome may be uncertain')
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, interrupted)
    require(all(STAGING in path.parents for path in vars(args).values()), 'All runner inputs must be in app-private staging')
    envelope, _info = capture(args.envelope, 16000, (1000, 1000), (0o600,))
    plan_bytes, _info = capture(args.plan, 65536, (1000, 1000), (0o600,))
    request = CapturedRequest.decode(envelope, plan_bytes)
    source, _info = capture(args.executor, 131072, (1000, 1000), (0o600,))
    require(sha(source) == EXECUTOR_SHA256 == request.plan['executor']['sourceSha256'], 'Executor source pin differs')
    require(args.executor.name == 'stage-session-release-anchored.py' and args.validator.name == 'stage-session-release.py', 'Fixed code names required')
    validation, _info = capture(args.validator, 65536, (1000, 1000), (0o600,))
    require(sha(validation) == VALIDATOR_SHA256, 'Validator source pin differs')
    executor = {'__name__': 'captured_anchored_stage', '__file__': str(args.executor)}
    exec(compile(source, str(args.executor), 'exec'), executor)
    pins = executor['ReleasePins'](request.pins['sourceRevision'], request.pins['archive']['sha256'],
                                   request.pins['archive']['bytes'], request.plan['artifactManifestSha256'])
    files, _directories, headers, expanded = executor['archive_image'](args.archive, pins, (1000, 1000), executor['Budget']())
    accounting = request.plan['expectedAccounting']
    require(len(files) == accounting['files'] and headers == accounting['rawHeaders']
            and expanded == accounting['expandedBytes'], 'Reviewed archive accounting differs')
    archive_observation = args.archive, metadata(args.archive.lstat())
    evidence = Evidence(STAGING / (request.pins['requestId'] + '-admission'))
    try:
        result = stage(request, args.archive, args.validator, executor, FixedChecker(request), HostPreflight(archive_observation), evidence)
        print(json.dumps(result, separators=(',', ':')), flush=True)
        return 0 if result['outcome'] == 'completed' else 1
    finally:
        evidence.close()


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as failure:
        print(json.dumps({'outcome': 'held', 'error': str(failure)[:1000]}), flush=True)
        sys.exit(1)
