"""Protocol fixtures and owned files/children only. No installed checker or host action."""
import base64
from dataclasses import dataclass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'stage-session-release-admission.py'
spec = importlib.util.spec_from_file_location('admission_runner', SOURCE)
runner = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = runner
spec.loader.exec_module(runner)


def fixture_request():
    archive = {'url': 'http://100.91.87.3:18742/show-tools-session-release-4ecf9c3.tar.gz',
               'bytes': 52667083, 'sha256': 'ba8b782de892510e2befa904409cd10edfb8db100e54e6b8b3b8cb77db7490a4',
               'root': 'show-tools-session-release-4ecf9c3', 'installRelease': str(runner.ROOT / 'releases/session-4ecf9c3')}
    plan = {'action': 'stage', 'targetId': runner.TARGET, 'sourceRevision': '4ecf9c3ee866b20c115d73d93f45816f24b0925e',
            'archive': archive, 'protected': {'checkerSha256': runner.CHECKER_SHA256,
            'grantSha256': runner.GRANT_SHA256, 'signersSha256': runner.SIGNERS_SHA256},
            'currentFiles': {path: value[0] for path, value in runner.CURRENT_FILES.items()},
            'stagingHelperSha256': runner.VALIDATOR_SHA256, 'artifactManifestSha256': '5eed1f37f63848ddf3ffd44e807db43fb436750f4fe30f9b8a19613912eaeed7',
            'expectedAccounting': {'files': 622, 'manifestRecords': 620, 'rawHeaders': 1502, 'expandedBytes': 168807424}}
    plan_bytes = json.dumps(plan, indent=2).encode()
    now = int(time.time())
    payload = json.dumps({'schemaVersion': 1, 'action': 'stage', 'targetId': runner.TARGET, 'requestId': 'fixture-stage-1', 'nonce': 'a' * 32,
                          'grantId': 'show-tools-host-user-v1', 'grantSha256': runner.GRANT_SHA256, 'grantVersion': 1,
                          'planSha256': runner.sha(plan_bytes), 'sourceRevision': plan['sourceRevision'], 'archive': archive,
                          'profileSha256': runner.CURRENT_FILES['/home/anulman/.config/show-tools/session.json'][0],
                          'unitSha256': runner.CURRENT_FILES['/home/anulman/.config/systemd/user/show-tools-web.service'][0],
                          'cliSha256': runner.CURRENT_FILES['/home/anulman/.local/bin/show-tools-session'][0],
                          'audioAssignmentSha256': '60dd431db3a1f06ee59ad944d51984bacf7a5449e2d01646c9da0fa9c1645afe',
                          'evidence': [{'kind': 'artifact-manifest', 'sha256': plan['artifactManifestSha256']}],
                          'issuedAt': now, 'expiresAt': now + 900}, indent=3).encode()
    envelope = json.dumps({'kind': 'show-tools-signed-action-v1', 'payloadBase64': base64.b64encode(payload).decode(),
                           'signature': 'TEST PROTOCOL FIXTURE; NO INSTALLED AUTHORIZATION'}, indent=1).encode()
    return runner.CapturedRequest.decode(envelope, plan_bytes), plan_bytes


def frozen_checker():
    source = Path(__file__).resolve().parents[2] / 'lib/remote-performance/delegation/check.py'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == runner.CHECKER_SHA256
    spec = importlib.util.spec_from_file_location('actual_frozen_ledger_fixture', source)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class FakeChecker:
    def __init__(self, request, failure=None, dropped_claim=False, terminal_applied=False):
        self.request, self.failure = request, failure
        self.dropped_claim, self.terminal_applied = dropped_claim, terminal_applied
        self.rows, self.calls, self.envelopes = [], [], []

    def call(self, operation, outcome=None, digest=None):
        self.calls.append((operation, outcome))
        if operation != 'record':
            self.envelopes.append(self.request.envelope)
        if self.failure == len(self.calls):
            raise RuntimeError('synthetic fixed checker rejection, expiry or revocation')
        if operation == 'record' and any(row['outcome'] in ('completed', 'uncertain', 'blocked') for row in self.rows):
            raise RuntimeError('consumed request has terminal outcome')
        if operation == 'record' and not any(row['operation'] == 'claim' for row in self.rows):
            raise RuntimeError('unknown claim')
        if operation == 'record' and outcome == 'running' and any(row['outcome'] == 'running' for row in self.rows):
            raise RuntimeError('duplicate running outcome')
        pins = self.request.pins
        row = {'at': int(time.time()), 'operation': operation, 'requestId': pins['requestId'],
               'payloadSha256': runner.sha(self.request.payload), 'nonce': pins['nonce'], 'grantSha256': pins['grantSha256'],
               'grantVersion': pins['grantVersion'], 'action': 'stage',
               'outcome': {'inspect': 'inspected', 'claim': 'claimed', 'record': outcome}[operation], 'evidenceSha256': digest}
        if operation == 'claim' and any(item['operation'] == 'claim' for item in self.rows):
            self.rows.append({'at': int(time.time()), 'operation': 'deny', 'requestId': pins['requestId'],
                              'payloadSha256': None, 'nonce': None, 'grantSha256': None, 'grantVersion': None,
                              'action': None, 'outcome': 'denied', 'evidenceSha256': None})
            raise RuntimeError('duplicate claim refused')
        self.rows.append(row)
        if operation == 'record':
            if outcome == 'completed' and self.terminal_applied:
                raise RuntimeError('completed record applied but transport failed')
            return {'kind': 'recorded-local-outcome', 'executable': False, 'receipt': row}
        return {'kind': 'authenticated-candidate', 'executable': False, 'hostPreconditions': 'unverified',
                'sshSourceProvenance': 'not-attested', 'checkerSha256': runner.CHECKER_SHA256,
                'payloadSha256': runner.sha(self.request.payload), 'pins': pins, 'receipt': row}

    def request_rows(self):
        return tuple(row for row in self.rows if not (self.dropped_claim and row['operation'] == 'claim'))


class FrozenLedgerChecker:
    """Actual ff28 ledger transitions; authentication is a protocol fixture only."""
    def __init__(self, request, path, *, before_claim=None, lose_claim_reply=False):
        self.request, self.frozen, self.calls = request, frozen_checker(), []
        self.before_claim, self.lose_claim_reply = before_claim, lose_claim_reply
        self.stream = path.open('x+b')
        path.chmod(0o600)
        self.stream.write(self.frozen.canonical(self.frozen.genesis(self.stream.fileno(), int(time.time()))) + b'\n')
        self.stream.flush()
        os.fsync(self.stream.fileno())

    def call(self, operation, outcome=None, digest=None):
        self.calls.append((operation, outcome))
        report = {'kind': 'authenticated-candidate', 'executable': False, 'hostPreconditions': 'unverified',
                  'sshSourceProvenance': 'not-attested', 'checkerSha256': runner.CHECKER_SHA256,
                  'payloadSha256': runner.sha(self.request.payload), 'pins': self.request.pins}
        if operation == 'claim' and self.before_claim is not None:
            self.before_claim(self, report)
        try:
            row = self.frozen.ledger_event(self.stream, self.request.pins['requestId'], operation,
                                           report if operation != 'record' else None, int(time.time()), outcome, digest)
        except Exception:
            if operation != 'record':
                self.frozen.ledger_event(self.stream, self.request.pins['requestId'], 'deny', None, int(time.time()))
            raise
        if operation == 'claim' and self.lose_claim_reply:
            raise RuntimeError('synthetic lost reply after actual claim append')
        if operation == 'record':
            return {'kind': 'recorded-local-outcome', 'executable': False, 'receipt': row}
        return dict(report, receipt=row)

    def request_rows(self):
        self.stream.seek(0)
        rows = [runner.strict_json(line) for line in self.stream.read().splitlines()[1:]]
        return tuple(row for row in rows if row['requestId'] == self.request.pins['requestId'])

    def close(self):
        self.stream.close()


@dataclass(frozen=True)
class ExpectedAdmission:
    payload: bytes
    running_preflight_sha256: str


@dataclass(frozen=True)
class AdmissionObservation:
    inspect_report: dict
    request_rows: tuple
    observed_monotonic_ns: int


@dataclass(frozen=True)
class ReleasePins:
    source: str
    archive_sha256: str
    archive_bytes: int
    manifest_sha256: str


class FakeExecutor:
    def __init__(self, failure=None):
        self.failure, self.published, self.observation = failure, False, None

    def stage(self, _archive, pins, _validator, _root, *, prepublish_guard, admission):
        self.observation = prepublish_guard(admission)
        if self.failure == 'write':
            raise RuntimeError('synthetic incomplete stage write')
        self.published = True
        if self.failure == 'publication':
            raise RuntimeError('synthetic failure after publication')
        return {'status': 'staged-only', 'executablesStarted': False, 'source': pins.source,
                'archiveSha256': pins.archive_sha256, 'manifestSha256': pins.manifest_sha256,
                'prepublishGuardObserved': True, 'requestId': json.loads(admission.payload)['requestId'],
                'payloadSha256': runner.sha(admission.payload)}

    def readback(self, _archive, pins, _validator, _root):
        if self.failure == 'readback':
            raise RuntimeError('synthetic independent readback failure')
        return {'status': 'verified-read-only', 'source': pins.source, 'archiveSha256': pins.archive_sha256,
                'manifestSha256': pins.manifest_sha256, 'validatorSha256': runner.VALIDATOR_SHA256,
                'files': 622, 'manifestRecords': 620, 'rawHeaders': 1502, 'expandedBytes': 168807424}

    def namespace(self):
        return {'ExpectedAdmission': ExpectedAdmission, 'AdmissionObservation': AdmissionObservation,
                'ReleasePins': ReleasePins, 'stage_local_archive': self.stage, 'verify_local_release': self.readback}


class FakePreflight:
    def __init__(self, changed_at=None):
        self.count, self.changed_at = 0, changed_at

    def snapshot(self):
        self.count += 1
        return {'target': 'changed' if self.count == self.changed_at else 'unchanged'}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.request, self.plan_bytes = fixture_request()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()

    def tearDown(self):
        self.temp.cleanup()

    def run_stage(self, checker=None, executor=None, preflight=None, name='evidence'):
        checker = checker or FakeChecker(self.request)
        executor = executor or FakeExecutor()
        evidence = runner.Evidence(self.root / name)
        try:
            result = runner.stage(self.request, self.root / 'archive', self.root / 'validator', executor.namespace(),
                                  checker, preflight or FakePreflight(), evidence)
        finally:
            evidence.close()
        return result, checker, executor

    def test_original_envelope_and_payload_bytes_are_retained(self):
        self.assertNotEqual(self.request.payload, json.dumps(self.request.pins).encode())
        result, checker, executor = self.run_stage()
        self.assertEqual(result['outcome'], 'completed')
        self.assertTrue(executor.published)
        self.assertTrue(all(value == self.request.envelope for value in checker.envelopes))
        self.assertEqual(checker.calls, [('inspect', None), ('claim', None), ('record', 'running'),
                                         ('inspect', None), ('inspect', None), ('record', 'completed')])
        self.assertEqual(executor.observation.request_rows[-1], executor.observation.inspect_report['receipt'])
        recorded = json.loads((self.root / 'evidence/result.json').read_text())
        self.assertEqual(recorded['checkerReceipts'][-1], executor.observation.inspect_report)

    def test_checker_failure_each_phase_never_reports_completion(self):
        for index in range(1, 7):
            checker = FakeChecker(self.request, failure=index)
            with self.subTest(index=index):
                result, checker, executor = self.run_stage(checker=checker, name='failure-' + str(index))
                self.assertNotEqual(result['outcome'], 'completed')
                self.assertEqual(sum(operation == 'claim' for operation, _outcome in checker.calls), 0 if index == 1 else 1)
                if index <= 5:
                    self.assertFalse(executor.published)
                self.assertEqual(result['outcome'], 'blocked-preclaim' if index == 1 else 'uncertain')
                if index == 2:
                    self.assertNotIn(('record', 'uncertain'), checker.calls)
                    self.assertFalse(result['claimVerifiedByThisInvocation'])

    def test_guard_rejects_missing_actual_claim_before_publication(self):
        result, _checker, executor = self.run_stage(checker=FakeChecker(self.request, dropped_claim=True))
        self.assertEqual(result['outcome'], 'uncertain')
        self.assertFalse(executor.published)
        self.assertIn('Observed claim', result['error'])

    def test_target_change_before_claim_and_before_publication(self):
        for count, expected in ((2, 'blocked-preclaim'), (3, 'uncertain'), (4, 'uncertain')):
            with self.subTest(count=count):
                result, checker, executor = self.run_stage(preflight=FakePreflight(count), name='changed-' + str(count))
                self.assertEqual(result['outcome'], expected)
                self.assertFalse(executor.published)
                self.assertEqual(sum(operation == 'claim' for operation, _outcome in checker.calls), 0 if count == 2 else 1)

    def test_write_publication_and_readback_failures_preserve_uncertainty(self):
        for kind in ('write', 'publication', 'readback'):
            with self.subTest(kind=kind):
                result, checker, executor = self.run_stage(executor=FakeExecutor(kind), name='executor-' + kind)
                self.assertEqual(result['outcome'], 'uncertain')
                self.assertEqual(executor.published, kind != 'write')
                self.assertNotIn(('record', 'completed'), checker.calls)
                self.assertIn(('record', 'uncertain'), checker.calls)

    def test_terminal_record_applied_but_transport_failed_is_not_false_success(self):
        checker = FakeChecker(self.request, terminal_applied=True)
        result, checker, executor = self.run_stage(checker=checker)
        self.assertTrue(executor.published)
        self.assertEqual(result['outcome'], 'uncertain')
        self.assertIn('auditError', result)
        self.assertEqual(sum(row['outcome'] == 'completed' for row in checker.rows), 1)
        self.assertEqual(sum(call == ('record', 'completed') for call in checker.calls), 1)

    def test_consumed_request_is_not_reclaimed_or_retried(self):
        checker = FakeChecker(self.request)
        first, checker, _executor = self.run_stage(checker=checker)
        self.assertEqual(first['outcome'], 'completed')
        count = len(checker.calls)
        second, checker, executor = self.run_stage(checker=checker, name='second')
        self.assertEqual(second['outcome'], 'blocked-preclaim')
        self.assertEqual(checker.calls[count:], [('inspect', None)])
        self.assertFalse(executor.published)

    def test_actual_frozen_ledger_preexisting_running_request_is_not_terminalized(self):
        checker = FrozenLedgerChecker(self.request, self.root / 'ledger.ndjson')
        try:
            checker.call('claim')
            checker.call('record', 'running', 'b' * 64)
            count = len(checker.calls)
            result, _checker, executor = self.run_stage(checker=checker)
            self.assertFalse(executor.published)
            self.assertEqual(result['outcome'], 'blocked-preclaim')
            self.assertEqual(checker.calls[count:], [('inspect', None)])
            self.assertEqual([row['outcome'] for row in checker.request_rows()], ['claimed', 'running', 'inspected'])
        finally:
            checker.close()

    def test_actual_frozen_ledger_terminal_requests_remain_unchanged(self):
        for outcome in ('completed', 'blocked', 'uncertain'):
            checker = FrozenLedgerChecker(self.request, self.root / ('ledger-' + outcome))
            try:
                checker.call('claim')
                checker.call('record', 'running', 'b' * 64)
                checker.call('record', outcome, 'c' * 64)
                count = len(checker.calls)
                result, _checker, executor = self.run_stage(checker=checker, name='terminal-' + outcome)
                with self.subTest(outcome=outcome):
                    self.assertEqual(result['outcome'], 'blocked-preclaim')
                    self.assertEqual(checker.calls[count:], [('inspect', None)])
                    self.assertEqual([row['outcome'] for row in checker.request_rows()],
                                     ['claimed', 'running', outcome, 'inspected'])
                    self.assertFalse(executor.published)
            finally:
                checker.close()

    def test_actual_frozen_ledger_concurrent_winner_is_not_terminalized(self):
        def another_caller_wins(checker, report):
            checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'claim', report, int(time.time()))
            checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'record', None, int(time.time()), 'running', 'c' * 64)
        checker = FrozenLedgerChecker(self.request, self.root / 'concurrent-ledger', before_claim=another_caller_wins)
        try:
            result, checker, executor = self.run_stage(checker=checker)
            self.assertEqual(result['outcome'], 'uncertain')
            self.assertFalse(result['claimVerifiedByThisInvocation'])
            self.assertEqual(result['claimReconciliation']['status'], 'new-claim-observed-owner-unconfirmed')
            self.assertEqual(checker.calls, [('inspect', None), ('claim', None)])
            self.assertEqual([row['outcome'] for row in checker.request_rows()], ['inspected', 'claimed', 'running', 'denied'])
            self.assertFalse(executor.published)
        finally:
            checker.close()

    def test_actual_frozen_ledger_lost_claim_reply_is_reconciled_without_audit_ownership(self):
        checker = FrozenLedgerChecker(self.request, self.root / 'lost-reply-ledger', lose_claim_reply=True)
        try:
            result, checker, executor = self.run_stage(checker=checker)
            self.assertEqual(result['outcome'], 'uncertain')
            self.assertFalse(result['claimVerifiedByThisInvocation'])
            self.assertEqual(result['claimReconciliation']['status'], 'new-claim-observed-owner-unconfirmed')
            self.assertFalse(result['claimReconciliation']['terminalRecordAttempted'])
            self.assertEqual(checker.calls, [('inspect', None), ('claim', None)])
            self.assertEqual([row['outcome'] for row in checker.request_rows()], ['inspected', 'claimed'])
            self.assertFalse(executor.published)
        finally:
            checker.close()

    def test_preflight_file_is_durable_and_receipt_digest_matches_actual_bytes(self):
        result, checker, _executor = self.run_stage()
        preflight = (self.root / 'evidence/preflight.json').read_bytes()
        running = next(row for row in checker.rows if row['outcome'] == 'running')
        self.assertEqual(running['evidenceSha256'], hashlib.sha256(preflight).hexdigest())
        self.assertEqual(result['resultSha256'], hashlib.sha256((self.root / 'evidence/result.json').read_bytes()).hexdigest())
        for path in (self.root / 'evidence').iterdir():
            self.assertEqual(path.stat().st_nlink, 1)
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_existing_evidence_and_symlink_are_never_overwritten(self):
        evidence = runner.Evidence(self.root / 'evidence')
        try:
            evidence.put('result.json', {'preserve': True})
            with self.assertRaises(FileExistsError):
                evidence.put('result.json', {'preserve': False})
        finally:
            evidence.close()
        self.assertEqual(json.loads((self.root / 'evidence/result.json').read_text()), {'preserve': True})
        with self.assertRaises(FileExistsError):
            runner.Evidence(self.root / 'evidence')

    def test_wrong_plan_pin_and_duplicate_json_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'Plan pins'):
            runner.CapturedRequest.decode(self.request.envelope, self.plan_bytes + b' ')
        with self.assertRaisesRegex(RuntimeError, 'Duplicate'):
            runner.strict_json(b'{"field":1,"field":2}')
        with self.assertRaisesRegex(RuntimeError, 'Nonfinite'):
            runner.strict_json(b'{"field":1e999}')
        with self.assertRaises((UnicodeError, ValueError)):
            runner.strict_json('{"field":1}'.encode('utf-16'))


class FixedProtocolTests(unittest.TestCase):
    def test_fixture_payload_matches_actual_frozen_checker_schema(self):
        request, _plan = fixture_request()
        root = Path(__file__).resolve().parents[2]
        source = root / 'lib/remote-performance/delegation/check.py'
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(), runner.CHECKER_SHA256)
        checker_spec = importlib.util.spec_from_file_location('frozen_checker_schema_fixture', source)
        checker = importlib.util.module_from_spec(checker_spec)
        checker_spec.loader.exec_module(checker)
        grant = json.loads((source.parent / 'grant.inactive.json').read_text())
        grant['active'] = True
        self.assertEqual(runner.sha((json.dumps(grant, indent=2) + '\n').encode()), runner.GRANT_SHA256)
        checker.validate_payload(request.payload, grant, runner.GRANT_SHA256, request.pins['requestId'], int(time.time()))
        expired = dict(request.pins, issuedAt=int(time.time()) - 901, expiresAt=int(time.time()) - 1)
        with self.assertRaises(checker.Rejected):
            checker.validate_payload(json.dumps(expired).encode(), grant, runner.GRANT_SHA256, request.pins['requestId'], int(time.time()))
        grant['active'] = False
        with self.assertRaises(checker.Rejected):
            checker.validate_payload(request.payload, grant, runner.GRANT_SHA256, request.pins['requestId'], int(time.time()))

    def test_exact_fixed_cli_and_same_envelope(self):
        request, _plan = fixture_request()
        expected = FakeChecker(request)
        calls = []
        def process(argv, data=b'', **_options):
            calls.append((argv, data))
            operation = argv[3]
            report = expected.call(operation, argv[5] if operation == 'record' else None,
                                   argv[6] if operation == 'record' else None)
            return json.dumps(report).encode()
        checker = runner.FixedChecker(request)
        with patch.object(runner, 'bounded_process', side_effect=process):
            checker.call('inspect'); checker.call('claim'); checker.call('record', 'running', 'b' * 64)
        self.assertEqual(calls[0][0], ['/usr/bin/python3', '-I', str(runner.CHECKER), 'inspect', request.pins['requestId']])
        self.assertEqual(calls[0][1], calls[1][1])
        self.assertEqual(calls[2][1], b'')

    def test_rejected_expired_revoked_wrong_payload_or_receipt_are_refused(self):
        request, _plan = fixture_request()
        for failure in ('rejected', 'payload', 'receipt', 'executable'):
            report = FakeChecker(request).call('inspect')
            if failure == 'rejected': report = {'kind': 'rejected', 'executable': False, 'error': 'expired or revoked'}
            elif failure == 'payload': report['payloadSha256'] = '0' * 64
            elif failure == 'receipt': report['receipt']['nonce'] = 'b' * 32
            else: report['executable'] = True
            with self.subTest(failure=failure), patch.object(runner, 'bounded_process', return_value=json.dumps(report).encode()), self.assertRaises(RuntimeError):
                runner.FixedChecker(request).call('inspect')

    def test_actual_child_output_cap_deadline_nonzero_and_stdin(self):
        self.assertEqual(runner.bounded_process([sys.executable, '-I', '-c', 'import sys;sys.stdout.buffer.write(sys.stdin.buffer.read())'], b'exact bytes'), b'exact bytes')
        cases = [('print("x"*10000)', .5, 32), ('import time;time.sleep(10)', .05, 65536), ('raise SystemExit(3)', .5, 65536)]
        for code, seconds, cap in cases:
            with self.subTest(code=code), self.assertRaises((RuntimeError, subprocess.TimeoutExpired)):
                runner.bounded_process([sys.executable, '-I', '-c', code], seconds=seconds, cap=cap)

    def test_cli_is_held_without_any_installed_action(self):
        result = subprocess.run([sys.executable, '-I', str(SOURCE), '--envelope', '/unused', '--plan', '/unused',
                                 '--archive', '/unused', '--executor', '/unused', '--validator', '/unused'], capture_output=True, timeout=3)
        self.assertEqual(result.returncode, 1)
        self.assertIn(b'source-only pending review', result.stdout)


if __name__ == '__main__':
    unittest.main()
