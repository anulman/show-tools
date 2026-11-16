#!/usr/bin/env python3
"""Four fixed signed WEB lifecycle operations; no audio or peripheral enablement."""
import argparse
import base64
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import stat
import sys
import time

OWNER = (1000, 1000)
COMMON_SHA256 = '00bc755fe6078647c7742853cd023e22830d862d007cf9c2140a2b7898e7a433'
STATUS_SHA256 = '6cc3b185183bdf2d33fb9321a5a60767481edf0eb2c054caf5868562bb99eb9b'
EXECUTOR_SHA256 = '36e912b063edb945a2e818cc197e7407856fb48a34071dddc695350e55a5271b'
VALIDATOR_SHA256 = '8d64fee84136c594ae3fca769cdb87c6cde5efefb64a8c73a782468bde4b1065'
SOURCE = '743160a8cde6fd11c31588cf5b3c6a4fac379abe'
ROOT = Path('/home/anulman/.local/share/show-tools')
RELEASE = ROOT / 'releases/session-743160a'
PROFILE = Path('/home/anulman/.config/show-tools/session.json')
UNIT = Path('/home/anulman/.config/systemd/user/show-tools-web.service')
WRAPPER = Path('/home/anulman/.local/bin/show-tools-session')
DATABASE = ROOT / 'practice-bindings.sqlite'
BACKUPS = ROOT / 'backups'
BACKUP = BACKUPS / 'practice-bindings-initial-743160a.sqlite'
OLD_PROFILE = '2a631abee39896be801dab0d6e7305ca518ca82c47f00a8e0d4f2ef6d9ca5347'
OLD_UNIT = 'd056c086cf583045fab8b9d2f324f9778efe7eeaf067b7bc8404e55b4cf897f2'
NEW_PROFILE = '90ef8ade61a9e19425f9b0daa7a00ebe319d799dfa07612295a40cd92f663cbe'
NEW_UNIT = 'e73bf2df40fc1e0097ae297b13dc947d28b947626c9890320c3c420e556e47f8'
WRAPPER_SHA256 = 'c71067fe1120baaadbe53879470c00f70ae9c92af0b819883125760a7e815401'
ARCHIVE = {'url': 'http://100.91.87.3:18742/show-tools-session-release-743160a.tar.gz',
           'bytes': 53308873, 'sha256': '179e3f91b5ff8f9ce7e4687cd5fb293cd8d9ef968ef848d42c46bb2dcbd14156',
           'root': 'show-tools-session-release-743160a', 'installRelease': str(RELEASE)}
MANIFEST_SHA256 = '16317463ab6302dd79679cf676a05d12cd5410070c8751492147d8b103094067'
KINDS = {'stop-old-web': 'web-stop', 'install-v2-profile': 'configure',
         'start-v2-web': 'web-start', 'initial-bindings-backup': 'configure'}
CLI_PREFIX = [str(RELEASE / 'runtime/node'), str(RELEASE / 'gateway/session-cli.mjs')]
EFFECTS = {
 'stop-old-web': ['read-only-current-d8-release-verification', 'authenticated-current-status', 'stop-owned-web-unit', 'verify-inactive-empty-cgroup'],
 'install-v2-profile': ['retain-captured-profile-unit-backups', 'replace-exact-profile', 'replace-exact-unit', 'user-daemon-reload'],
 'start-v2-web': ['start-owned-web-unit', 'initialize-new-app-sqlite-before-listen', 'sqlite-rollback-journal-and-lock-effects',
                  'verify-authenticated-audio-off', 'verify-sqlite-schema-integrity-and-metadata', 'read-only-sqlite-version-and-journal-query', 'fsync-database-and-parent'],
 'initial-bindings-backup': ['create-or-qualify-private-backups-directory', 'sqlite-vacuum-into-owned-private-temporary',
                           'create-only-hardlink-backup-publication', 'remove-only-owned-temporary-on-all-paths',
                           'verify-final-singlelink-logical-snapshot-and-durability'],
}


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def loaded(path, digest, common=None):
    if common is None:
        fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            before = os.fstat(fd)
            require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= 131072
                    and (before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)) == (1000, 1000, 0o600), 'Unexpected common source metadata')
            data = os.read(fd, 131073)
            after = os.fstat(fd)
            signature = lambda x: (x.st_dev, x.st_ino, x.st_mode, x.st_uid, x.st_gid, x.st_nlink, x.st_size, x.st_mtime_ns, x.st_ctime_ns)
            require(len(data) == before.st_size and signature(before) == signature(after), 'Common source changed during capture')
        finally:
            os.close(fd)
    else:
        data, _info = common['capture'](path, 131072, OWNER, (0o600,))
    require(sha(data) == digest, 'Captured source digest differs')
    namespace = {'__name__': 'captured_web_activation_dependency', '__file__': str(path)}
    exec(compile(data, str(path), 'exec'), namespace)
    return namespace


@dataclass(frozen=True)
class Request:
    envelope: bytes
    payload: bytes
    pins: dict
    plan: dict

    @classmethod
    def decode(cls, envelope, plan_bytes, common):
        require(0 < len(envelope) <= 16000 and 0 < len(plan_bytes) <= 65536, 'Input exceeds bound')
        outer, plan = common['strict_json'](envelope), common['strict_json'](plan_bytes)
        require(type(outer) is dict and set(outer) == {'kind', 'payloadBase64', 'signature'}
                and outer['kind'] == 'show-tools-signed-action-v1'
                and type(outer['signature']) is str and type(outer['payloadBase64']) is str, 'Wrong signed envelope')
        payload = base64.b64decode(outer['payloadBase64'], validate=True)
        require(0 < len(payload) <= 8192 and base64.b64encode(payload).decode() == outer['payloadBase64'], 'Invalid payload encoding')
        pins = common['strict_json'](payload)
        require(type(plan) is dict and type(pins) is dict and type(plan.get('kind')) is str and plan['kind'] in KINDS, 'Unknown fixed operation')
        kind = plan['kind']
        require(pins.get('action') == plan.get('action') == KINDS[kind]
                and pins.get('targetId') == plan.get('targetId') == common['TARGET'], 'Wrong fixed action or target')
        require(type(pins.get('requestId')) is str and type(pins.get('nonce')) is str
                and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', pins['requestId'])
                and re.fullmatch(r'[a-f0-9]{32}', pins['nonce']), 'Invalid request identity')
        require(pins.get('sourceRevision') == plan.get('sourceRevision') == SOURCE
                and pins.get('archive') == plan.get('archive') == ARCHIVE
                and pins.get('planSha256') == sha(plan_bytes), 'Source/archive/plan pin differs')
        require(plan.get('artifactManifestSha256') == MANIFEST_SHA256
                and plan.get('commonSha256') == COMMON_SHA256 and plan.get('statusSourceSha256') == STATUS_SHA256
                and plan.get('executorSha256') == EXECUTOR_SHA256 and plan.get('validatorSha256') == VALIDATOR_SHA256,
                'Dependency pin differs')
        require(pins.get('grantSha256') == common['GRANT_SHA256'] and plan.get('protected') == {
            'checkerSha256': common['CHECKER_SHA256'], 'grantSha256': common['GRANT_SHA256'],
            'signersSha256': common['SIGNERS_SHA256']}, 'Protected pin differs')
        expected_profile, expected_unit = (OLD_PROFILE, OLD_UNIT) if kind in ('stop-old-web', 'install-v2-profile') else (NEW_PROFILE, NEW_UNIT)
        require(pins.get('profileSha256') == expected_profile and pins.get('unitSha256') == expected_unit
                and pins.get('cliSha256') == WRAPPER_SHA256, 'Managed-file payload pins differ')
        require(plan.get('cliSha256Meaning') == 'preserved-global-wrapper-not-executed'
                and plan.get('effects') == EFFECTS[kind], 'Effect declaration differs')
        require(type(pins.get('evidence')) is list and len(pins['evidence']) <= 8
                and [x for x in pins['evidence'] if type(x) is dict and x.get('kind') == 'artifact-manifest']
                == [{'kind': 'artifact-manifest', 'sha256': MANIFEST_SHA256}], 'Manifest evidence differs')
        return cls(envelope, payload, pins, plan)


def claim_barrier(request, checker, owned_claim, running, status_module, common):
    started = time.monotonic()
    inspected = checker.call('inspect')
    rows = checker.request_rows()
    status_module['active_request'](request, rows, inspected, owned_claim, running, common)
    require(time.monotonic() - started <= 5, 'Latest request inspection exceeded its freshness budget')
    return inspected


def execute(request, runtime, checker, evidence, status_module, common):
    phase, owned_claim, running, baseline_rows = 'captured', None, None, ()
    terminal_attempted = False
    try:
        before = runtime.preflight()
        inspected = checker.call('inspect')
        baseline_rows = checker.request_rows()
        status_module['unclaimed_request'](request, baseline_rows, inspected, common)
        preflight_digest = evidence.put('preflight.json', {'snapshot': before, 'planSha256': request.pins['planSha256'],
                                                          'payloadSha256': sha(request.payload)})
        require(runtime.preflight() == before, 'Preclaim state changed')
        status_module['unclaimed_request'](request, checker.request_rows(), inspected, common)
        phase = 'claim-attempted'
        owned_claim = checker.call('claim')
        phase = 'claimed'
        running = checker.call('record', 'running', preflight_digest)
        phase = 'running'
        def barrier():
            return claim_barrier(request, checker, owned_claim, running, status_module, common)
        require(runtime.preflight() == before, 'Pre-effect state changed')
        barrier()
        phase = 'effects'
        effects = runtime.apply(barrier, evidence)
        after = runtime.readback()
        digest = evidence.put('result.json', {'outcome': 'completed', 'kind': request.plan['kind'], 'effects': effects,
                                              'readback': after, 'payloadSha256': sha(request.payload)})
        terminal_attempted = True
        receipt = checker.call('record', 'completed', digest)
        rows = checker.request_rows()
        require(rows[-1] == receipt['receipt'] and owned_claim['receipt'] in rows and running['receipt'] in rows
                and sum(row.get('outcome') == 'completed' for row in rows) == 1, 'Terminal reconciliation differs')
        evidence.put('completed-receipt.json', receipt)
        return {'outcome': 'completed', 'kind': request.plan['kind'], 'resultSha256': digest, 'receipt': receipt}
    except Exception as error:
        result = {'outcome': 'uncertain' if phase != 'captured' else 'blocked-preclaim', 'phase': phase,
                  'error': str(error)[:1000], 'payloadSha256': sha(request.payload),
                  'claimVerifiedByThisInvocation': owned_claim is not None, 'terminalAttempted': terminal_attempted}
        if owned_claim is not None and hasattr(runtime, 'failure_snapshot'):
            try: result['actualPartialState'] = runtime.failure_snapshot()
            except Exception as failure: result['partialStateError'] = str(failure)[:1000]
        if phase == 'claim-attempted' and owned_claim is None:
            try:
                result['claimReconciliation'] = common['reconcile_unverified_claim'](checker, baseline_rows)
            except Exception as failure:
                result['reconciliationError'] = str(failure)[:1000]
        try:
            digest = evidence.put('failure.json', result)
            if owned_claim is not None and not terminal_attempted:
                rows = checker.request_rows()
                expected = {key: request.pins[key] for key in ('requestId', 'nonce', 'grantSha256', 'grantVersion', 'action')}
                expected['payloadSha256'] = sha(request.payload)
                still_owned = (type(rows) is tuple and owned_claim['receipt'] in rows
                    and sum(row.get('operation') == 'claim' for row in rows) == 1
                    and all(type(row) is dict and set(row) == common['ROW_KEYS']
                        and all(row.get(key) == value for key, value in expected.items())
                        and (row.get('operation'), row.get('outcome')) in
                            (('inspect', 'inspected'), ('claim', 'claimed'), ('record', 'running')) for row in rows))
                if still_owned: result['receipt'] = checker.call('record', 'uncertain', digest)
                else: result['terminalRecordWithheld'] = 'Ledger is terminal, denied, conflicting or no longer uniquely owned'
            result['evidenceSha256'] = digest
        except Exception as failure:
            result['auditError'] = str(failure)[:1000]
        return result


class Runtime:
    def __init__(self, request, common, executor, status_module, archive, validator, candidate_profile, candidate_unit, evidence_path):
        self.request, self.common, self.executor, self.status = request, common, executor, status_module
        self.archive, self.validator = archive, validator
        self.candidate_profile, self.candidate_unit = candidate_profile, candidate_unit
        self.evidence_path = evidence_path
        self.kind = request.plan['kind']
        self.expected_profile, self.expected_unit = ((OLD_PROFILE, OLD_UNIT) if self.kind in ('stop-old-web', 'install-v2-profile') else (NEW_PROFILE, NEW_UNIT))
        self.pending_profile, self.pending_unit = self.expected_profile, self.expected_unit
        self.result = None
        self.effect_barrier = None

    def capture(self, path, digest=None, mode=0o600, maximum=1048576):
        data, info = self.common['capture'](path, maximum, OWNER, (mode,))
        require(digest is None or sha(data) == digest, 'Managed bytes differ: ' + str(path))
        return data, info

    def command(self, argv, seconds=15):
        if self.effect_barrier is not None and argv[0] == CLI_PREFIX[0]: self.latest_inspection(self.effect_barrier)
        return self.common['bounded_process'](argv, seconds=seconds, cap=1048576).decode('utf-8')

    def service(self, active):
        if active:
            observed = self.status['observe_service'](self.common, expected_server_dir=(ROOT / 'releases/session-d8fa3cf' if self.kind == 'stop-old-web' else RELEASE))
            require(len(observed['members']) == 1 and observed['members'][0]['pid'] == observed['main']['pid'],
                    'Named web cgroup has an unexpected additional process')
            return observed
        text = self.command(['/usr/bin/systemctl', '--user', 'show', 'show-tools-web.service',
                             '--property=LoadState,ActiveState,SubState,MainPID,ControlGroup,FragmentPath,DropInPaths,TasksCurrent,Restart'])
        props = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
        require(props.get('LoadState') == 'loaded' and props.get('ActiveState') == 'inactive' and props.get('MainPID') == '0'
                and props.get('FragmentPath') == str(UNIT) and props.get('DropInPaths') == '' and props.get('Restart') == 'no'
                and props.get('TasksCurrent') in ('0', '[not set]', ''), 'Named web service is not inactive and empty')
        group = props.get('ControlGroup', '')
        if group:
            require(group.startswith('/user.slice/user-1000.slice/') and group.endswith('/show-tools-web.service'), 'Unexpected named cgroup')
            path = Path('/sys/fs/cgroup') / group.lstrip('/') / 'cgroup.procs'
            try:
                require(not path.read_text().strip(), 'Named cgroup still has members')
            except FileNotFoundError:
                pass
        return props

    def metadata(self, path, *, directory=False):
        parent_fds = self.common['open_parent'](path, OWNER)
        try:
            info = os.stat(path.name, dir_fd=parent_fds[-1], follow_symlinks=False)
            require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == OWNER + (0o700 if directory else 0o600,)
                    and (stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1), 'Unexpected private app metadata')
            fd = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC
                         | (os.O_DIRECTORY if directory else 0), dir_fd=parent_fds[-1])
            try:
                require(self.common['metadata'](os.fstat(fd)) == self.common['metadata'](info), 'Metadata object changed during open')
                self.common['no_acl'](fd)
                require(self.common['metadata'](os.stat(path.name, dir_fd=parent_fds[-1], follow_symlinks=False))
                        == self.common['metadata'](info), 'Metadata pathname changed during inspection')
            finally: os.close(fd)
            return self.common['metadata'](info)
        finally:
            for fd in reversed(parent_fds): os.close(fd)

    def absent(self, path):
        fds = self.common['open_parent'](path, OWNER)
        try:
            try: os.stat(path.name, dir_fd=fds[-1], follow_symlinks=False)
            except FileNotFoundError: return True
            raise RuntimeError('Expected absent app path: ' + str(path))
        finally:
            for fd in reversed(fds): os.close(fd)

    def db_absent(self):
        for suffix in ('', '-journal', '-wal', '-shm'):
            self.absent(Path(str(DATABASE) + suffix))

    def protected(self):
        result = {}
        for path, digest in ((self.common['CHECKER'], self.common['CHECKER_SHA256']), (self.common['GRANT'], self.common['GRANT_SHA256']),
                             (self.common['SIGNERS'], self.common['SIGNERS_SHA256'])):
            data, info = self.common['capture'](path, 65536, (0, 0), (0o644,))
            require(sha(data) == digest, 'Protected bytes changed'); result[str(path)] = info
        result['wrapper'] = self.capture(WRAPPER, WRAPPER_SHA256, 0o700)[1]
        return result

    def persistence(self):
        link = UNIT.parent / 'default.target.wants/show-tools-web.service'
        fds = self.common['open_parent'](link, OWNER)
        try:
            info = os.stat(link.name, dir_fd=fds[-1], follow_symlinks=False)
            require(stat.S_ISLNK(info.st_mode) and (info.st_uid, info.st_gid) == OWNER
                    and os.readlink(link.name, dir_fd=fds[-1]) in (str(UNIT), '../show-tools-web.service'), 'Existing enablement differs')
            result = {'link': self.common['metadata'](info), 'target': os.readlink(link.name, dir_fd=fds[-1])}
        finally:
            for fd in reversed(fds): os.close(fd)
        require(self.command(['/usr/bin/loginctl', 'show-user', '1000', '--property=Linger', '--value']).strip() == 'yes', 'Existing Linger differs')
        return result

    def verify_release(self):
        pins = self.executor['ReleasePins'](SOURCE, ARCHIVE['sha256'], ARCHIVE['bytes'], MANIFEST_SHA256)
        return self.executor['verify_local_release'](self.archive, pins, self.validator, RELEASE)

    def credential_metadata(self):
        profile = self.common['strict_json'](self.capture(PROFILE, self.pending_profile)[0])
        result = {}
        for label, path, modes in [('token', profile['tokenFile'], (0o600,)),
                                   ('tls-key', profile['tls']['key'], (0o600,)),
                                   ('tls-certificate', profile['tls']['cert'], (0o600, 0o644))]:
            value = Path(path)
            require(value.is_absolute() and value.parent == Path('/home/anulman/.config/show-tools/credentials'), 'Credential metadata path differs')
            fds = self.common['open_parent'](value, OWNER)
            try:
                info = os.stat(value.name, dir_fd=fds[-1], follow_symlinks=False)
                require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and (info.st_uid, info.st_gid) == OWNER
                        and stat.S_IMODE(info.st_mode) in modes, 'Credential metadata differs')
                result[label] = self.common['metadata'](info)
            finally:
                for fd in reversed(fds): os.close(fd)
        return result

    def manager_environment(self):
        text = self.command(['/usr/bin/systemctl', '--user', 'show-environment'])
        env = {}
        for line in text.splitlines():
            name, separator, value = line.partition('=')
            require(separator and name not in env, 'Ambiguous manager environment')
            env[name] = value
        forbidden = [name for name in env if (name.startswith('NODE_') and name != 'NODE_ENV')
                     or name.startswith(('LD_', 'DYLD_', 'BASH_FUNC_'))
                     or name in ('ENV', 'BASH_ENV', 'OPENSSL_CONF', 'OPENSSL_MODULES')]
        require(not forbidden, 'Runtime override names require review: ' + ','.join(sorted(forbidden)))
        paths = shlex.split(env.get('PATH', ''))
        require(len(paths) == 1 and len(paths[0]) <= 8192, 'Manager PATH requires review')
        for item in paths[0].split(':'):
            require(item.startswith('/') and os.path.normpath(item) == item, 'Manager PATH needs absolute normalized directories')
            selected = Path(item)
            resolved = selected.resolve(strict=True)
            for ancestor in (selected, *selected.parents, resolved, *resolved.parents):
                info = ancestor.lstat()
                require(info.st_uid == 0 and (stat.S_ISLNK(info.st_mode)
                        or stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022), 'Manager PATH ancestry is not protected')
        return {'forbiddenRuntimeOverrides': False, 'pathDirectories': len(paths[0].split(':'))}

    def preflight(self):
        result = {'protected': self.protected(), 'profile': self.capture(PROFILE, self.expected_profile)[1],
                  'unit': self.capture(UNIT, self.expected_unit)[1], 'persistence': self.persistence(),
                  'credentials': self.credential_metadata(), 'managerEnvironment': self.manager_environment(),
                  'service': self.service(self.kind in ('stop-old-web', 'initial-bindings-backup'))}
        if self.kind == 'install-v2-profile':
            self.capture(self.candidate_profile, NEW_PROFILE); self.capture(self.candidate_unit, NEW_UNIT)
        if self.kind == 'start-v2-web': self.db_absent()
        if self.kind == 'initial-bindings-backup':
            result['database'] = self.metadata(DATABASE)
            try:
                result['backups'] = self.metadata(BACKUPS, directory=True)
                self.absent(BACKUP)
            except FileNotFoundError:
                self.absent(BACKUPS)
                result['backups'] = 'absent'
        return result

    def ensure_off(self):
        profile, _ = self.capture(PROFILE, self.pending_profile)
        if self.effect_barrier is not None: self.latest_inspection(self.effect_barrier)
        status = self.status['read_status'](self.common, profile)
        audio = status.get('audio', {})
        require((audio.get('kind') if isinstance(audio, dict) else None) == 'off'
                or status.get('audioKind') == 'off', 'Fresh authenticated audio-off status required')
        return status

    def managed_state(self):
        return {'profile': self.capture(PROFILE, self.pending_profile)[1],
                'unit': self.capture(UNIT, self.pending_unit)[1]}

    def latest_inspection(self, barrier, managed=None):
        started = time.monotonic()
        barrier()
        if managed is not None:
            for label, path in (('profile', PROFILE), ('unit', UNIT)):
                require(self.common['metadata'](path.lstat()) == managed[label], 'Managed state changed after prechecks')
        require(time.monotonic() - started <= 5, 'Effect inspection exceeded its freshness budget')

    def replace(self, path, old_digest, candidate, new_digest, label, barrier, evidence):
        old, before = self.capture(path, old_digest)
        new, _ = self.capture(candidate, new_digest)
        evidence.put(label + '-retained.json', {'sha256': old_digest, 'bytesBase64': base64.b64encode(old).decode(), 'metadata': before})
        fds = self.common['open_parent'](path, OWNER)
        name = '.show-tools-' + self.request.pins['requestId'] + '-' + label
        try:
            parent = fds[-1]
            self.service(False)
            managed = self.managed_state()
            self.latest_inspection(barrier, managed)
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent)
            try:
                remaining = memoryview(new)
                while remaining:
                    count = os.write(fd, remaining); require(count > 0, 'No publication progress'); remaining = remaining[count:]
                os.fsync(fd)
                temporary_info = self.common['metadata'](os.fstat(fd))
            finally: os.close(fd)
            require(self.capture(path.parent / name, new_digest)[1] == temporary_info, 'Publication temporary changed')
            self.managed_state()
            self.service(False)
            require(self.capture(path, old_digest)[1] == before, 'Managed target changed before replacement')
            self.common['check_parent_paths'](path, fds, OWNER)
            managed = self.managed_state()
            self.latest_inspection(barrier, managed)
            os.rename(name, path.name, src_dir_fd=parent, dst_dir_fd=parent)
            os.fsync(parent)
            require(self.capture(path, new_digest)[0] == new, 'Replacement readback differs')
            return {'path': str(path), 'sha256': new_digest, 'retainedSha256': old_digest}
        finally:
            # A failed temporary publication stays in its exact parent for reconciliation.
            for fd in reversed(fds): os.close(fd)

    def sync(self, path, *, directory=False):
        before = self.metadata(path, directory=directory)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC | (os.O_DIRECTORY if directory else 0))
        try:
            require(self.common['metadata'](os.fstat(fd)) == before, 'Durability object changed')
            if self.effect_barrier is not None: self.latest_inspection(self.effect_barrier)
            os.fsync(fd)
        finally: os.close(fd)
        require(self.metadata(path, directory=directory) == before, 'Durability pathname changed')

    def verify_db(self, path):
        info = self.metadata(path)
        output = self.command(CLI_PREFIX + ['bindings', 'verify', '--input', str(path)], seconds=30)
        require(re.fullmatch(r'Verified [0-9]+ binding records\. Only per-song button bindings and chart source hashes; excludes charts, effects and recordings\.\s*', output), 'Unexpected binding verification output')
        diagnostics_script = ('const {DatabaseSync}=require("node:sqlite");'
            'const d=new DatabaseSync(process.argv[1],{readOnly:true});'
            'try{console.log(JSON.stringify({sqliteVersion:d.prepare("SELECT sqlite_version() AS version").get().version,'
            'journalMode:d.prepare("PRAGMA journal_mode").get().journal_mode}));}finally{d.close();}')
        diagnostics = self.common['strict_json'](self.command([CLI_PREFIX[0], '-e', diagnostics_script, str(path)]))
        require(type(diagnostics.get('sqliteVersion')) is str and diagnostics.get('journalMode') == 'delete',
                'Unexpected actual SQLite runtime or journal mode')
        self.sync(path)
        return {'metadata': info, 'verification': output.strip(), 'sqlite': diagnostics}


    def apply(self, barrier, evidence):
        self.effect_barrier = barrier
        self.preserved = {'protected': self.protected(), 'persistence': self.persistence(), 'credentials': self.credential_metadata()}
        if self.kind == 'stop-old-web':
            before = self.service(True); view = self.ensure_off()
            require(self.service(True) == before, 'Named server changed before stop')
            managed = self.managed_state()
            self.latest_inspection(barrier, managed)
            self.command(['/usr/bin/systemctl', '--user', 'stop', 'show-tools-web.service'], seconds=30)
            self.service(False)
            self.result = {'authenticatedBeforeStop': view, 'stopped': True}
        elif self.kind == 'install-v2-profile':
            first = self.replace(PROFILE, OLD_PROFILE, self.candidate_profile, NEW_PROFILE, 'profile', barrier, evidence)
            self.pending_profile = NEW_PROFILE
            second = self.replace(UNIT, OLD_UNIT, self.candidate_unit, NEW_UNIT, 'unit', barrier, evidence)
            self.pending_unit = NEW_UNIT
            self.service(False)
            managed = self.managed_state()
            self.latest_inspection(barrier, managed)
            self.command(['/usr/bin/systemctl', '--user', 'daemon-reload'])
            self.result = {'replaced': [first, second], 'daemonReloaded': True}
        elif self.kind == 'start-v2-web':
            self.service(False); self.db_absent(); barrier(); self.db_absent()
            output = self.command(CLI_PREFIX + ['start', '--profile', str(PROFILE)], seconds=45)
            require('Server active (show-tools-web.service). Audio off. Linger=yes.' in output, 'Web did not report authenticated audio-off readiness')
            self.service(True); view = self.ensure_off()
            database = self.verify_db(DATABASE); self.sync(ROOT, directory=True)
            for suffix in ('-journal', '-wal', '-shm'): self.absent(Path(str(DATABASE) + suffix))
            versions = self.command([CLI_PREFIX[0], '-p', 'JSON.stringify(process.versions)'])
            self.result = {'start': output.strip(), 'authenticated': view, 'database': database,
                           'runtimeVersions': self.common['strict_json'](versions), 'sqliteSidecarsAfterCommit': 'absent'}
        else:
            self.service(True); self.ensure_off(); self.verify_db(DATABASE)
            fds = self.common['open_parent'](BACKUPS, OWNER)
            try:
                managed = self.managed_state()
                self.latest_inspection(barrier, managed)
                try: os.mkdir(BACKUPS.name, 0o700, dir_fd=fds[-1]); os.fsync(fds[-1])
                except FileExistsError: pass
            finally:
                for fd in reversed(fds): os.close(fd)
            self.metadata(BACKUPS, directory=True); self.absent(BACKUP); barrier(); self.absent(BACKUP)
            output = self.command(CLI_PREFIX + ['bindings', 'backup', '--profile', str(PROFILE), '--output', str(BACKUP)], seconds=45)
            checked = self.verify_db(BACKUP)
            require(checked['metadata'][:2] != self.metadata(DATABASE)[:2], 'Backup must be a distinct inode')
            data, _info = self.capture(BACKUP, maximum=67108864)
            self.sync(BACKUPS, directory=True)
            self.result = {'backup': str(BACKUP), 'sha256': sha(data), 'verification': checked,
                           'command': output.strip(), 'scope': 'point-in-time consistent binding snapshot; no cadence or offmachine backup'}
        return self.result

    def failure_snapshot(self):
        result = {'scope': 'observed partial state only; not readiness or retry authorization', 'managedFiles': {}}
        for path in (PROFILE, UNIT):
            try:
                data, info = self.capture(path)
                result['managedFiles'][str(path)] = {'sha256': sha(data), 'metadata': info}
            except Exception as failure:
                result['managedFiles'][str(path)] = {'error': str(failure)[:500]}
        result['service'] = self.command(['/usr/bin/systemctl', '--user', 'show', 'show-tools-web.service',
            '--property=LoadState,ActiveState,SubState,MainPID,ControlGroup,FragmentPath,DropInPaths,TasksCurrent,Restart'])
        result['databasePaths'] = {}
        for path in (DATABASE, Path(str(DATABASE) + '-journal'), Path(str(DATABASE) + '-wal'), Path(str(DATABASE) + '-shm'), BACKUP):
            try: result['databasePaths'][str(path)] = self.common['metadata'](path.lstat())
            except FileNotFoundError: result['databasePaths'][str(path)] = 'absent'
        return result

    def readback(self):
        require(self.protected() == self.preserved['protected'] and self.persistence() == self.preserved['persistence']
                and self.credential_metadata() == self.preserved['credentials'], 'Preserved protected/wrapper/enablement/Linger state changed')
        self.capture(PROFILE, self.pending_profile); self.capture(UNIT, self.pending_unit)
        service = self.service(self.kind in ('start-v2-web', 'initial-bindings-backup'))
        if self.kind in ('start-v2-web', 'initial-bindings-backup'): self.ensure_off()
        return {'service': service, 'profileSha256': self.pending_profile, 'unitSha256': self.pending_unit,
                'release': self.verify_release(), 'persistenceUnchanged': True, 'nativeAudioStartRequested': False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('envelope', 'plan', 'common', 'status-source', 'executor', 'validator', 'legacy-validator', 'archive', 'candidate-profile', 'candidate-unit'):
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    require(STATUS_SHA256 != 'PENDING', 'Source-only: status dependency must be frozen and reviewed')
    require(sys.flags.isolated == 1 and sys.platform == 'linux' and socket.gethostname().split('.')[0] == 'proxmox'
            and (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000), 'Need assigned isolated Linux host user')
    require(all(path.is_absolute() and path.resolve(strict=True) == path and ROOT / 'staging' in path.parents for path in vars(args).values()), 'All inputs must be app-private staging files')
    os.umask(0o077)
    common = loaded(args.common, COMMON_SHA256)
    status_module = loaded(args.status_source, STATUS_SHA256, common)
    executor = loaded(args.executor, EXECUTOR_SHA256, common)
    validation, _ = common['capture'](args.validator, 65536, OWNER, (0o600,))
    require(sha(validation) == VALIDATOR_SHA256, 'Validator source changed')
    envelope, _ = common['capture'](args.envelope, 16000, OWNER, (0o600,))
    plan, _ = common['capture'](args.plan, 65536, OWNER, (0o600,))
    request = Request.decode(envelope, plan, common)
    def interrupted(_signal, _frame):
        for value in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT): signal.signal(value, signal.SIG_IGN)
        raise RuntimeError('Activation interrupted; claimed effects may be uncertain')
    for value in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT): signal.signal(value, interrupted)
    path = ROOT / 'staging' / (request.pins['requestId'] + '-admission')
    runtime = Runtime(request, common, executor, status_module, args.archive, args.validator,
                      args.candidate_profile, args.candidate_unit, path)
    runtime.verify_release()
    if request.plan['kind'] == 'stop-old-web':
        status_module['verify_current'](common, executor, args.legacy_validator)
    evidence = common['Evidence'](path)
    try:
        result = execute(request, runtime, status_module['RequestChecker'](request, common), evidence, status_module, common)
        print(json.dumps(result, separators=(',', ':')), flush=True)
        return 0 if result['outcome'] == 'completed' else 1
    finally: evidence.close()


if __name__ == '__main__':
    try: sys.exit(main())
    except (OSError, RuntimeError, ValueError) as failure:
        print(json.dumps({'outcome': 'held', 'error': str(failure)[:1000]}), flush=True)
        sys.exit(1)
