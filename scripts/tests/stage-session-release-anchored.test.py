import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import subprocess
import time
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1]


def imported(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


anchored = imported('anchored_stage', SCRIPTS / 'stage-session-release-anchored.py')
fixtures = imported('stage_fixtures', SCRIPTS / 'tests' / 'stage-session-release.test.py')


def native_rename(source_fd, source, target_fd, target):
    if sys.platform == 'linux':
        return ORIGINAL_RENAME(source_fd, source, target_fd, target)
    import ctypes
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameatx_np
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(source_fd, os.fsencode(source), target_fd, os.fsencode(target), 4):
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code), target)


ORIGINAL_RENAME = anchored.rename_noreplace


def fixture_guard(expected):
    payload = json.loads(expected.payload)
    digest = hashlib.sha256(expected.payload).hexdigest()
    now = int(time.time())
    row = {'at': now, 'requestId': payload['requestId'], 'payloadSha256': digest, 'nonce': payload['nonce'],
           'grantSha256': payload['grantSha256'], 'grantVersion': payload['grantVersion'], 'action': 'stage'}
    claim = dict(row, operation='claim', outcome='claimed', evidenceSha256=None)
    running = dict(row, operation='record', outcome='running', evidenceSha256=expected.running_preflight_sha256)
    inspected = dict(row, operation='inspect', outcome='inspected', evidenceSha256=None)
    report = {'kind': 'authenticated-candidate', 'executable': False, 'hostPreconditions': 'unverified',
              'sshSourceProvenance': 'not-attested', 'checkerSha256': anchored.CHECKER_SHA256,
              'payloadSha256': digest, 'pins': payload, 'receipt': inspected}
    return anchored.AdmissionObservation(report, (claim, running, inspected), time.monotonic_ns())


class AnchoredStagingTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='anchored-stage-tests-')
        self.root = Path(self.temporary.name).resolve()
        self.target = self.root / 'application'
        self.target.mkdir(mode=0o700)
        self.archive_path = self.root / 'input.tar.gz'
        self.validator_path = SCRIPTS / 'stage-session-release.py'
        self.validator = anchored.load_validator(self.validator_path)
        self.validator['NODE_SHA256'] = hashlib.sha256(fixtures.ELF).hexdigest()
        self.loader = patch.object(anchored, 'load_validator', return_value=self.validator)
        self.loader.start()
        self.rename = patch.object(anchored, 'rename_noreplace', side_effect=native_rename)
        self.rename.start()
        self.addCleanup(self.rename.stop)
        self.addCleanup(self.loader.stop)
        self.addCleanup(self.temporary.cleanup)

    def pins(self, files=None, raw=None):
        files = files or fixtures.package()
        data = raw if raw is not None else fixtures.archive(files)
        self.archive_path.write_bytes(data)
        self.archive_path.chmod(0o600)
        return anchored.ReleasePins(fixtures.SOURCE, hashlib.sha256(data).hexdigest(), len(data), hashlib.sha256(files['release.json']).hexdigest())

    def admission(self, pins):
        now = int(time.time())
        payload = {'schemaVersion': 1, 'requestId': 'fixture-stage', 'nonce': 'a' * 32, 'issuedAt': now - 1, 'expiresAt': now + 899,
                   'grantId': 'show-tools-host-user-v1', 'grantVersion': 1, 'grantSha256': 'b' * 64,
                   'targetId': 'proxmox/anulman/show-tools-web', 'action': 'stage', 'sourceRevision': pins.source,
                   'archive': {'url': f'http://100.91.87.3:18742/show-tools-session-release-{pins.source[:7]}.tar.gz',
                               'bytes': pins.archive_bytes, 'sha256': pins.archive_sha256,
                               'root': 'show-tools-session-release-' + pins.source[:7],
                               'installRelease': str(anchored.TARGET_ROOT / 'releases' / ('session-' + pins.source[:7]))},
                   'profileSha256': 'c' * 64, 'unitSha256': 'd' * 64, 'cliSha256': 'e' * 64,
                   'planSha256': 'f' * 64, 'audioAssignmentSha256': '1' * 64,
                   'evidence': [{'kind': 'artifact-manifest', 'sha256': pins.manifest_sha256}]}
        return anchored.ExpectedAdmission(json.dumps(payload, separators=(',', ':')).encode(), '2' * 64)

    def execute(self, pins, guard=fixture_guard):
        return anchored.stage_local_archive(self.archive_path, pins, self.validator_path, self.target,
                                            prepublish_guard=guard, admission=self.admission(pins))

    def release(self):
        return self.target / 'releases' / fixtures.LEAF

    def test_actual_owned_tree_and_idempotent_no_replace(self):
        pins = self.pins()
        result = self.execute(pins)
        self.assertEqual(result['status'], 'staged-only')
        self.assertFalse(result['executablesStarted'])
        self.assertFalse(result['admissionProvided'])
        before = {str(path.relative_to(self.release())): path.lstat() for path in self.release().rglob('*')}
        self.assertEqual(self.execute(pins)['status'], 'already-staged')
        for path, info in before.items():
            after = (self.release() / path).lstat()
            self.assertEqual((after.st_ino, after.st_mtime_ns, after.st_mode), (info.st_ino, info.st_mtime_ns, info.st_mode))
        self.assertEqual((self.release() / 'runtime/node').stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.release() / 'song/song.pfp').stat().st_mode & 0o777, 0o600)

    def test_differing_existing_release_is_preserved(self):
        pins = self.pins()
        self.execute(pins)
        original = self.release() / 'gateway/server.mjs'
        original.write_bytes(b'operator content')
        with self.assertRaises(RuntimeError):
            self.execute(pins)
        self.assertEqual(original.read_bytes(), b'operator content')

    def test_symlink_destination_is_never_followed(self):
        pins = self.pins()
        (self.target / 'releases').mkdir(mode=0o700)
        (self.target / 'releases' / fixtures.LEAF).symlink_to(self.root)
        with self.assertRaises(OSError):
            self.execute(pins)
        self.assertTrue((self.target / 'releases' / fixtures.LEAF).is_symlink())

    def test_bad_manifest_refuses_publication_and_retains_attempt(self):
        files = fixtures.package(schema=2)
        with self.assertRaises(RuntimeError):
            self.execute(self.pins(files))
        self.assertFalse(self.release().exists())
        attempts = list((self.target / 'staging').iterdir())
        self.assertEqual(len(attempts), 1)
        self.assertTrue((attempts[0] / 'candidate/release.json').is_file())

    def test_short_write_makes_progress_without_losing_bytes(self):
        pins = self.pins()
        original = os.write
        def partial(fd, data):
            return original(fd, data[:max(1, len(data) // 2)])
        with patch.object(anchored.os, 'write', side_effect=partial):
            self.execute(pins)
        self.assertEqual((self.release() / 'gateway/server.mjs').read_bytes(), b'fixture')

    def test_interrupted_write_retains_old_release_and_attempt(self):
        pins = self.pins()
        old = self.target / 'releases' / 'session-old'
        old.parent.mkdir(mode=0o700)
        old.mkdir(mode=0o700)
        (old / 'keep').write_bytes(b'old')
        (old / 'keep').chmod(0o600)
        with patch.object(anchored.os, 'write', side_effect=OSError('synthetic interruption')), self.assertRaises(OSError):
            self.execute(pins)
        self.assertFalse(self.release().exists())
        self.assertEqual((old / 'keep').read_bytes(), b'old')
        self.assertTrue(list((self.target / 'staging').iterdir()))

    def test_parent_swap_before_publication_is_detected(self):
        pins = self.pins()
        original = anchored.verify_tree
        moved = self.root / 'moved'
        def swapped(*args):
            result = original(*args)
            self.target.rename(moved)
            self.target.symlink_to(moved)
            return result
        with patch.object(anchored, 'verify_tree', side_effect=swapped), self.assertRaises(RuntimeError):
            self.execute(pins)
        self.assertFalse((moved / 'releases' / fixtures.LEAF).exists())

    def test_symlink_swapped_during_validator_read_is_refused(self):
        pins = self.pins()
        original = anchored.OwnedTree.read
        substituted = False
        def swapped(tree, names):
            nonlocal substituted
            if names == ('song', 'effects.json') and not substituted:
                substituted = True
                fd = tree.directory(('song',))
                try:
                    os.unlink('effects.json', dir_fd=fd)
                    os.symlink(str(self.root / 'outside'), 'effects.json', dir_fd=fd)
                finally:
                    os.close(fd)
            return original(tree, names)
        (self.root / 'outside').write_bytes(b'never read')
        with patch.object(anchored.OwnedTree, 'read', new=swapped), self.assertRaises(OSError):
            self.execute(pins)
        self.assertFalse(self.release().exists())

    def test_interruption_after_rename_retains_published_data_without_success(self):
        pins = self.pins()
        def interrupted(*args):
            native_rename(*args)
            raise OSError('synthetic interruption after rename')
        with patch.object(anchored, 'rename_noreplace', side_effect=interrupted), self.assertRaises(OSError):
            self.execute(pins)
        self.assertTrue((self.release() / 'release.json').is_file())
        self.assertEqual(self.execute(pins)['status'], 'already-staged')

    def test_concurrent_publication_preserves_one_exact_target(self):
        pins = self.pins()
        releases = self.target / 'releases'
        releases.mkdir(mode=0o700)
        lock = os.open(releases / '.stage.lock', os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(lock)
        results = []
        def run():
            try:
                results.append(self.execute(pins)['status'])
            except BaseException as error:
                results.append(error)
        threads = [threading.Thread(target=run) for _ in range(2)]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=5)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        for result in results:
            if isinstance(result, BaseException) and not isinstance(result, BlockingIOError):
                raise result
        self.assertEqual(results.count('staged-only'), 1)
        self.assertEqual(sum(result == 'already-staged' or isinstance(result, BlockingIOError) for result in results), 1)

    def test_validator_digest_capture_is_real(self):
        self.loader.stop()
        try:
            self.assertEqual(anchored.load_validator(self.validator_path)['NODE_SHA256'], fixtures.stage.NODE_SHA256)
            changed = self.root / 'changed-validator.py'
            changed.write_bytes(self.validator_path.read_bytes() + b'\n')
            changed.chmod(0o600)
            with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
                anchored.load_validator(changed)
        finally:
            self.loader.start()

    def test_real_official_node_pin_rejects_fixture(self):
        self.validator['NODE_SHA256'] = fixtures.stage.NODE_SHA256
        with self.assertRaisesRegex(RuntimeError, 'Pinned Node'):
            self.execute(self.pins())
        self.assertFalse(self.release().exists())

    def test_current_fourteen_input_peripheral_package_stages(self):
        self.assertEqual(len(self.validator['PERIPHERAL_INPUTS']), 14)
        self.execute(self.pins(fixtures.peripheral_package()))
        self.assertTrue((self.release() / 'native/peripheral/peripheral-host').is_file())

    def test_legacy_validator_is_allowlisted_for_read_only_not_stage(self):
        self.loader.stop()
        try:
            old = self.root / 'legacy-validator.py'
            data = self.validator_path.read_bytes().replace(b'    "lib/peripherals/host/linux_input_map.h",\n', b'')
            self.assertEqual(hashlib.sha256(data).hexdigest(), anchored.LEGACY_VALIDATOR_SHA256)
            old.write_bytes(data); old.chmod(0o600)
            self.assertEqual(anchored.load_validator(old, read_only=True)['_capturedSha256'], anchored.LEGACY_VALIDATOR_SHA256)
            with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
                anchored.load_validator(old)
            old.write_bytes(data + b'\n')
            with self.assertRaisesRegex(RuntimeError, 'digest mismatch'):
                anchored.load_validator(old, read_only=True)
        finally:
            self.loader.start()

    def test_read_only_verification_derives_complete_set_and_modes_from_archive(self):
        pins = self.pins()
        self.execute(pins)
        before = {str(path): path.lstat() for path in self.release().rglob('*')}
        with (patch.object(anchored.os, 'write', side_effect=AssertionError('read-only verifier wrote')),
              patch.object(anchored.os, 'fsync', side_effect=AssertionError('read-only verifier flushed'))):
            result = anchored.verify_local_release(self.archive_path, pins, self.validator_path, self.release())
        self.assertEqual(result['status'], 'verified-read-only')
        self.assertFalse(result['admissionProvided'])
        self.assertFalse(result['idleLeaseProvided'])
        for path, info in before.items():
            after = Path(path).lstat()
            self.assertEqual((after.st_ino, after.st_mtime_ns, after.st_mode), (info.st_ino, info.st_mtime_ns, info.st_mode))

    def test_read_only_refuses_mode_drift_and_extra_directory(self):
        pins = self.pins()
        self.execute(pins)
        node = self.release() / 'runtime/node'
        node.chmod(0o600)
        with self.assertRaisesRegex(RuntimeError, 'mode mismatch'):
            anchored.verify_local_release(self.archive_path, pins, self.validator_path, self.release())
        node.chmod(0o700)
        extra = self.release() / 'not-in-reviewed-archive'
        extra.mkdir(mode=0o700)
        with self.assertRaisesRegex(RuntimeError, 'complete tree'):
            anchored.verify_local_release(self.archive_path, pins, self.validator_path, self.release())
        self.assertTrue(extra.is_dir())

    def test_read_only_refuses_linked_file(self):
        pins = self.pins()
        self.execute(pins)
        os.link(self.release() / 'song/song.pfp', self.root / 'other-link')
        with self.assertRaisesRegex(RuntimeError, 'single-link'):
            anchored.verify_local_release(self.archive_path, pins, self.validator_path, self.release())

    def test_read_only_deadline_is_checked_without_sleeping(self):
        pins = self.pins()
        self.execute(pins)
        with patch.object(anchored.time, 'monotonic', side_effect=[0, 2]), self.assertRaisesRegex(RuntimeError, 'deadline'):
            anchored.verify_local_release(self.archive_path, pins, self.validator_path, self.release(), seconds=1)

    def test_reader_accepts_node_sized_file_with_bounded_streaming(self):
        large = self.root / 'node-sized'
        size = 124902584
        fd = os.open(large, os.O_CREAT | os.O_EXCL | os.O_RDWR, 0o600)
        os.ftruncate(fd, size)
        budget = anchored.Budget()
        with anchored.VerifiedReader(fd, (os.getuid(), os.getgid()), budget) as source:
            count = 0
            while data := source.read(anchored.CHUNK):
                self.assertLessEqual(len(data), anchored.CHUNK)
                count += len(data)
        self.assertEqual(count, size)
        self.assertEqual(budget.bytes, size)

    def test_reader_refuses_aggregate_read_overrun(self):
        file = self.root / 'bounded'
        file.write_bytes(b'12345'); file.chmod(0o600)
        fd = os.open(file, os.O_RDONLY)
        budget = anchored.Budget()
        with patch.object(anchored, 'MAX_READ_BYTES', 4), anchored.VerifiedReader(fd, (os.getuid(), os.getgid()), budget) as source:
            with self.assertRaisesRegex(RuntimeError, 'Aggregate'):
                source.read(5)

    def test_cli_is_held_without_admission_integration(self):
        pins = self.pins()
        result = subprocess.run([sys.executable, '-I', str(SCRIPTS / 'stage-session-release-anchored.py'),
                                 '--archive', str(self.archive_path), '--archive-sha256', pins.archive_sha256,
                                 '--archive-bytes', str(pins.archive_bytes), '--source', pins.source,
                                 '--manifest-sha256', pins.manifest_sha256, '--validator', str(self.validator_path)],
                                capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 1)
        self.assertIn('Prototype only', result.stdout)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_missing_and_noncallable_guard_are_refused_before_writes(self):
        pins = self.pins()
        with self.assertRaises(TypeError):
            anchored.stage_local_archive(self.archive_path, pins, self.validator_path, self.target)
        with self.assertRaisesRegex(RuntimeError, 'guard is missing'):
            self.execute(pins, None)
        self.assertEqual(list(self.target.iterdir()), [])

    def test_boolean_and_noop_guards_cannot_publish(self):
        pins = self.pins()
        for result in (True, None):
            with self.subTest(result=result), self.assertRaisesRegex(RuntimeError, 'structured'):
                self.execute(pins, lambda _expected: result)
            self.assertFalse(self.release().exists())
        self.assertEqual(len(list((self.target / 'staging').iterdir())), 2)

    def test_failed_guard_preserves_existing_release_and_private_attempt(self):
        pins = self.pins()
        releases = self.target / 'releases'
        releases.mkdir(mode=0o700)
        old = releases / 'session-old'
        old.mkdir(mode=0o700)
        (old / 'keep').write_bytes(b'old')
        def failed(_expected):
            raise TimeoutError('synthetic fixed-checker timeout')
        with self.assertRaises(TimeoutError):
            self.execute(pins, failed)
        self.assertFalse(self.release().exists())
        self.assertEqual((old / 'keep').read_bytes(), b'old')
        self.assertTrue(list((self.target / 'staging').glob('*/candidate/release.json')))

    def test_guard_requires_matching_payload_plan_and_claim_pins(self):
        pins = self.pins()
        def wrong_plan(expected):
            observed = fixture_guard(expected)
            observed.inspect_report['pins']['planSha256'] = '0' * 64
            return observed
        def wrong_claim(expected):
            observed = fixture_guard(expected)
            observed.request_rows[0]['nonce'] = '0' * 32
            return observed
        for guard in (wrong_plan, wrong_claim):
            with self.subTest(guard=guard.__name__), self.assertRaisesRegex(RuntimeError, 'pins differ'):
                self.execute(pins, guard)
            self.assertFalse(self.release().exists())

    def test_fresh_inspect_alone_does_not_prove_claim_or_running(self):
        pins = self.pins()
        def inspect_only(expected):
            observed = fixture_guard(expected)
            receipt = observed.inspect_report['receipt']
            return anchored.AdmissionObservation(observed.inspect_report, (receipt, receipt, receipt), time.monotonic_ns())
        with self.assertRaisesRegex(RuntimeError, 'Actual claim then running'):
            self.execute(pins, inspect_only)
        self.assertFalse(self.release().exists())

    def test_terminal_claim_state_and_wrong_running_evidence_are_refused(self):
        pins = self.pins()
        def terminal(expected):
            observed = fixture_guard(expected)
            observed.request_rows[1]['outcome'] = 'completed'
            return observed
        def wrong_evidence(expected):
            observed = fixture_guard(expected)
            observed.request_rows[1]['evidenceSha256'] = '0' * 64
            return observed
        for guard in (terminal, wrong_evidence):
            with self.subTest(guard=guard.__name__), self.assertRaises(RuntimeError):
                self.execute(pins, guard)
            self.assertFalse(self.release().exists())

    def test_stale_observation_and_stale_inspection_are_refused(self):
        pins = self.pins()
        def stale_clock(expected):
            observed = fixture_guard(expected)
            return anchored.AdmissionObservation(observed.inspect_report, observed.request_rows, 0)
        def stale_inspect(expected):
            observed = fixture_guard(expected)
            observed.inspect_report['receipt']['at'] -= 15
            return observed
        for guard in (stale_clock, stale_inspect):
            with self.subTest(guard=guard.__name__), self.assertRaises(RuntimeError):
                self.execute(pins, guard)
            self.assertFalse(self.release().exists())

    def test_ancestor_swap_inside_guard_aborts_publication(self):
        pins = self.pins()
        moved = self.root / 'guard-moved'
        def swapped(expected):
            observed = fixture_guard(expected)
            self.target.rename(moved)
            self.target.symlink_to(moved)
            return observed
        with self.assertRaisesRegex(RuntimeError, 'ancestor path changed'):
            self.execute(pins, swapped)
        self.assertFalse((moved / 'releases' / fixtures.LEAF).exists())
        self.assertTrue(list((moved / 'staging').glob('*/candidate/release.json')))

    def test_competing_destination_created_by_guard_is_not_overwritten(self):
        pins = self.pins()
        def raced(expected):
            self.release().mkdir(mode=0o700)
            (self.release() / 'keep').write_bytes(b'foreign destination')
            return fixture_guard(expected)
        with self.assertRaises(RuntimeError):
            self.execute(pins, raced)
        self.assertEqual((self.release() / 'keep').read_bytes(), b'foreign destination')

    def test_candidate_swap_inside_guard_aborts_publication(self):
        pins = self.pins()
        def swapped(expected):
            candidate = next((self.target / 'staging').glob('*/candidate'))
            candidate.rename(candidate.with_name('retained-candidate'))
            candidate.symlink_to(self.root)
            return fixture_guard(expected)
        with self.assertRaisesRegex(RuntimeError, 'Candidate path changed after guard'):
            self.execute(pins, swapped)
        self.assertFalse(self.release().exists())
        self.assertTrue(list((self.target / 'staging').glob('*/retained-candidate/release.json')))

    def test_guard_expiration_during_final_read_only_checks_aborts(self):
        pins = self.pins()
        clock, check = time.monotonic_ns, anchored.RootAnchor.check
        state = {'returned': False, 'late': False}
        def guard(expected):
            result = fixture_guard(expected)
            state['returned'] = True
            return result
        def checked(anchor):
            check(anchor)
            if state['returned']:
                state['late'] = True
        def now():
            return clock() + (6_000_000_000 if state['late'] else 0)
        with (patch.object(anchored.RootAnchor, 'check', new=checked),
              patch.object(anchored.time, 'monotonic_ns', side_effect=now),
              self.assertRaisesRegex(RuntimeError, 'Guard expired before publication')):
            self.execute(pins, guard)
        self.assertFalse(self.release().exists())


if __name__ == '__main__':
    unittest.main()
