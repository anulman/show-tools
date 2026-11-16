"""Owned filesystem and actual frozen ledger fixtures; no target operations."""
import base64
from contextlib import ExitStack
from dataclasses import replace
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


def imported(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


runner = imported('activation_runner', SCRIPTS / 'activate-session-release-admission.py')
fixtures = imported('existing_admission_fixtures', SCRIPTS / 'tests/stage-session-release-admission.test.py')
common = vars(fixtures.runner)
status_real = imported('actual_status_dependency', SCRIPTS / 'status-session-release-admission.py')


def request(kind='stop-old-web'):
    before = kind in ('stop-old-web', 'install-v2-profile')
    plan = {'kind': kind, 'action': runner.KINDS[kind], 'targetId': common['TARGET'], 'sourceRevision': runner.SOURCE,
            'archive': runner.ARCHIVE, 'artifactManifestSha256': runner.MANIFEST_SHA256,
            'commonSha256': runner.COMMON_SHA256, 'statusSourceSha256': runner.STATUS_SHA256,
            'executorSha256': runner.EXECUTOR_SHA256, 'validatorSha256': runner.VALIDATOR_SHA256,
            'effects': runner.EFFECTS[kind], 'cliSha256Meaning': 'preserved-global-wrapper-not-executed',
            'protected': {'checkerSha256': common['CHECKER_SHA256'], 'grantSha256': common['GRANT_SHA256'],
                          'signersSha256': common['SIGNERS_SHA256']}}
    plan_bytes = json.dumps(plan).encode()
    now = int(time.time())
    pins = {'schemaVersion': 1, 'action': plan['action'], 'targetId': plan['targetId'], 'requestId': 'activation-fixture-001',
            'nonce': 'a' * 32, 'grantId': 'show-tools-host-user-v1', 'grantVersion': 1, 'grantSha256': common['GRANT_SHA256'],
            'sourceRevision': runner.SOURCE, 'archive': runner.ARCHIVE, 'planSha256': runner.sha(plan_bytes),
            'profileSha256': runner.OLD_PROFILE if before else runner.NEW_PROFILE,
            'unitSha256': runner.OLD_UNIT if before else runner.NEW_UNIT, 'cliSha256': runner.WRAPPER_SHA256,
            'audioAssignmentSha256': '60dd431db3a1f06ee59ad944d51984bacf7a5449e2d01646c9da0fa9c1645afe',
            'evidence': [{'kind': 'artifact-manifest', 'sha256': runner.MANIFEST_SHA256}], 'issuedAt': now, 'expiresAt': now + 900}
    return encoded(pins, plan), plan_bytes


def encoded(pins, plan):
    plan_bytes = json.dumps(plan).encode()
    pins = dict(pins, planSha256=runner.sha(plan_bytes))
    payload = json.dumps(pins).encode()
    envelope = json.dumps({'kind': 'show-tools-signed-action-v1', 'payloadBase64': base64.b64encode(payload).decode(),
                           'signature': 'TEST FIXTURE ONLY; NOT HOST AUTHORIZATION'}).encode()
    return runner.Request.decode(envelope, plan_bytes, common)


STATUS = vars(status_real)


class FakeChecker(fixtures.FakeChecker):
    def call(self, *args, **kwargs):
        report = super().call(*args, **kwargs)
        report['receipt']['action'] = self.request.pins['action']
        return report


class Evidence:
    def __init__(self): self.items = {}
    def put(self, name, value):
        if name in self.items: raise RuntimeError('Evidence overwrite refused')
        self.items[name] = value
        return runner.sha(json.dumps(value, sort_keys=True).encode())


class Effects:
    def __init__(self, fail=None): self.snapshots, self.calls, self.fail = 0, [], fail
    def preflight(self):
        self.snapshots += 1
        return {'state': self.snapshots if self.fail == 'drift' else 'fixed'}
    def apply(self, barrier, evidence):
        barrier()
        self.calls.append('effect')
        if self.fail == 'effect': raise RuntimeError('Admitted effect failed')
        return {'effect': True}
    def readback(self):
        if self.fail == 'readback': raise RuntimeError('Readback failed')
        return {'readback': True}


class AdmissionTests(unittest.TestCase):
    def test_all_four_fixed_operations_decode_and_complete(self):
        for kind in runner.KINDS:
            with self.subTest(kind=kind):
                req, _ = request(kind); effects, evidence = Effects(), Evidence(); checker = FakeChecker(req)
                result = runner.execute(req, effects, checker, evidence, STATUS, common)
                self.assertEqual(result['outcome'], 'completed')
                self.assertEqual(effects.calls, ['effect'])
                self.assertTrue(all(row['action'] == req.pins['action'] for row in checker.rows))
                self.assertEqual(checker.envelopes, [req.envelope] * len(checker.envelopes))

    def test_actual_action_aware_protocol_and_frozen_ledger_complete_each_kind(self):
        with tempfile.TemporaryDirectory() as directory:
            for index, kind in enumerate(runner.KINDS):
                with self.subTest(kind=kind):
                    req, _ = request(kind)
                    frozen = fixtures.FrozenLedgerChecker(req, Path(directory) / str(index))
                    transport = dict(common)
                    def process(argv, data=b'', seconds=10):
                        operation = argv[3]
                        self.assertEqual(data, b'' if operation == 'record' else req.envelope)
                        report = frozen.call(operation, argv[5] if operation == 'record' else None,
                                             argv[6] if operation == 'record' else None)
                        return json.dumps(report).encode()
                    transport['bounded_process'] = process
                    checker = status_real.RequestChecker(req, transport)
                    checker.request_rows = frozen.request_rows
                    try:
                        result = runner.execute(req, Effects(), checker, Evidence(), STATUS, common)
                        self.assertEqual(result['outcome'], 'completed')
                        self.assertEqual(frozen.request_rows()[-1]['outcome'], 'completed')
                    finally: frozen.close()

    def test_wrong_action_target_source_archive_and_declared_effects_are_refused(self):
        req, _ = request()
        for change in ('kind', 'action', 'targetId', 'sourceRevision', 'archive', 'effects', 'cliSha256Meaning', 'commonSha256'):
            with self.subTest(change=change):
                plan = dict(req.plan); plan[change] = 'wrong'
                with self.assertRaises((RuntimeError, TypeError)): encoded(req.pins, plan)

    def test_payload_pins_are_not_reinterpreted_as_new_cli_wrapper(self):
        req, _ = request('start-v2-web')
        for key in ('profileSha256', 'unitSha256', 'cliSha256'):
            with self.subTest(key=key), self.assertRaises(RuntimeError):
                encoded(dict(req.pins, **{key: '0' * 64}), req.plan)

    def test_foreign_existing_claim_is_not_terminalized(self):
        req, _ = request(); checker = FakeChecker(req); checker.call('claim'); before = tuple(checker.rows)
        result = runner.execute(req, Effects(), checker, Evidence(), STATUS, common)
        self.assertEqual(result['outcome'], 'blocked-preclaim')
        self.assertEqual(tuple(checker.rows[:1]), before)
        self.assertFalse(any(op == 'record' for op, _ in checker.calls))

    def test_preclaim_state_drift_prevents_claim_and_effect(self):
        req, _ = request(); checker = FakeChecker(req); effects = Effects('drift')
        result = runner.execute(req, effects, checker, Evidence(), STATUS, common)
        self.assertEqual(result['outcome'], 'blocked-preclaim')
        self.assertEqual(effects.calls, [])
        self.assertFalse(any(op == 'claim' for op, _ in checker.calls))

    def test_inspection_rejection_at_effect_barrier_prevents_effect(self):
        req, _ = request(); checker = FakeChecker(req, failure=5); effects = Effects()
        result = runner.execute(req, effects, checker, Evidence(), STATUS, common)
        self.assertEqual(result['outcome'], 'uncertain')
        self.assertEqual(effects.calls, [])
        self.assertTrue(result['claimVerifiedByThisInvocation'])

    def test_effect_and_readback_failures_preserve_uncertain_owned_claim(self):
        for failure in ('effect', 'readback'):
            with self.subTest(failure=failure):
                req, _ = request(); checker = FakeChecker(req)
                result = runner.execute(req, Effects(failure), checker, Evidence(), STATUS, common)
                self.assertEqual(result['outcome'], 'uncertain')
                self.assertEqual(checker.rows[-1]['outcome'], 'uncertain')

    def test_terminal_denial_or_conflicting_row_after_running_prevents_all_effects(self):
        for mode in ('terminal', 'denied', 'foreign-binding'):
            with self.subTest(mode=mode):
                req, _ = request(); checker, effects = FakeChecker(req), Effects()
                original = effects.preflight
                def snapshot():
                    result = original()
                    if effects.snapshots == 3:
                        bad = dict(checker.rows[-1])
                        if mode == 'terminal': bad.update(operation='record', outcome='uncertain', evidenceSha256='f' * 64)
                        elif mode == 'denied': bad.update(operation='deny', outcome='denied')
                        else: bad.update(operation='inspect', outcome='inspected', evidenceSha256=None, payloadSha256='b' * 64)
                        checker.rows.append(bad)
                    return result
                effects.preflight = snapshot
                result = runner.execute(req, effects, checker, Evidence(), STATUS, common)
                self.assertEqual(result['outcome'], 'uncertain')
                self.assertEqual(effects.calls, [])
                self.assertIn('terminalRecordWithheld', result)
                self.assertEqual([value for op, value in checker.calls if op == 'record'], ['running'])

    def test_completed_transport_failure_never_attempts_second_terminal(self):
        req, _ = request(); checker = FakeChecker(req, terminal_applied=True)
        result = runner.execute(req, Effects(), checker, Evidence(), STATUS, common)
        self.assertEqual(result['outcome'], 'uncertain')
        self.assertTrue(result['terminalAttempted'])
        self.assertEqual([outcome for op, outcome in checker.calls if op == 'record'], ['running', 'completed'])
        self.assertEqual(checker.rows[-1]['outcome'], 'completed')

    def test_actual_frozen_ledger_preserves_foreign_and_lost_claim(self):
        with tempfile.TemporaryDirectory() as directory:
            for mode in ('foreign', 'lost'):
                with self.subTest(mode=mode):
                    req, _ = request(); checker = fixtures.FrozenLedgerChecker(req, Path(directory) / mode, lose_claim_reply=mode == 'lost')
                    try:
                        if mode == 'foreign': checker.call('claim')
                        result = runner.execute(req, Effects(), checker, Evidence(), STATUS, common)
                        self.assertFalse(result['claimVerifiedByThisInvocation'])
                        self.assertFalse(any(op == 'record' for op, _ in checker.calls))
                        self.assertEqual(sum(row['operation'] == 'claim' for row in checker.request_rows()), 1)
                    finally: checker.close()


class FilesystemTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='web-activation-fixture-')
        self.root = Path(self.temp.name).resolve(); self.addCleanup(self.temp.cleanup)
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.owner = (os.getuid(), os.getgid())
        if not callable(getattr(os, 'listxattr', None)):
            self.stack.enter_context(patch.object(fixtures.runner, 'no_acl', lambda _fd: None))
        self.stack.enter_context(patch.object(runner, 'OWNER', self.owner))
        self.local = dict(common)
        capture = common['capture']
        self.local['capture'] = lambda path, maximum, owner, modes: capture(path, maximum, self.owner, modes)
        self.path = self.root / 'session.json'; self.candidate = self.root / 'candidate.json'
        self.path.write_bytes(b'old exact bytes'); self.path.chmod(0o600)
        self.candidate.write_bytes(b'new exact bytes'); self.candidate.chmod(0o600)
        self.unit, self.candidate_unit = self.root / 'web.service', self.root / 'candidate.service'
        self.unit.write_bytes(b'old unit'); self.unit.chmod(0o600)
        self.candidate_unit.write_bytes(b'new unit'); self.candidate_unit.chmod(0o600)
        for name, value in {'PROFILE': self.path, 'UNIT': self.unit, 'OLD_PROFILE': runner.sha(self.path.read_bytes()),
                            'NEW_PROFILE': runner.sha(self.candidate.read_bytes()), 'OLD_UNIT': runner.sha(self.unit.read_bytes()),
                            'NEW_UNIT': runner.sha(self.candidate_unit.read_bytes())}.items():
            self.stack.enter_context(patch.object(runner, name, value))
        req, _ = request('install-v2-profile')
        self.runtime = runner.Runtime(req, self.local, {}, {}, None, None, self.candidate, self.candidate, self.root / 'evidence')
        self.runtime.service = lambda active: {'inactive': not active}

    def test_atomic_replacement_keeps_exact_old_backup_and_durable_new_bytes(self):
        evidence, barriers = Evidence(), []
        result = self.runtime.replace(self.path, runner.sha(self.path.read_bytes()), self.candidate,
                                      runner.sha(self.candidate.read_bytes()), 'profile', lambda: barriers.append(True), evidence)
        self.assertEqual(self.path.read_bytes(), b'new exact bytes')
        self.assertEqual(self.path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(base64.b64decode(evidence.items['profile-retained.json']['bytesBase64']), b'old exact bytes')
        self.assertEqual(len(barriers), 2)
        self.assertEqual(result['sha256'], runner.sha(b'new exact bytes'))

    def test_foreign_target_or_symlink_never_replaced(self):
        for mode in ('different', 'symlink'):
            with self.subTest(mode=mode):
                target = self.root / mode
                if mode == 'different': target.write_bytes(b'foreign'); target.chmod(0o600)
                else: target.symlink_to(self.path)
                with self.assertRaises((RuntimeError, OSError)):
                    self.runtime.replace(target, runner.sha(b'expected'), self.candidate,
                                         runner.sha(self.candidate.read_bytes()), mode, lambda: None, Evidence())
                self.assertEqual(self.path.read_bytes(), b'old exact bytes')

    def test_revocation_before_rename_retains_old_target_and_exact_temporary(self):
        count = 0
        def barrier():
            nonlocal count
            count += 1
            if count == 2: raise RuntimeError('revoked before rename')
        with self.assertRaisesRegex(RuntimeError, 'revoked'):
            self.runtime.replace(self.path, runner.sha(self.path.read_bytes()), self.candidate,
                                 runner.sha(self.candidate.read_bytes()), 'profile', barrier, Evidence())
        self.assertEqual(self.path.read_bytes(), b'old exact bytes')
        temporary = self.root / '.show-tools-activation-fixture-001-profile'
        self.assertEqual(temporary.read_bytes(), b'new exact bytes')

    def test_database_symlink_and_unsafe_mode_are_refused(self):
        for mode in ('symlink', 'unsafe'):
            with self.subTest(mode=mode):
                target = self.root / mode
                if mode == 'symlink': target.symlink_to(self.path)
                else: target.write_bytes(b'data'); target.chmod(0o640)
                with self.assertRaises((RuntimeError, OSError)): self.runtime.metadata(target)

    def test_absence_does_not_follow_or_adopt_intervening_symlink(self):
        target = self.root / 'absent'
        self.assertTrue(self.runtime.absent(target))
        target.symlink_to(self.root / 'not-created')
        with self.assertRaisesRegex(RuntimeError, 'Expected absent'): self.runtime.absent(target)

    def test_bad_source_hash_never_executes_source(self):
        marker = self.root / 'marker'
        source = self.root / 'source.py'; source.write_text(f'from pathlib import Path\nPath({str(marker)!r}).write_text("executed")\n'); source.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'digest differs'): runner.loaded(source, '0' * 64, self.local)
        self.assertFalse(marker.exists())

    def test_manager_override_rejection_reports_no_secret_value(self):
        self.runtime.command = lambda argv: 'PATH=/usr/bin:/bin\nNODE_OPTIONS=SECRET-VALUE'
        with self.assertRaisesRegex(RuntimeError, 'NODE_OPTIONS') as error: self.runtime.manager_environment()
        self.assertNotIn('SECRET-VALUE', str(error.exception))

    def configure_fixture(self):
        unit, candidate_unit = self.root / 'web.service', self.root / 'candidate.service'
        unit.write_bytes(b'old unit'); unit.chmod(0o600)
        candidate_unit.write_bytes(b'new unit'); candidate_unit.chmod(0o600)
        for name, value in {'PROFILE': self.path, 'UNIT': unit, 'OLD_PROFILE': runner.sha(self.path.read_bytes()),
                            'NEW_PROFILE': runner.sha(self.candidate.read_bytes()), 'OLD_UNIT': runner.sha(unit.read_bytes()),
                            'NEW_UNIT': runner.sha(candidate_unit.read_bytes())}.items():
            self.stack.enter_context(patch.object(runner, name, value))
        self.runtime.candidate_unit = candidate_unit
        self.runtime.protected = self.runtime.persistence = self.runtime.credential_metadata = lambda: {'preserved': True}
        self.runtime.pending_profile, self.runtime.pending_unit = runner.OLD_PROFILE, runner.OLD_UNIT
        return unit, candidate_unit

    def test_configure_transitions_profile_then_unit_and_never_enables(self):
        unit, candidate_unit = self.configure_fixture()
        calls = []
        self.runtime.command = lambda argv: calls.append(argv) or ''
        effects = self.runtime.apply(lambda: calls.append('inspect'), Evidence())
        self.assertEqual(self.path.read_bytes(), self.candidate.read_bytes())
        self.assertEqual(unit.read_bytes(), candidate_unit.read_bytes())
        self.assertEqual(self.runtime.pending_profile, runner.NEW_PROFILE)
        self.assertEqual(self.runtime.pending_unit, runner.NEW_UNIT)
        self.assertTrue(effects['daemonReloaded'])
        commands = [item for item in calls if isinstance(item, list)]
        self.assertEqual(commands, [['/usr/bin/systemctl', '--user', 'daemon-reload']])

    def test_second_configure_failure_preserves_first_publication_and_old_unit(self):
        unit, _ = self.configure_fixture()
        original = self.runtime.replace
        def fail_second(path, *args):
            if path == unit: raise RuntimeError('second publication failed')
            return original(path, *args)
        self.runtime.replace = fail_second
        evidence = Evidence()
        with self.assertRaisesRegex(RuntimeError, 'second publication'):
            self.runtime.apply(lambda: None, evidence)
        self.assertEqual(self.path.read_bytes(), self.candidate.read_bytes())
        self.assertEqual(unit.read_bytes(), b'old unit')
        self.assertIn('profile-retained.json', evidence.items)

    def test_changed_first_profile_blocks_second_publication_and_records_uncertain(self):
        unit, _ = self.configure_fixture()
        self.runtime.preflight = lambda: {'stablePreclaim': True}
        self.runtime.failure_snapshot = lambda: {'profile': self.path.read_bytes().decode(), 'unit': unit.read_bytes().decode()}
        req = self.runtime.request
        checker = FakeChecker(req)
        original, inspections = checker.call, 0
        def call(operation, *args):
            nonlocal inspections
            report = original(operation, *args)
            if operation == 'inspect':
                inspections += 1
                if inspections == 6: self.path.write_bytes(b'operator changed profile')
            return report
        checker.call = call
        evidence = Evidence()
        result = runner.execute(req, self.runtime, checker, evidence, STATUS, common)
        self.assertEqual(result['outcome'], 'uncertain')
        self.assertEqual(checker.rows[-1]['outcome'], 'uncertain')
        self.assertEqual(self.path.read_bytes(), b'operator changed profile')
        self.assertEqual(unit.read_bytes(), b'old unit')
        self.assertIn('profile-retained.json', evidence.items)
        self.assertIn('unit-retained.json', evidence.items)

    def test_initialization_refuses_existing_database_or_sidecar(self):
        database = self.root / 'bindings.sqlite'
        with patch.object(runner, 'DATABASE', database):
            self.runtime.db_absent()
            for suffix in ('', '-journal', '-wal', '-shm'):
                path = Path(str(database) + suffix); path.write_bytes(b'intervening'); path.chmod(0o600)
                with self.subTest(suffix=suffix), self.assertRaisesRegex(RuntimeError, 'Expected absent'):
                    self.runtime.db_absent()
                path.unlink()

    def test_backup_failure_does_not_delete_database_or_published_backup(self):
        database, backups = self.root / 'bindings.sqlite', self.root / 'backups'
        backup = backups / 'initial.sqlite'
        database.write_bytes(b'original database'); database.chmod(0o600)
        for name, value in {'DATABASE': database, 'BACKUPS': backups, 'BACKUP': backup}.items():
            self.stack.enter_context(patch.object(runner, name, value))
        self.runtime.kind = 'initial-bindings-backup'
        self.runtime.protected = self.runtime.persistence = self.runtime.credential_metadata = lambda: {}
        self.runtime.ensure_off = lambda: {'audio': {'kind': 'off'}}
        self.runtime.verify_db = lambda path: {'metadata': self.runtime.metadata(path)}
        def command(argv, seconds=15):
            self.assertEqual(argv, runner.CLI_PREFIX + ['bindings', 'backup', '--profile', str(runner.PROFILE), '--output', str(backup)])
            backup.write_bytes(b'published snapshot'); backup.chmod(0o600)
            raise RuntimeError('command failed after publication')
        self.runtime.command = command
        with self.assertRaisesRegex(RuntimeError, 'after publication'):
            self.runtime.apply(lambda: None, Evidence())
        self.assertEqual(database.read_bytes(), b'original database')
        self.assertEqual(backup.read_bytes(), b'published snapshot')
        self.assertEqual(backups.stat().st_mode & 0o777, 0o700)

    def test_protected_system_path_symlinks_are_accepted_without_mutation(self):
        self.runtime.command = lambda argv: 'PATH=/usr/bin:/bin'
        self.assertEqual(self.runtime.manager_environment(), {'forbiddenRuntimeOverrides': False, 'pathDirectories': 2})

    def test_audio_off_only_is_a_disruptive_precondition(self):
        for kind in ('off', 'ready', 'fault', 'enabling'):
            self.runtime.capture = lambda *args, **kwargs: (b'{}', ())
            self.runtime.status = {'read_status': lambda *args: {'audio': {'kind': kind}}}
            if kind == 'off': self.assertEqual(self.runtime.ensure_off()['audio']['kind'], 'off')
            else:
                with self.assertRaisesRegex(RuntimeError, 'audio-off'): self.runtime.ensure_off()


if __name__ == '__main__': unittest.main()
