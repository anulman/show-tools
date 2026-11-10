import base64
import concurrent.futures
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import threading
import time
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


check = load('delegation_check', 'check.py')
client = load('delegation_client', 'sign.py')


class Delegation(unittest.TestCase):
    def test_fixed_target_assignment_policy_and_lifecycle_pins(self):
        for key in ('profileSha256', 'unitSha256', 'runnerSha256', 'helperSha256',
                    'manifestSha256', 'sourceReviewSha256', 'planSha256', 'peripheralAssignmentSha256'):
            self.assert_invalid_plan(lambda value, key=key: value.update({key: 'bad'}))
        for action in ('stage', 'install', 'web-start', 'audio-on', 'sudo', 'shell'):
            self.assert_invalid_plan(lambda value, action=action: value.update(action=action))
        self.assert_invalid_plan(lambda value: value.update(peripheralAssignmentSha256='0' * 64))
        self.assert_invalid_plan(lambda value: value.update(completedWebStage=None))
        self.assert_invalid_plan(lambda value: value['completedWebStage'].update(command='sh'))
        self.assert_invalid_plan(lambda value: value.update(action='status', oldUnitSha256=None))
        self.assert_invalid_plan(lambda value: value.update(action='peripheral-start', oldProfileSha256='0' * 64))
        self.assert_invalid_plan(lambda value: value.update(action='rollback', oldProfileSha256=None))
        initial = dict(self.plan, oldProfileSha256=None, oldUnitSha256=None)
        self.assertIs(self.candidate(self.message(initial))['executable'], False)
        for change in (
            lambda value: value['target'].update(id='proxmox/anulman/show-tools-web'),
            lambda value: value['target'].update(profile='/etc/shadow'),
            lambda value: value['target']['peripheralAssignment'].update(buttonKey='tab'),
            lambda value: value['target']['peripheralAssignment'].update(sdkChannel=1),
            lambda value: value['target']['peripheralAssignment'].update(linuxKeyCode=True),
            lambda value: value['constraints'].update(managerRestartPolicy='on-failure'),
            lambda value: value['constraints'].update(audioLifecycleAllowed=True),
            lambda value: value['constraints'].update(syntheticMusicalStartStopAllowed=True),
            lambda value: value['constraints']['attachmentHousekeeping']['releaseControl'].update(value=1),
            lambda value: value['constraints']['attachmentHousekeeping'].update(jiggleConfiguration='any-running-change'),
            lambda value: value['constraints'].update(unitEnableAllowed=True),
            lambda value: value['constraints'].update(devicePermissionChangesAllowed=True),
            lambda value: value.update(checkerSha256='0' * 64),
        ):
            grant = copy.deepcopy(self.grant)
            change(grant)
            with self.assertRaises(check.Rejected):
                check.validate_grant(check.canonical(grant), self.checker, self.signer)
        with self.assertRaises(check.Rejected):
            self.candidate(self.message(namespace='show-tools-deploy-v1'))

    def setUp(self):
        self.now = int(time.time())
        self.grant = json.loads((ROOT / 'grant.inactive.json').read_bytes())
        self.grant['active'] = True
        self.grant['principal']['sshPublicKey'] = self.public_key
        key_blob = base64.b64decode(self.public_key.split()[1])
        self.grant['principal']['sshKeyFingerprint'] = 'SHA256:' + base64.b64encode(hashlib.sha256(key_blob).digest()).decode().rstrip('=')
        self.grant['checkerSha256'] = check.sha(self.checker)
        self.grant['signersSha256'] = check.sha(self.signer)
        self.grant_raw = check.canonical(self.grant)
        self.plan = dict(schemaVersion=1, requestId='peripheral-001', nonce=os.urandom(16).hex(),
            issuedAt=self.now, expiresAt=self.now + 300, grantId=self.grant['grantId'],
            grantVersion=1, grantSha256=check.sha(self.grant_raw), targetId=self.grant['target']['id'],
            action='configure', sourceRevision='a' * 40,
            archive=dict(url='http://100.91.87.3:18742/show-tools-session-release-aaaaaaa.tar.gz',
                bytes=12345, sha256='b' * 64, root='show-tools-session-release-aaaaaaa',
                installRelease=self.grant['target']['releaseRoot'] + '/session-aaaaaaa'),
            oldProfileSha256='c' * 64, oldUnitSha256='d' * 64, profileSha256='c' * 64,
            unitSha256='d' * 64, runnerSha256='e' * 64, helperSha256='f' * 64,
            manifestSha256='1' * 64, sourceReviewSha256='2' * 64, planSha256='3' * 64,
            peripheralAssignmentSha256=check.sha(check.canonical(self.grant['target']['peripheralAssignment'])),
            completedWebStage=dict(requestId='web-stage-001', evidenceSha256='4' * 64),
            evidence=[dict(kind='tests', sha256='5' * 64)])

    def ledger(self):
        directory = tempfile.TemporaryDirectory(prefix='peripheral-ledger-test-', dir=str(Path(tempfile.gettempdir()).resolve()))
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'authorization-peripheral.jsonl'
        with path.open('xb') as stream:
            stream.write(check.canonical(check.genesis(stream.fileno(), self.now)) + b'\n')
        path.chmod(0o600)
        return path


    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='show-tools-delegation-test-')
        cls.root = Path(cls.temporary.name)
        cls.key = cls.root / 'key'
        cls.wrong_key = cls.root / 'wrong'
        for path in (cls.key, cls.wrong_key):
            subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', str(path)], check=True)
        cls.public_key = ' '.join(cls.key.with_suffix('.pub').read_text().split()[:2])
        cls.signer = f'{check.PRINCIPAL} namespaces="{check.NAMESPACE}" {cls.public_key}\n'.encode()
        cls.signer_path = cls.root / 'allowed_signers'
        cls.signer_path.write_bytes(cls.signer)
        cls.checker = (ROOT / 'check.py').read_bytes()


    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()


    def sign(self, payload, key=None, namespace=None):
        return subprocess.run(['/usr/bin/ssh-keygen', '-Y', 'sign', '-f', str(key or self.key),
                               '-n', namespace or check.NAMESPACE], input=payload,
                              stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True).stdout


    def message(self, plan=None, key=None, namespace=None):
        payload = check.canonical(plan or self.plan)
        return json.loads(client.submission(payload, self.sign(payload, key, namespace)))['content'].encode()


    def candidate(self, raw=None, request_id=None, grant=None):
        return check.candidate(raw or self.message(), request_id or self.plan['requestId'],
                               grant or self.grant_raw, self.checker, self.signer,
                               self.signer_path, self.now)


    def assert_invalid_plan(self, update):
        value = copy.deepcopy(self.plan)
        update(value)
        with self.assertRaises((check.Rejected, TypeError, ValueError)):
            self.candidate(self.message(value))


    def event(self, path, operation, report=None, outcome=None, evidence=None, limit=check.MAX_LEDGER):
        with path.open('r+b', buffering=0) as stream:
            return check.ledger_event(stream, self.plan['requestId'], operation, report,
                                      self.now, outcome, evidence, limit)


    def test_real_signature_yields_candidate_without_execution(self):
        result = self.candidate()
        self.assertEqual(result['kind'], 'authenticated-candidate')
        self.assertIs(result['executable'], False)
        self.assertEqual(result['hostPreconditions'], 'unverified')
        self.assertEqual(result['sshSourceProvenance'], 'not-attested')
        self.assertEqual(result['pins'], self.plan)
        self.assertFalse(self.grant['constraints']['audioLifecycleAllowed'])


    def test_wrong_key_namespace_and_modified_payload_are_rejected(self):
        for raw in (self.message(key=self.wrong_key), self.message(namespace='wrong-namespace')):
            with self.assertRaises(check.Rejected):
                self.candidate(raw)
        envelope = json.loads(self.message())
        plan = dict(self.plan, action='peripheral-stop')
        envelope['payloadBase64'] = base64.b64encode(check.canonical(plan)).decode()
        with self.assertRaises(check.Rejected):
            self.candidate(check.canonical(envelope))


    def test_request_id_target_current_grant_and_version_binding(self):
        with self.assertRaises(check.Rejected):
            self.candidate(request_id='old-unsigned-row')
        for key, value in [('targetId', 'another-vm'), ('grantId', 'another-grant'),
                           ('grantVersion', 2), ('grantSha256', '0' * 64), ('grantVersion', True)]:
            self.assert_invalid_plan(lambda plan, k=key, v=value: plan.update({k: v}))
        inactive = dict(self.grant, active=False)
        with self.assertRaises(check.Rejected):
            self.candidate(grant=check.canonical(inactive))


    def test_expiry_future_and_ttl_bounds(self):
        for issued, expires in ((self.now - 1000, self.now - 1), (self.now + 61, self.now + 300),
                                (self.now, self.now + 901), (self.now, self.now),
                                (True, self.now + 5), (self.now, float('inf'))):
            with self.subTest(issued=issued, expires=expires):
                self.assert_invalid_plan(lambda plan: plan.update(issuedAt=issued, expiresAt=expires))


    def test_archive_path_origin_size_and_source_pins(self):
        for field, value in (('url', 'http://100.91.87.3:18742/../escape.tar.gz'),
                             ('url', 'https://evil.test/release.tar.gz'),
                             ('url', 'http://100.91.87.3:18742/show-tools-session-release-bbbbbbb.tar.gz'),
                             ('root', '../escape'), ('installRelease', '/etc/shadow'),
                             ('bytes', 104857601), ('bytes', True), ('sha256', 'bad')):
            self.assert_invalid_plan(lambda plan, key=field, v=value: plan['archive'].update({key: v}))
        self.assert_invalid_plan(lambda plan: plan.update(sourceRevision='a' * 7))


    def test_strict_json_base64_wrappers_and_unsigned_history(self):
        samples = [b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}', b'{"x":-Infinity}', b'{"x":1e999}', b'{', b'\xff']
        for raw in samples:
            with self.assertRaises(check.Rejected):
                check.strict_json(raw, 100)
        for raw in (b'unsigned old message', b'{}', b'prose ' + self.message(),
                    check.canonical({'kind': 'show-tools-peripheral-signed-action-v1', 'payloadBase64': '!!!!', 'signature': 'x'})):
            with self.assertRaises(check.Rejected):
                self.candidate(raw)
        envelope = json.loads(self.message())
        envelope['extra'] = True
        with self.assertRaises(check.Rejected):
            self.candidate(check.canonical(envelope))
        payload = check.canonical(self.plan).replace(b'"schemaVersion":1', b'"schemaVersion":1,"schemaVersion":1')
        signature = self.sign(payload)
        with self.assertRaises(check.Rejected):
            self.candidate(check.canonical({'kind': 'show-tools-peripheral-signed-action-v1',
                'payloadBase64': base64.b64encode(payload).decode(), 'signature': signature.decode()}))
        self.assert_invalid_plan(lambda plan: plan.update(issuedAt=1e300))


    def test_real_serialized_gateway_size_and_cli(self):
        payload = check.canonical(self.plan)
        signature = self.sign(payload)
        padding = 8192 - len(payload)
        padded = payload + b' ' * padding
        wire = client.submission(padded, self.sign(padded))
        request = json.loads(wire)
        self.assertLessEqual(len(wire), 32768)
        self.assertLessEqual(len(request['content'].encode()), 16000)
        self.assertEqual(check.decode_message(request['content'].encode())[0], padded)
        with self.assertRaises(ValueError):
            client.submission(padded + b' ', signature)
        with self.assertRaises(check.Rejected):
            check.decode_message(b' ' * 16001)
        with self.assertRaises(check.Rejected):
            check.decode_message(check.canonical({'kind': 'show-tools-peripheral-signed-action-v1',
                'payloadBase64': base64.b64encode(padded + b' ').decode(), 'signature': signature.decode()}))
        plan_path = self.root / ('plan-' + self.plan['nonce'] + '.json')
        plan_path.write_bytes(payload)
        self.addCleanup(plan_path.unlink)
        result = subprocess.run(['/usr/bin/python3', '-I', str(ROOT / 'sign.py'), '--plan', str(plan_path),
                                 '--key', str(self.key)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        actual_request = json.loads(result.stdout)
        self.assertEqual(actual_request['op'], 'submit')
        self.candidate(actual_request['content'].encode())


    def test_inspect_repeat_claim_once_outcome_and_crash_reconciliation(self):
        path = self.ledger()
        report = self.candidate()
        for _ in range(2):
            self.assertEqual(self.event(path, 'inspect', report)['outcome'], 'inspected')
        self.assertEqual(self.event(path, 'claim', report)['outcome'], 'claimed')
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', report)
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', report)
        self.assertEqual(self.event(path, 'record', outcome='running', evidence='1' * 64)['outcome'], 'running')
        self.assertEqual(self.event(path, 'record', outcome='uncertain', evidence='2' * 64)['outcome'], 'uncertain')
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', report)
        with self.assertRaises(check.Rejected):
            self.event(path, 'record', outcome='completed', evidence='3' * 64)
        self.event(path, 'inspect', report)
        self.assertNotIn(b'payloadBase64', path.read_bytes())
        self.assertNotIn(b'archive', path.read_bytes())


    def test_same_nonce_new_id_and_same_id_changed_payload_cannot_claim(self):
        path = self.ledger()
        report = self.candidate()
        self.event(path, 'claim', report)
        plan = dict(self.plan, requestId='another-id')
        other = self.candidate(self.message(plan), request_id=plan['requestId'])
        with path.open('r+b', buffering=0) as stream:
            with self.assertRaises(check.Rejected):
                check.ledger_event(stream, plan['requestId'], 'claim', other, self.now)
        plan = dict(self.plan, action='peripheral-stop', nonce=os.urandom(16).hex())
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', self.candidate(self.message(plan)))


    def test_concurrent_claims_only_one_succeeds(self):
        path = self.ledger()
        report = self.candidate()
        def claim():
            try:
                self.event(path, 'claim', report)
                return True
            except check.Rejected:
                return False
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            self.assertEqual(sum(executor.map(lambda _: claim(), range(6))), 1)

    def test_completed_requires_running_and_changed_assignment_does_not_execute(self):
        path = self.ledger()
        self.event(path, 'claim', self.candidate())
        with self.assertRaisesRegex(check.Rejected, 'durable running'):
            self.event(path, 'record', outcome='completed', evidence='1' * 64)
        self.event(path, 'record', outcome='running', evidence='1' * 64)
        self.assertEqual(self.event(path, 'record', outcome='completed', evidence='2' * 64)['outcome'], 'completed')


    def test_audit_empty_partial_tail_replacement_full_failure_and_unknown_outcome(self):
        report = self.candidate()
        for content in (b'', b'{', b'{}\n'):
            path = self.ledger()
            path.write_bytes(content)
            with self.assertRaises(check.Rejected):
                self.event(path, 'claim', report)
        path = self.ledger()
        with self.assertRaises(check.Rejected):
            self.event(path, 'record', outcome='completed', evidence='1' * 64)
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', report, limit=len(path.read_bytes()))
        replacement = path.with_name('replacement')
        replacement.write_bytes(path.read_bytes())
        replacement.replace(path)
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', report)
        path = self.ledger()
        with path.open('r+b', buffering=0) as stream:
            with patch.object(check.os, 'fsync', side_effect=OSError('fixture failed fsync')):
                with self.assertRaises(OSError):
                    check.ledger_event(stream, self.plan['requestId'], 'claim', report, self.now)
        with self.assertRaises(check.Rejected):
            self.event(path, 'claim', report)


    def test_revocation_is_checked_after_claim_and_before_mutation(self):
        path = self.ledger()
        report = self.candidate()
        self.event(path, 'claim', report)
        inactive = dict(self.grant, active=False, version=2)
        with self.assertRaises(check.Rejected):
            self.candidate(grant=check.canonical(inactive))
        self.event(path, 'record', outcome='blocked', evidence='1' * 64)


    def test_missing_ledger_is_not_recreated(self):
        path = self.ledger()
        path.unlink()
        with patch.object(check, 'LEDGER', path):
            with self.assertRaises((check.Rejected, FileNotFoundError)):
                check.open_ledger()
        self.assertFalse(path.exists())


    def test_protected_file_symlink_and_writable_ancestry(self):
        directory = tempfile.TemporaryDirectory(prefix='show-tools-protected-fixture-', dir=str(Path(tempfile.gettempdir()).resolve()))
        self.addCleanup(directory.cleanup)
        path = Path(directory.name) / 'frozen'
        path.write_bytes(b'fixture')
        path.chmod(0o644)
        original_lstat, original_fstat = Path.lstat, os.fstat
        def root_lstat(value, *args, **kwargs):
            info = original_lstat(value, *args, **kwargs)
            values = list(info)
            values[4] = values[5] = 0
            if stat.S_ISDIR(info.st_mode):
                values[0] = stat.S_IFDIR | 0o755
            return os.stat_result(values)
        def root_fstat(fd):
            values = list(original_fstat(fd))
            values[4] = values[5] = 0
            return os.stat_result(values)
        with patch.object(check.Path, 'lstat', root_lstat), patch.object(check.os, 'fstat', root_fstat):
            self.assertEqual(check.protected_file(path, 100), b'fixture')
            link = path.with_name('symlink')
            link.symlink_to(path)
            with self.assertRaises(OSError):
                check.protected_file(link, 100)
            def writable(value, *args, **kwargs):
                info = root_lstat(value, *args, **kwargs)
                values = list(info)
                if value == path.parent:
                    values[0] |= 0o020
                return os.stat_result(values)
            with patch.object(check.Path, 'lstat', writable):
                with self.assertRaises(check.Rejected):
                    check.protected_file(path, 100)
            os.link(path, path.with_name('hardlink'))
            with self.assertRaises(check.Rejected):
                check.protected_file(path, 100)


    def test_private_ledger_permissions_symlink_hardlink_and_missing(self):
        path = self.ledger()
        report = self.candidate()
        real_lstat, real_fstat = Path.lstat, os.fstat
        def metadata(value, *args, **kwargs):
            info = real_lstat(value, *args, **kwargs)
            values = list(info)
            if stat.S_ISDIR(info.st_mode):
                values[0] = stat.S_IFDIR | (0o700 if value == path.parent else 0o755)
                values[4] = values[5] = 1000 if value == path.parent else 0
            return os.stat_result(values)
        def owner(fd):
            values = list(real_fstat(fd))
            values[4] = values[5] = 1000
            return os.stat_result(values)
        with patch.object(check, 'LEDGER', path), patch.object(Path, 'lstat', metadata), patch.object(os, 'fstat', owner):
            with check.open_ledger() as stream:
                check.ledger_event(stream, self.plan['requestId'], 'inspect', report, self.now)
            path.chmod(0o644)
            with self.assertRaises(check.Rejected):
                check.open_ledger()
            path.chmod(0o600)
            other = path.with_name('hardlink')
            os.link(path, other)
            with self.assertRaises(check.Rejected):
                check.open_ledger()
            other.unlink()
            original = path.with_name('original')
            path.rename(original)
            path.symlink_to(original)
            with self.assertRaises(OSError):
                check.open_ledger()
            path.unlink()
            with self.assertRaises(FileNotFoundError):
                check.open_ledger()
            self.assertFalse(path.exists())


    def test_production_claim_rechecks_after_waiting_for_lock(self):
        raw = self.message()
        for cause in ('valid', 'expired', 'revoked', 'changed-grant'):
            with self.subTest(cause=cause):
                path = self.ledger()
                now = [self.now]
                current_grant = [self.grant_raw]
                waiting = threading.Event()
                errors = []
                output = io.StringIO()
                real_flock = check.fcntl.flock
                def acquire(fd, operation):
                    if operation == check.fcntl.LOCK_EX:
                        waiting.set()
                    return real_flock(fd, operation)
                def protected(filename, limit):
                    return {check.CHECKER: self.checker, check.GRANT: current_grant[0], check.SIGNERS: self.signer}[filename]
                def run():
                    try:
                        check.main(['claim', self.plan['requestId']])
                    except Exception as error:
                        errors.append(error)
                with path.open('r+b', buffering=0) as held:
                    real_flock(held.fileno(), check.fcntl.LOCK_EX)
                    with patch.object(check, 'CHECKER', Path(check.__file__)), patch.object(check, 'SIGNERS', self.signer_path), patch.object(check, 'protected_file', protected), patch.object(check, 'open_ledger', lambda: path.open('r+b', buffering=0)), patch.object(check, 'validate_ledger_fd'), patch.object(check.os, 'getuid', return_value=1000), patch.object(check.os, 'geteuid', return_value=1000), patch.object(check.os, 'getgid', return_value=1000), patch.object(check.os, 'getegid', return_value=1000), patch.object(check.socket, 'gethostname', return_value='proxmox'), patch.object(check.time, 'time', lambda: now[0]), patch.object(check.fcntl, 'flock', acquire), patch.object(check.sys, 'stdin', types.SimpleNamespace(buffer=io.BytesIO(raw))), patch.object(check.sys, 'stdout', output):
                        worker = threading.Thread(target=run)
                        worker.start()
                        self.assertTrue(waiting.wait(2), 'claimant did not reach the held ledger lock')
                        if cause == 'expired':
                            now[0] = self.plan['expiresAt'] + 1
                        elif cause == 'revoked':
                            current_grant[0] = check.canonical(dict(self.grant, active=False, version=2))
                        elif cause == 'changed-grant':
                            current_grant[0] = check.canonical(dict(self.grant, version=2))
                        real_flock(held.fileno(), check.fcntl.LOCK_UN)
                        worker.join(5)
                        self.assertFalse(worker.is_alive())
                rows = [json.loads(line) for line in path.read_bytes().splitlines()[1:]]
                if cause == 'valid':
                    self.assertEqual(errors, [])
                    self.assertEqual([row['operation'] for row in rows], ['claim'])
                    self.assertEqual(json.loads(output.getvalue())['receipt']['outcome'], 'claimed')
                else:
                    self.assertEqual(len(errors), 1)
                    self.assertIsInstance(errors[0], check.Rejected)
                    self.assertEqual(str(errors[0]), {'expired': 'stale or future request',
                        'revoked': 'grant inactive', 'changed-grant': 'current grant mismatch'}[cause])
                    self.assertEqual([row['operation'] for row in rows], ['deny'])

