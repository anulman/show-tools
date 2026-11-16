"""Owned ledger/files and in-memory TLS/HTTP fixtures only. No host or network actions."""
import base64
from contextlib import contextmanager
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


def imported(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


status = imported('read_only_status_fixture', SCRIPTS / 'status-session-release-admission.py')
common_module = imported('status_common_fixture', SCRIPTS / 'stage-session-release-admission.py')
COMMON = vars(common_module)
ledger_fixture = imported('status_ledger_fixture', SCRIPTS / 'tests/stage-session-release-admission.test.py')


def request_fixture():
    archive = {'url': 'http://100.91.87.3:18742/show-tools-session-release-d8fa3cf.tar.gz', 'bytes': status.ARCHIVE_BYTES,
               'sha256': status.ARCHIVE_SHA256, 'root': 'show-tools-session-release-d8fa3cf', 'installRelease': str(status.RELEASE)}
    plan = {'action': 'status', 'targetId': COMMON['TARGET'], 'sourceRevision': status.SOURCE_REVISION,
            'archive': archive, 'artifactManifestSha256': status.MANIFEST_SHA256,
            'protected': {'checkerSha256': COMMON['CHECKER_SHA256'], 'grantSha256': COMMON['GRANT_SHA256'], 'signersSha256': COMMON['SIGNERS_SHA256']},
            'currentFiles': {path: value[0] for path, value in COMMON['CURRENT_FILES'].items()},
            'sourcePins': {'common': status.COMMON_SHA256, 'executor': status.EXECUTOR_SHA256, 'legacyValidator': status.LEGACY_SHA256}}
    plan_bytes = json.dumps(plan, indent=2).encode()
    now = int(time.time())
    payload = {'schemaVersion': 1, 'requestId': 'status-fixture-001', 'nonce': 'a' * 32,
               'issuedAt': now, 'expiresAt': now + 900, 'grantId': 'show-tools-host-user-v1', 'grantVersion': 1,
               'grantSha256': COMMON['GRANT_SHA256'], 'targetId': COMMON['TARGET'], 'action': 'status',
               'sourceRevision': status.SOURCE_REVISION, 'archive': archive, 'profileSha256': status.PROFILE_SHA256,
               'unitSha256': COMMON['CURRENT_FILES']['/home/anulman/.config/systemd/user/show-tools-web.service'][0],
               'cliSha256': COMMON['CURRENT_FILES']['/home/anulman/.local/bin/show-tools-session'][0],
               'planSha256': COMMON['sha'](plan_bytes), 'audioAssignmentSha256': '60dd431db3a1f06ee59ad944d51984bacf7a5449e2d01646c9da0fa9c1645afe',
               'evidence': [{'kind': 'artifact-manifest', 'sha256': status.MANIFEST_SHA256}]}
    payload_bytes = json.dumps(payload, indent=3).encode()
    envelope = json.dumps({'kind': 'show-tools-signed-action-v1', 'payloadBase64': base64.b64encode(payload_bytes).decode(),
                           'signature': 'PROTOCOL FIXTURE ONLY; NOT INSTALLED AUTHORIZATION'}, indent=1).encode()
    return status.StatusRequest.decode(envelope, plan_bytes, COMMON), plan_bytes


def off_view():
    return {'serverEpoch': 'server-epoch', 'revision': '0', 'audio': {'kind': 'off'}}


class StatusTests(unittest.TestCase):
    def setUp(self):
        if not hasattr(os, 'listxattr'):
            adapter = patch.object(os, 'listxattr', return_value=[], create=True)
            adapter.start(); self.addCleanup(adapter.stop)
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name).resolve()
        self.request, self.plan_bytes = request_fixture()

    def tearDown(self):
        self.temp.cleanup()

    def run_status(self, checker=None, *, getter=None, verifier=None, name='evidence'):
        checker = checker or ledger_fixture.FrozenLedgerChecker(self.request, self.root / (name + '-ledger'))
        evidence = COMMON['Evidence'](self.root / name)
        try:
            with patch.object(status, 'fixed_files', return_value={'fixed': True}):
                result = status.run_status(self.request, COMMON, checker, evidence,
                    verifier or (lambda: {'nodeBytes': 124902584, 'status': 'verified-read-only'}),
                    lambda: {'main': {'pid': 10, 'startTicks': '20'}, 'scope': 'named-web-cgroup-only'}, getter or off_view)
            return result, checker
        finally:
            evidence.close()

    def test_status_payload_matches_actual_frozen_schema_without_stage_request_decoder(self):
        checker = ledger_fixture.frozen_checker()
        grant = json.loads((SCRIPTS.parent / 'lib/remote-performance/delegation/grant.inactive.json').read_text()); grant['active'] = True
        checker.validate_payload(self.request.payload, grant, COMMON['GRANT_SHA256'], self.request.pins['requestId'], int(time.time()))
        self.assertEqual(self.request.pins['action'], 'status')
        with self.assertRaises(RuntimeError):
            common_module.CapturedRequest.decode(self.request.envelope, self.plan_bytes)

    def test_stage_action_is_refused(self):
        outer = json.loads(self.request.envelope); payload = json.loads(self.request.payload); payload['action'] = 'stage'
        outer['payloadBase64'] = base64.b64encode(json.dumps(payload).encode()).decode()
        with self.assertRaisesRegex(RuntimeError, 'status target'):
            status.StatusRequest.decode(json.dumps(outer).encode(), self.plan_bytes, COMMON)

    def test_actual_ledger_sequence_and_get_only_after_owned_claim(self):
        checker = ledger_fixture.FrozenLedgerChecker(self.request, self.root / 'ledger')
        def getter():
            self.assertEqual([row['outcome'] for row in checker.request_rows()], ['inspected', 'claimed', 'running', 'inspected'])
            return off_view()
        try:
            result, checker = self.run_status(checker, getter=getter)
            self.assertEqual(result['outcome'], 'completed')
            self.assertFalse(result['idleLeaseProvided'])
            self.assertEqual([row['outcome'] for row in checker.request_rows()], ['inspected', 'claimed', 'running', 'inspected', 'completed'])
            stored = json.loads((self.root / 'evidence/result.json').read_text())
            self.assertEqual(stored['verifiedRelease']['nodeBytes'], 124902584)
            self.assertEqual(stored['view'], off_view())
        finally:
            checker.close()

    def test_preexisting_claim_and_terminal_are_preserved(self):
        for terminal in (None, 'completed', 'uncertain'):
            name = 'prior-' + str(terminal)
            checker = ledger_fixture.FrozenLedgerChecker(self.request, self.root / (name + '-ledger'))
            try:
                checker.call('claim'); checker.call('record', 'running', 'b' * 64)
                if terminal: checker.call('record', terminal, 'c' * 64)
                count = len(checker.calls)
                getter = lambda: self.fail('GET must not run for a foreign claim')
                result, checker = self.run_status(checker, getter=getter, name=name)
                self.assertEqual(result['outcome'], 'blocked-preclaim')
                self.assertEqual(checker.calls[count:], [('inspect', None)])
                self.assertEqual([row['outcome'] for row in checker.request_rows()][-2], terminal or 'running')
            finally:
                checker.close()

    def test_lost_claim_reply_and_concurrent_winner_do_not_gain_audit_ownership(self):
        def winner(checker, report):
            checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'claim', report, int(time.time()))
            checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'record', None, int(time.time()), 'running', 'b' * 64)
        for kind, options in [('lost', {'lose_claim_reply': True}), ('concurrent', {'before_claim': winner})]:
            checker = ledger_fixture.FrozenLedgerChecker(self.request, self.root / (kind + '-ledger'), **options)
            try:
                result, checker = self.run_status(checker, getter=lambda: self.fail('GET before owned claim'), name=kind)
                self.assertEqual(result['outcome'], 'uncertain')
                self.assertFalse(result['claimVerifiedByThisInvocation'])
                self.assertNotIn(('record', 'uncertain'), checker.calls)
            finally:
                checker.close()

    def test_verifier_failure_prevents_claim_and_credentials(self):
        result, checker = self.run_status(verifier=lambda: (_ for _ in ()).throw(RuntimeError('release changed')),
                                          getter=lambda: self.fail('credentials must not be read'))
        try:
            self.assertEqual(result['outcome'], 'blocked-preclaim')
            self.assertEqual(checker.calls, [])
        finally:
            checker.close()

    def test_get_failure_after_claim_is_uncertain_without_retry(self):
        calls = []
        def getter():
            calls.append('get'); raise RuntimeError('bounded GET failed')
        result, checker = self.run_status(getter=getter)
        try:
            self.assertEqual(result['outcome'], 'uncertain')
            self.assertEqual(calls, ['get'])
            self.assertEqual(checker.calls[-1], ('record', 'uncertain'))
        finally:
            checker.close()

    def test_actual_terminal_denial_or_binding_drift_before_get_is_rejected(self):
        for kind in ('terminal', 'denial', 'binding'):
            checker = ledger_fixture.FrozenLedgerChecker(self.request, self.root / (kind + '-ledger'))
            original = checker.call
            def changed(operation, outcome=None, digest=None):
                report = original(operation, outcome, digest)
                if (operation, outcome) == ('record', 'running'):
                    if kind == 'terminal':
                        checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'record', None, int(time.time()), 'uncertain', '9' * 64)
                    elif kind == 'denial':
                        checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'deny', None, int(time.time()))
                    else:
                        foreign = dict(report, kind='authenticated-candidate', pins=dict(self.request.pins, nonce='b' * 32),
                                       payloadSha256=COMMON['sha'](self.request.payload))
                        checker.frozen.ledger_event(checker.stream, self.request.pins['requestId'], 'inspect', foreign, int(time.time()))
                return report
            checker.call = changed
            try:
                result, _checker = self.run_status(checker, getter=lambda: self.fail('GET after invalid owned barrier'), name=kind)
                with self.subTest(kind=kind):
                    self.assertEqual(result['outcome'], 'uncertain')
                    self.assertTrue(result['claimVerifiedByThisInvocation'])
                    self.assertNotEqual(result.get('error'), 'GET after invalid owned barrier')
            finally:
                checker.close()

    def test_legacy_validator_is_exact_and_large_node_is_delegated_to_streaming_verifier(self):
        fixture = (SCRIPTS / 'tests/fixtures/stage-session-release-4fd35fce.py.fixture').read_bytes()
        legacy = fixture.replace(b'    "lib/peripherals/host/linux_input_map.h",\n', b'', 1)
        self.assertEqual(hashlib.sha256(legacy).hexdigest(), status.LEGACY_SHA256)
        path = self.root / 'stage-session-release.py'; path.write_bytes(legacy); path.chmod(0o600)
        calls = []
        def verify(archive, pins, validator, release):
            calls.append((archive, pins, validator, release))
            return {'status': 'verified-read-only', 'source': status.SOURCE_REVISION, 'archiveSha256': status.ARCHIVE_SHA256,
                    'manifestSha256': status.MANIFEST_SHA256, 'validatorSha256': status.LEGACY_SHA256,
                    'files': 571, 'manifestRecords': 569, 'rawHeaders': 1388, 'expandedBytes': 164923904,
                    'nodeBytes': 124902584}
        report = status.verify_current(COMMON, {'ReleasePins': ledger_fixture.ReleasePins, 'verify_local_release': verify}, path)
        self.assertEqual(report['nodeBytes'], 124902584)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], status.ARCHIVE)

    def test_actual_dependency_bytes_have_reviewed_hashes_and_private_capture(self):
        for name, digest in [('stage-session-release-admission.py', status.COMMON_SHA256), ('stage-session-release-anchored.py', status.EXECUTOR_SHA256)]:
            data = (SCRIPTS / name).read_bytes(); self.assertEqual(hashlib.sha256(data).hexdigest(), digest)
            path = self.root / name; path.write_bytes(data); path.chmod(0o600)
            captured = status.captured_module(path, digest)
            self.assertIsNotNone(captured)
        with self.assertRaisesRegex(RuntimeError, 'pin differs'):
            status.captured_module(self.root / 'stage-session-release-admission.py', '0' * 64)

    def test_action_aware_checker_keeps_original_envelope_and_fixed_argv(self):
        backend = ledger_fixture.FrozenLedgerChecker(self.request, self.root / 'protocol-ledger')
        calls = []
        def process(argv, data=b'', **_kwargs):
            calls.append((argv, data))
            report = backend.call(argv[3], argv[5] if argv[3] == 'record' else None, argv[6] if argv[3] == 'record' else None)
            return json.dumps(report).encode()
        common = dict(COMMON, bounded_process=process)
        checker = status.RequestChecker(self.request, common)
        try:
            checker.call('inspect'); checker.call('claim'); checker.call('record', 'running', 'b' * 64)
            self.assertEqual(calls[0][0], ['/usr/bin/python3', '-I', str(COMMON['CHECKER']), 'inspect', self.request.pins['requestId']])
            self.assertEqual(calls[0][1], self.request.envelope)
            self.assertEqual(calls[0][1], calls[1][1])
            self.assertEqual(calls[2][1], b'')
        finally:
            backend.close()


class FakeSocket:
    def __init__(self, response):
        self.response, self.sent, self.timeouts, self.closed = response, [], [], False

    def settimeout(self, seconds): self.timeouts.append(seconds)
    def sendall(self, data): self.sent.append(data)
    def makefile(self, _mode, buffering=0): return io.BytesIO(self.response)
    def close(self): self.closed = True


class HttpsTests(unittest.TestCase):
    def request(self, value, code=200, length_extra=0, chunked=False):
        token = 'fake-status-token-' + 'a' * 32
        body = json.dumps(value).encode()
        framing = 'Transfer-Encoding: chunked' if chunked else 'Content-Length: ' + str(len(body) + length_extra)
        wire_body = (hex(len(body))[2:].encode() + b'\r\n' + body + b'\r\n0\r\n\r\n') if chunked else body
        response = ('HTTP/1.1 ' + str(code) + ' Fixture\r\nContent-Type: application/json\r\n' + framing + '\r\n\r\n').encode() + wire_body
        sock = FakeSocket(response)
        context = SimpleNamespace(check_hostname=True, verify_mode=ssl.CERT_REQUIRED)
        context.wrap_socket = lambda raw, server_hostname: self.assertEqual(server_hostname, status.HOST) or raw
        captured = []
        def capture(path, _limit, _owner, _modes):
            captured.append(path)
            if path == status.CREDENTIALS / 'token': return token.encode() + b'\n', ()
            if path == status.CREDENTIALS / 'tls.cert': return b'PUBLIC CERT FIXTURE', ()
            self.fail('Unexpected credential or TLS key read')
        profile = json.dumps({'origin': status.ORIGIN, 'connectAddress': status.ADDRESS, 'port': status.PORT,
                              'serviceName': 'show-tools-web.service', 'tokenFile': str(status.CREDENTIALS / 'token'),
                              'tls': {'cert': str(status.CREDENTIALS / 'tls.cert'), 'key': '/never-read-private-key'}}).encode()
        common = dict(COMMON, capture=capture, sha=lambda _data: self.fail('Token/HTTP material must not be hashed'))
        with patch.object(status.ssl, 'create_default_context', return_value=context) as tls, patch.object(status.socket, 'create_connection', return_value=sock) as connection:
            result = status.read_status(common, profile)
        self.assertEqual(connection.call_args.args[0], (status.ADDRESS, status.PORT))
        self.assertEqual(tls.call_args.kwargs, {'cadata': 'PUBLIC CERT FIXTURE'})
        self.assertEqual(set(captured), {status.CREDENTIALS / 'token', status.CREDENTIALS / 'tls.cert'})
        wire = b''.join(sock.sent)
        self.assertTrue(wire.startswith(b'GET /api/status HTTP/1.1\r\n'))
        self.assertIn(('Host: ' + status.HOST + ':8443\r\n').encode(), wire)
        self.assertIn(('Origin: ' + status.ORIGIN + '\r\n').encode(), wire)
        self.assertIn(('Authorization: Bearer ' + token + '\r\n').encode(), wire)
        self.assertNotIn(token, json.dumps(result))
        self.assertTrue(sock.closed)
        return result

    def test_actual_http_parser_uses_fixed_get_tls_host_origin_sni_and_no_key_read(self):
        self.assertEqual(self.request(off_view()), off_view())
        self.assertEqual(self.request(off_view(), chunked=True), off_view())

    def test_complete_json_with_truncated_declared_framing_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, '^Authenticated desk status GET failed$'):
            self.request(off_view(), length_extra=100)

    def test_ready_phase_is_preserved_without_runtime_error_or_song_source(self):
        view = {'serverEpoch': 'server', 'revision': '3', 'song': {'source': 'not retained'}, 'audio': {'kind': 'ready', 'attempt': 'attempt',
                'performance': {'hostEpoch': 'native', 'revision': '2', 'state': {'phase': 'playing', 'bar': 2, 'beat': 1, 'error': 'not retained'}}}}
        result = self.request(view)
        self.assertEqual(result['audio']['performance']['state']['phase'], 'playing')
        self.assertNotIn('song', result)

    def test_redirect_invalid_body_budget_and_token_echo_fail_without_exposing_secret(self):
        for value, code in [(off_view(), 302), ({'serverEpoch': 'server', 'revision': '0', 'audio': {'kind': 'bad'}}, 200),
                            ({**off_view(), 'hidden': 'fake-status-token-' + 'a' * 32}, 200)]:
            with self.subTest(code=code), self.assertRaisesRegex(RuntimeError, '^Authenticated desk status GET failed$'):
                self.request(value, code)
        with patch.object(status, 'MAX_RESPONSE', 8), self.assertRaisesRegex(RuntimeError, '^Authenticated desk status GET failed$'):
            self.request(off_view())

    def test_reader_enforces_wire_and_deadline_without_a_watchdog(self):
        sock = FakeSocket(b'')
        with patch.object(status, 'MAX_WIRE', 3):
            reader = status.DeadlineReader(io.BytesIO(b'1234'), sock, time.monotonic() + 1)
            with self.assertRaisesRegex(RuntimeError, 'wire'):
                reader.readinto(bytearray(10))
            reader.close()
        reader = status.DeadlineReader(io.BytesIO(b'x'), sock, time.monotonic() - 1)
        with self.assertRaisesRegex(RuntimeError, 'deadline'):
            reader.readinto(bytearray(1))
        reader.close()


class ServiceSnapshotTests(unittest.TestCase):
    def test_only_named_cgroup_and_expected_main_arguments_are_observed(self):
        group = '/user.slice/user-1000.slice/user@1000.service/app.slice/show-tools-web.service'
        values = {'LoadState': 'loaded', 'ActiveState': 'active', 'SubState': 'running', 'MainPID': '123',
                  'ControlGroup': group, 'FragmentPath': '/home/anulman/.config/systemd/user/show-tools-web.service',
                  'Restart': 'no', 'DropInPaths': ''}
        common = dict(COMMON, bounded_process=lambda argv: '\n'.join(key + '=' + value for key, value in values.items()).encode())
        fields = ['S'] + ['0'] * 18 + ['456']
        arguments = [str(status.RELEASE / 'runtime/node'), str(status.RELEASE / 'gateway/server.mjs'), '--profile', str(status.PROFILE)]
        data = {'/sys/fs/cgroup' + group + '/cgroup.procs': b'123\n', '/proc/123/stat': ('123 (node) ' + ' '.join(fields)).encode(),
                '/proc/123/status': b'Uid:\t1000\t1000\t1000\t1000\n', '/proc/123/cgroup': ('0::' + group + '\n').encode(),
                '/proc/123/cmdline': b'\0'.join(value.encode() for value in arguments) + b'\0'}
        observed = []
        def read(path, _maximum):
            observed.append(str(path)); return data[str(path)]
        @contextmanager
        def directories(_path):
            yield iter(())
        with patch.object(status, 'kernel_read', side_effect=read), patch.object(status.os, 'readlink', return_value=arguments[0]), \
                patch.object(status.os, 'scandir', side_effect=directories), patch.object(Path, 'is_dir', return_value=True), \
                patch.object(Path, 'is_symlink', return_value=False):
            result = status.observe_service(common)
            self.assertEqual(result['main']['argv'], arguments)
            self.assertEqual(result['main']['startTicks'], '456')
            self.assertEqual(result['scope'], 'named-web-cgroup-only')
            data['/proc/123/status'] = b'Uid:\t1001\t1001\t1001\t1001\n'
            with self.assertRaisesRegex(RuntimeError, 'owner differs'):
                status.observe_service(common)
        self.assertTrue(all(path.startswith('/proc/123/') or path == '/sys/fs/cgroup' + group + '/cgroup.procs' for path in observed))


if __name__ == '__main__':
    unittest.main()
