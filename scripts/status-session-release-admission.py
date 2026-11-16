#!/usr/bin/env python3
"""Read the assigned desk status after one signed, owned status admission."""
import argparse
import base64
from dataclasses import dataclass
import hashlib
import http.client
import io
import json
import math
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import stat
import sys
import time

COMMON_SHA256 = '00bc755fe6078647c7742853cd023e22830d862d007cf9c2140a2b7898e7a433'
EXECUTOR_SHA256 = '36e912b063edb945a2e818cc197e7407856fb48a34071dddc695350e55a5271b'
LEGACY_SHA256 = 'eef5759425f47f0128ded96918603ab9b0fd06c9e695b42e7ae26dfcb02a1d7c'
SOURCE_REVISION = 'd8fa3cf199496d0f4897357f8e9cfad9f1415e9c'
ARCHIVE_SHA256 = '862eae9023b21de1885b9f1362f485b9a413c944c6919896d22077fc6766c79c'
ARCHIVE_BYTES = 51962575
MANIFEST_SHA256 = '67227171f1f1fc6ed635561cfd9768c99385e8ec94803cd0290a4cef7a9ef9bd'
ROOT = Path('/home/anulman/.local/share/show-tools')
STAGING = ROOT / 'staging'
RELEASE = ROOT / 'releases/session-d8fa3cf'
ARCHIVE = STAGING / 'deploy-d8fa3cf-stage-001-attempt-dbeca21e5752/show-tools-session-release-d8fa3cf.tar.gz'
PROFILE = Path('/home/anulman/.config/show-tools/session.json')
CREDENTIALS = Path('/home/anulman/.config/show-tools/credentials')
HOST = 'proxmox.tail54fc55.ts.net'
ADDRESS = '100.93.139.99'
PORT = 8443
ORIGIN = 'https://' + HOST + ':' + str(PORT)
MAX_RESPONSE = 8 * 1024 * 1024
MAX_WIRE = MAX_RESPONSE + 65536
HTTP_SECONDS = 10
PROFILE_SHA256 = '2a631abee39896be801dab0d6e7305ca518ca82c47f00a8e0d4f2ef6d9ca5347'


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def captured_module(path, digest):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Code path must be canonical')
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 131072
                and (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)) == (os.getuid(), os.getgid(), 0o600),
                'Code must be bounded private caller-owned data')
        data = bytearray()
        while len(data) <= 131072:
            chunk = os.read(fd, min(65536, 131073 - len(data)))
            if not chunk:
                break
            data.extend(chunk)
        signature = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid,
                                    value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        require(len(data) == before.st_size and hashlib.sha256(data).hexdigest() == digest
                and signature(before) == signature(os.fstat(fd)) == signature(path.lstat()), 'Captured code pin differs')
    finally:
        os.close(fd)
    namespace = {'__name__': 'captured_status_dependency', '__file__': str(path)}
    exec(compile(data, str(path), 'exec'), namespace)
    return namespace


@dataclass(frozen=True)
class StatusRequest:
    envelope: bytes
    payload: bytes
    pins: dict
    plan: dict

    @classmethod
    def decode(cls, envelope, plan_bytes, common):
        require(0 < len(envelope) <= 16000 and 0 < len(plan_bytes) <= 65536, 'Status request exceeds bound')
        outer = common['strict_json'](envelope)
        require(type(outer) is dict and set(outer) == {'kind', 'payloadBase64', 'signature'}
                and outer['kind'] == 'show-tools-signed-action-v1' and type(outer['payloadBase64']) is str,
                'Wrong status envelope')
        payload = base64.b64decode(outer['payloadBase64'], validate=True)
        require(0 < len(payload) <= 8192 and base64.b64encode(payload).decode() == outer['payloadBase64'], 'Invalid status payload encoding')
        pins, plan = common['strict_json'](payload), common['strict_json'](plan_bytes)
        require(type(pins) is dict and type(plan) is dict and pins.get('action') == plan.get('action') == 'status'
                and pins.get('targetId') == plan.get('targetId') == common['TARGET'], 'Expected fixed status target')
        require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', pins.get('requestId', ''))
                and re.fullmatch(r'[a-f0-9]{32}', pins.get('nonce', '')), 'Invalid status request identity')
        archive = {'url': 'http://100.91.87.3:18742/show-tools-session-release-d8fa3cf.tar.gz',
                   'bytes': ARCHIVE_BYTES, 'sha256': ARCHIVE_SHA256, 'root': 'show-tools-session-release-d8fa3cf',
                   'installRelease': str(RELEASE)}
        require(pins.get('sourceRevision') == plan.get('sourceRevision') == SOURCE_REVISION
                and pins.get('archive') == plan.get('archive') == archive
                and plan.get('artifactManifestSha256') == MANIFEST_SHA256
                and pins.get('planSha256') == common['sha'](plan_bytes), 'Status source, archive or plan pin differs')
        require(plan.get('sourcePins') == {'common': COMMON_SHA256, 'executor': EXECUTOR_SHA256, 'legacyValidator': LEGACY_SHA256},
                'Status dependency pins differ')
        require(pins.get('grantSha256') == common['GRANT_SHA256'] and plan.get('protected') == {
            'checkerSha256': common['CHECKER_SHA256'], 'grantSha256': common['GRANT_SHA256'], 'signersSha256': common['SIGNERS_SHA256']},
            'Protected status pins differ')
        current = {path: value[0] for path, value in common['CURRENT_FILES'].items()}
        require(plan.get('currentFiles') == current and pins.get('profileSha256') == current[str(PROFILE)]
                and pins.get('unitSha256') == current['/home/anulman/.config/systemd/user/show-tools-web.service']
                and pins.get('cliSha256') == current['/home/anulman/.local/bin/show-tools-session'], 'Current file pins differ')
        require(type(pins.get('evidence')) is list and [item for item in pins['evidence'] if type(item) is dict
                and item.get('kind') == 'artifact-manifest'] == [{'kind': 'artifact-manifest', 'sha256': MANIFEST_SHA256}],
                'Signed installed manifest evidence differs')
        return cls(envelope, payload, pins, plan)


class RequestChecker:
    """Fixed checker protocol. Each caller's request decoder fixes its action."""
    def __init__(self, request, common):
        self.request, self.common = request, common

    def call(self, operation, outcome=None, digest=None):
        c, p = self.common, self.request.pins
        argv = ['/usr/bin/python3', '-I', str(c['CHECKER']), operation, p['requestId']]
        if operation == 'record':
            require(outcome in ('running', 'completed', 'uncertain') and re.fullmatch(r'[a-f0-9]{64}', digest or ''), 'Invalid status outcome')
            argv += [outcome, digest]
        else:
            require(operation in ('inspect', 'claim'), 'Invalid fixed checker operation')
        report = c['strict_json'](c['bounded_process'](argv, self.request.envelope if operation != 'record' else b'', seconds=5))
        require(type(report) is dict and report.get('executable') is False, 'Unexpected checker report')
        if operation == 'record':
            require(set(report) == {'kind', 'executable', 'receipt'} and report.get('kind') == 'recorded-local-outcome', 'Wrong outcome report')
        else:
            require(set(report) == {'kind', 'executable', 'hostPreconditions', 'sshSourceProvenance', 'checkerSha256', 'payloadSha256', 'pins', 'receipt'}
                    and report['kind'] == 'authenticated-candidate' and report['checkerSha256'] == c['CHECKER_SHA256']
                    and report['payloadSha256'] == c['sha'](self.request.payload) and report['pins'] == p
                    and report['hostPreconditions'] == 'unverified' and report['sshSourceProvenance'] == 'not-attested', 'Checker inspection differs')
        row = report.get('receipt')
        require(type(row) is dict and set(row) == c['ROW_KEYS'] and row['requestId'] == p['requestId']
                and row['payloadSha256'] == c['sha'](self.request.payload) and row['nonce'] == p['nonce']
                and row['grantSha256'] == p['grantSha256'] and row['grantVersion'] == p['grantVersion']
                and row['action'] == p['action'] and row['operation'] == operation
                and row['outcome'] == {'inspect': 'inspected', 'claim': 'claimed', 'record': outcome}[operation]
                and row['evidenceSha256'] == digest and type(row['at']) is int and 0 <= time.time() - row['at'] <= 5,
                'Checker receipt differs')
        return report

    def request_rows(self):
        return self.common['FixedChecker'](self.request).request_rows()


def unclaimed_request(request, rows, inspection, common):
    require(type(rows) is tuple and 0 < len(rows) <= 64 and rows[-1] == inspection['receipt'], 'Preclaim status ledger differs')
    expected = {'requestId': request.pins['requestId'], 'payloadSha256': common['sha'](request.payload),
                'nonce': request.pins['nonce'], 'grantSha256': request.pins['grantSha256'],
                'grantVersion': request.pins['grantVersion'], 'action': request.pins['action']}
    for row in rows:
        require(type(row) is dict and set(row) == common['ROW_KEYS'] and row.get('operation') == 'inspect'
                and row.get('outcome') == 'inspected' and row.get('evidenceSha256') is None
                and all(row.get(key) == value for key, value in expected.items()), 'Request already claimed, denied or recorded; reconcile without retry')


def active_request(request, rows, inspected, owned_claim, running, common):
    require(type(rows) is tuple and 3 <= len(rows) <= 64 and rows[-1] == inspected['receipt'], 'Owned request inspection is not current')
    expected = {'requestId': request.pins['requestId'], 'payloadSha256': common['sha'](request.payload),
                'nonce': request.pins['nonce'], 'grantSha256': request.pins['grantSha256'],
                'grantVersion': request.pins['grantVersion'], 'action': request.pins['action']}
    claims, starts = [], []
    for index, row in enumerate(rows):
        require(type(row) is dict and set(row) == common['ROW_KEYS'] and type(row['at']) is int
                and all(row.get(key) == value for key, value in expected.items()), 'Owned request ledger binding differs')
        operation = row['operation'], row['outcome']
        if operation == ('claim', 'claimed'):
            require(row == owned_claim['receipt'], 'Claim belongs to another invocation')
            claims.append(index)
        elif operation == ('record', 'running'):
            require(row == running['receipt'], 'Running evidence differs')
            starts.append(index)
        else:
            require(operation == ('inspect', 'inspected') and row['evidenceSha256'] is None,
                    'Owned request is terminal, denied or in an unexpected state')
    require(len(claims) == len(starts) == 1 and claims[0] < starts[0] < len(rows) - 1,
            'One owned claim then running then fresh inspection is required')


def verify_current(common, executor, legacy_validator):
    data, _info = common['capture'](legacy_validator, 65536, (os.getuid(), os.getgid()), (0o600,))
    require(common['sha'](data) == LEGACY_SHA256, 'Installed release needs the exact legacy validator')
    pins = executor['ReleasePins'](SOURCE_REVISION, ARCHIVE_SHA256, ARCHIVE_BYTES, MANIFEST_SHA256)
    report = executor['verify_local_release'](ARCHIVE, pins, legacy_validator, RELEASE)
    expected = {'status': 'verified-read-only', 'source': SOURCE_REVISION, 'archiveSha256': ARCHIVE_SHA256,
                'manifestSha256': MANIFEST_SHA256, 'validatorSha256': LEGACY_SHA256,
                'files': 571, 'manifestRecords': 569, 'rawHeaders': 1388, 'expandedBytes': 164923904}
    require(all(report.get(key) == value for key, value in expected.items()), 'Installed release verification differs')
    return report


def kernel_read(path, maximum):
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        data = bytearray()
        while len(data) <= maximum:
            block = os.read(fd, min(4096, maximum + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        require(len(data) <= maximum, 'Scoped kernel metadata exceeds bound')
        return bytes(data)
    finally:
        os.close(fd)


def observe_service(common, *, expected_server_dir=RELEASE):
    expected_server_dir = Path(expected_server_dir)
    require(expected_server_dir.parent == ROOT / 'releases' and re.fullmatch(r'session-[a-f0-9]{7,40}', expected_server_dir.name), 'Unexpected server release')
    output = common['bounded_process'](['/usr/bin/systemctl', '--user', 'show', 'show-tools-web.service',
        '--property=LoadState,ActiveState,SubState,MainPID,ControlGroup,FragmentPath,Restart,DropInPaths'])
    values = dict(line.split('=', 1) for line in output.decode().splitlines())
    require(values.get('LoadState') == 'loaded' and values.get('ActiveState') == 'active' and values.get('SubState') == 'running'
            and values.get('Restart') == 'no' and values.get('DropInPaths') == ''
            and values.get('FragmentPath') == '/home/anulman/.config/systemd/user/show-tools-web.service'
            and re.fullmatch(r'[1-9][0-9]*', values.get('MainPID', '')), 'Named web service is not the expected running service')
    group = values['ControlGroup']
    require(group.startswith('/user.slice/user-1000.slice/user@1000.service/') and group.endswith('/show-tools-web.service')
            and all(part not in ('', '.', '..') for part in group.split('/')[1:]), 'Unexpected named cgroup path')
    scope = Path('/sys/fs/cgroup' + group)
    pending, members, directories = [scope], set(), 0
    while pending:
        directory = pending.pop(); directories += 1
        require(directories <= 64, 'Named cgroup directory bound exceeded')
        require(directory.is_dir() and not directory.is_symlink(), 'Named cgroup directory changed')
        members.update(kernel_read(directory / 'cgroup.procs', 8192).decode().split())
        require(len(members) <= 256 and all(re.fullmatch(r'[1-9][0-9]{0,9}', pid) for pid in members), 'Named cgroup process bound exceeded')
        with os.scandir(directory) as entries:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
    require(values['MainPID'] in members, 'Main server is not in its named cgroup')
    facts = []
    for pid in sorted(members, key=int):
        root = Path('/proc') / pid
        process = kernel_read(root / 'stat', 8192).decode().rsplit(') ', 1)[1].split()
        status = kernel_read(root / 'status', 16384).decode()
        uid_line = next(line for line in status.splitlines() if line.startswith('Uid:'))
        uids = tuple(int(item) for item in uid_line.split()[1:])
        require(uids[:2] == (1000, 1000), 'Named cgroup process owner differs')
        membership = kernel_read(root / 'cgroup', 8192).decode()
        require(any(line.endswith(':' + group) or line.split(':')[-1].startswith(group + '/') for line in membership.splitlines()), 'Process left the named cgroup')
        fact = {'pid': int(pid), 'startTicks': process[19], 'executable': os.readlink(root / 'exe'), 'uid': uids[0], 'effectiveUid': uids[1]}
        if pid == values['MainPID']:
            expected = [str(expected_server_dir / 'runtime/node'), str(expected_server_dir / 'gateway/server.mjs'), '--profile', str(PROFILE)]
            require(fact['executable'] == expected[0] and kernel_read(root / 'cmdline', 16384) == b'\0'.join(value.encode() for value in expected) + b'\0', 'Main server executable or arguments differ')
            fact['argv'] = expected
        facts.append(fact)
    return {'unit': values, 'members': facts, 'main': next(item for item in facts if item['pid'] == int(values['MainPID'])), 'scope': 'named-web-cgroup-only'}


def profile_bytes(common, expected_sha256=PROFILE_SHA256):
    data, _info = common['capture'](PROFILE, 65536, (os.getuid(), os.getgid()), (0o600,))
    require(common['sha'](data) == expected_sha256, 'Configured profile pin differs')
    return data


class DeadlineReader(io.RawIOBase):
    def __init__(self, raw, sock, deadline):
        self.raw, self.sock, self.deadline, self.bytes = raw, sock, deadline, 0

    def readable(self):
        return True

    def readinto(self, buffer):
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, 'Status HTTP deadline exceeded')
        self.sock.settimeout(min(3, remaining))
        count = self.raw.readinto(memoryview(buffer)[:min(len(buffer), MAX_WIRE + 1 - self.bytes)])
        require(type(count) is int, 'Status socket read is unavailable')
        self.bytes += count
        require(self.bytes <= MAX_WIRE and time.monotonic() <= self.deadline, 'Status HTTP wire or time bound exceeded')
        return count

    def close(self):
        try:
            self.raw.close()
        finally:
            super().close()


class DeadlineSocket:
    def __init__(self, sock, deadline):
        self.sock, self.deadline = sock, deadline

    def makefile(self, mode):
        require(mode == 'rb', 'Only a read-only HTTP stream is permitted')
        return io.BufferedReader(DeadlineReader(self.sock.makefile('rb', buffering=0), self.sock, self.deadline))

    def sendall(self, data):
        remaining = self.deadline - time.monotonic()
        require(remaining > 0, 'Status HTTP deadline exceeded')
        self.sock.settimeout(min(3, remaining)); self.sock.sendall(data)

    def close(self):
        self.sock.close()


def public_view(value, token):
    require(type(value) is dict and token not in json.dumps(value, ensure_ascii=False), 'Status response contains authentication material or is not an object')
    identifier = lambda item: type(item) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,256}', item)
    revision = lambda item: type(item) is str and re.fullmatch(r'(0|[1-9][0-9]{0,19})', item)
    require(identifier(value.get('serverEpoch')) and revision(value.get('revision')), 'Invalid desk identity')
    audio = value.get('audio')
    require(type(audio) is dict and audio.get('kind') in ('off', 'starting', 'ready', 'stopping', 'fault'), 'Invalid audio state')
    result = {'serverEpoch': value['serverEpoch'], 'revision': value['revision'], 'audio': {'kind': audio['kind']}}
    if audio['kind'] in ('starting', 'ready', 'stopping'):
        require(identifier(audio.get('attempt')), 'Invalid audio attempt')
        result['audio']['attempt'] = audio['attempt']
    if audio['kind'] == 'ready':
        performance = audio.get('performance'); state = performance.get('state') if type(performance) is dict else None
        require(type(state) is dict and state.get('phase') in ('idle', 'count-in', 'playing', 'ended')
                and identifier(performance.get('hostEpoch')) and revision(performance.get('revision')), 'Invalid native status')
        position = {}
        for key in ('bar', 'beat'):
            item = state.get(key)
            require(item is None or (type(item) in (int, float) and math.isfinite(item)), 'Invalid native position')
            position[key] = item
        result['audio']['performance'] = {'hostEpoch': performance['hostEpoch'], 'revision': performance['revision'],
                                          'state': {'phase': state['phase'], **position}}
    return result


def read_status(common, configured_profile):
    """Caller must first verify profile bytes and own the signed request claim."""
    connection = raw = tls = None
    try:
        profile = common['strict_json'](configured_profile)
        require(type(profile) is dict and profile.get('origin') == ORIGIN and profile.get('connectAddress') == ADDRESS
                and profile.get('port') == PORT and profile.get('serviceName') == 'show-tools-web.service'
                and profile.get('tokenFile') == str(CREDENTIALS / 'token'), 'Fixed HTTPS route differs')
        certificate = Path(profile['tls']['cert'])
        require(certificate.is_absolute() and CREDENTIALS in certificate.parents
                and profile.get('caFile') in (None, str(certificate)), 'Configured TLS trust differs')
        certificate_bytes, _info = common['capture'](certificate, 65536, (os.getuid(), os.getgid()), (0o600,))
        secret, _info = common['capture'](CREDENTIALS / 'token', 4096, (os.getuid(), os.getgid()), (0o600,))
        token = secret.decode('ascii').strip()
        require(32 <= len(token) <= 4096 and re.fullmatch(r'[!-~]+', token), 'Configured authentication value is invalid')
        context = ssl.create_default_context(cadata=certificate_bytes.decode('ascii'))
        require(context.check_hostname and context.verify_mode == ssl.CERT_REQUIRED, 'TLS peer verification is required')
        deadline = time.monotonic() + HTTP_SECONDS
        raw = socket.create_connection((ADDRESS, PORT), timeout=3)
        raw.settimeout(3)
        tls = context.wrap_socket(raw, server_hostname=HOST)
        connection = http.client.HTTPSConnection(HOST, PORT, timeout=3, context=context)
        connection.sock = DeadlineSocket(tls, deadline)
        connection.request('GET', '/api/status', headers={'Host': HOST + ':' + str(PORT), 'Origin': ORIGIN,
                                                        'Authorization': 'Bearer ' + token, 'Accept': 'application/json'})
        response = connection.getresponse()
        try:
            require(response.status == 200 and response.getheader('Content-Type', '').split(';')[0].strip().lower() == 'application/json', 'Desk status HTTP response differs')
            body = bytearray()
            while True:
                block = response.read1(min(65536, MAX_RESPONSE + 1 - len(body)))
                if not block:
                    break
                body.extend(block)
                require(len(body) <= MAX_RESPONSE and time.monotonic() <= deadline, 'Status response exceeds its budget')
            require(response.getheader('Content-Length') is None or response.length == 0, 'Status response framing is incomplete')
            return public_view(common['strict_json'](bytes(body)), token)
        finally:
            response.close()
    except Exception:
        raise RuntimeError('Authenticated desk status GET failed') from None
    finally:
        if connection is not None:
            connection.close()
        elif tls is not None:
            tls.close()
        elif raw is not None:
            raw.close()


def fixed_files(common):
    result = {}
    for path, digest in ((common['CHECKER'], common['CHECKER_SHA256']), (common['GRANT'], common['GRANT_SHA256']),
                         (common['SIGNERS'], common['SIGNERS_SHA256'])):
        data, info = common['capture'](path, 65536, (0, 0), (0o644,))
        require(common['sha'](data) == digest, 'Protected file pin differs')
        result[str(path)] = info
    for path, (digest, mode) in common['CURRENT_FILES'].items():
        data, info = common['capture'](Path(path), 1048576, (os.getuid(), os.getgid()), (mode,))
        require(common['sha'](data) == digest, 'Managed file pin differs')
        result[path] = info
    return result


def run_status(request, common, checker, evidence, verifier, snapshot, getter):
    owned_claim, baseline_rows, phase = None, (), 'preclaim'
    try:
        baseline = fixed_files(common)
        release = verifier()
        before = snapshot()
        inspected = checker.call('inspect')
        baseline_rows = checker.request_rows(); unclaimed_request(request, baseline_rows, inspected, common)
        preflight_digest = evidence.put('preflight.json', {'release': release, 'service': before, 'files': baseline,
                                                          'payloadSha256': common['sha'](request.payload)})
        require(fixed_files(common) == baseline, 'Preclaim protected snapshot changed')
        baseline_rows = checker.request_rows(); unclaimed_request(request, baseline_rows, inspected, common)
        phase = 'claim-attempted'; owned_claim = checker.call('claim'); phase = 'claimed'
        running = checker.call('record', 'running', preflight_digest)
        immediate = checker.call('inspect')
        require(fixed_files(common) == baseline, 'Pre-GET protected snapshot changed')
        active_request(request, checker.request_rows(), immediate, owned_claim, running, common)
        view = getter()
        after = snapshot()
        require(fixed_files(common) == baseline, 'Post-GET protected snapshot changed')
        result_digest = evidence.put('result.json', {'view': view, 'serviceBefore': before, 'serviceAfter': after,
            'sameMainServer': before['main'] == after['main'], 'verifiedRelease': release,
            'claim': owned_claim, 'running': running, 'immediateInspection': immediate,
            'payloadSha256': common['sha'](request.payload), 'idleLeaseProvided': False})
        completed = checker.call('record', 'completed', result_digest)
        rows = checker.request_rows()
        require(rows[-1] == completed['receipt'] and owned_claim['receipt'] in rows and running['receipt'] in rows,
                'Completed status audit reconciliation differs')
        evidence.put('completed-receipt.json', completed)
        return {'outcome': 'completed', 'view': view, 'resultSha256': result_digest, 'idleLeaseProvided': False}
    except Exception as failure:
        result = {'outcome': 'uncertain' if phase != 'preclaim' else 'blocked-preclaim', 'phase': phase,
                  'error': str(failure)[:1000], 'claimVerifiedByThisInvocation': owned_claim is not None}
        if phase == 'claim-attempted' and owned_claim is None:
            try:
                result['claimReconciliation'] = common['reconcile_unverified_claim'](checker, baseline_rows)
            except Exception:
                result['claimReconciliationError'] = 'Claim reconciliation unavailable'
        try:
            digest = evidence.put('failure.json', result)
            if owned_claim is not None:
                try:
                    result['receipt'] = checker.call('record', 'uncertain', digest)
                except Exception:
                    result['auditError'] = 'Terminal status audit is unconfirmed; reconcile without retry'
        except Exception:
            result['evidenceError'] = 'Status failure evidence is unconfirmed'
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('envelope', 'plan', 'common', 'executor', 'legacy-validator'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    require(sys.flags.isolated == 1 and sys.platform == 'linux' and socket.gethostname().split('.')[0] == 'proxmox'
            and (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000), 'Need assigned isolated Linux host user')
    require(all(STAGING in path.parents for path in vars(args).values()), 'Status inputs must be in app-private staging')
    require(args.common.name == 'stage-session-release-admission.py' and args.executor.name == 'stage-session-release-anchored.py'
            and args.legacy_validator.name == 'stage-session-release.py', 'Fixed dependency names required')
    common = captured_module(args.common, COMMON_SHA256)
    executor = captured_module(args.executor, EXECUTOR_SHA256)
    for path, digest in ((args.common, COMMON_SHA256), (args.executor, EXECUTOR_SHA256)):
        data, _info = common['capture'](path, 131072, (1000, 1000), (0o600,)); require(common['sha'](data) == digest, 'Qualified code pin differs')
    envelope, _info = common['capture'](args.envelope, 16000, (1000, 1000), (0o600,))
    plan, _info = common['capture'](args.plan, 65536, (1000, 1000), (0o600,))
    request = StatusRequest.decode(envelope, plan, common)
    evidence = common['Evidence'](STAGING / (request.pins['requestId'] + '-status'))
    def interrupted(_signal, _frame):
        for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
            signal.signal(number, signal.SIG_IGN)
        raise RuntimeError('Status request interrupted; reconcile any claimed outcome')
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, interrupted)
    try:
        result = run_status(request, common, RequestChecker(request, common), evidence,
                            lambda: verify_current(common, executor, args.legacy_validator),
                            lambda: observe_service(common), lambda: read_status(common, profile_bytes(common)))
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
