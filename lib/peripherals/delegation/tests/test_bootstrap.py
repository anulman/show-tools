import contextlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('peripheral_bootstrap', ROOT / 'bootstrap.py')
bootstrap = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bootstrap)


class Bootstrap(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='peripheral-bootstrap-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        # Only ownership IDs are adapted to this unprivileged test user. Real
        # openat/no-follow/modes/links/rename/fsync and on-disk bytes are exercised.
        for name, value in (('ROOT_UID', os.getuid()), ('ROOT_GID', os.getgid()),
                            ('APP_UID', os.getuid()), ('APP_GID', os.getgid())):
            self.stack.enter_context(patch.object(bootstrap, name, value))
        self.stack.enter_context(patch.object(bootstrap.os, 'fchown'))
        self.directories = []
        for name in ('libexec', 'policy', 'mailbox', 'packet'):
            path = self.root / name
            path.mkdir(mode=0o700)
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
            self.addCleanup(os.close, fd)
            self.directories.append(fd)
        self.checker, self.policy, self.ledger, self.packet = self.directories
        map_path = self.root / 'synthetic-map.json'
        map_path.write_text(json.dumps({'sources': [
            {'kind': 'linux', 'id': 'synthetic', 'interfaceNumber': 0, 'eventTypes': [0, 1],
             'keyCodes': [30, 31, 32, 33, 34, 35], 'relativeAxes': []},
            {'kind': 'linux', 'id': 'motion', 'interfaceNumber': 2, 'eventTypes': [0, 2],
             'keyCodes': [], 'relativeAxes': [1]}],
            'switches': [{'controlId': control, 'sourceId': 'synthetic', 'type': 1, 'code': 30 + index}
                         for index, control in enumerate(('blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'))],
            'axis': {'sourceId': 'motion', 'type': 2, 'code': 1},
            'leds': [{'controlId': control, 'sdkChannel': index}
                     for index, control in enumerate(('blue', 'yellow', 'red', 'green'))], 'confirmWiring': True}))
        frozen = self.root / 'frozen'
        subprocess.run([sys.executable, '-I', str(ROOT / 'freeze.py'), '--input-map', str(map_path),
                        '--out', str(frozen)], check=True, stdout=subprocess.PIPE)
        for name in (*bootstrap.FILES, 'manifest.json'):
            destination = self.root / 'packet' / name
            destination.write_bytes((frozen / name).read_bytes())
            destination.chmod(0o600)
        self.manifest = (frozen / 'manifest.json').read_bytes()
        self.active_sha = json.loads(self.manifest)['activeGrantSha256']
        self.content, self.active = bootstrap.load_bundle(self.packet, bootstrap.digest(self.manifest), self.active_sha)
        old = self.content['allowed_signers'].replace(b'show-tools-peripheral-deploy-v1', b'show-tools-deploy-v1')
        self.old_paths = []
        for name, content in ((bootstrap.WEB_SIGNERS.name, old), ('show-tools.json', b'untouched web grant'),
                              ('authorization.jsonl', b'untouched web ledger'), ('show-tools-delegation-check.py', b'untouched web checker')):
            path = self.root / 'policy' / name
            path.write_bytes(content)
            path.chmod(0o644)
            self.old_paths.append((path, content, path.stat().st_ino))

    def test_unconfigured_legacy_and_unpaired_led_packets_cannot_activate(self):
        grant = json.loads((ROOT / 'grant.inactive.json').read_bytes())
        with self.assertRaisesRegex(ValueError, 'version-two installation map'):
            bootstrap.active_grant(json.dumps(grant).encode())
        legacy = json.loads(self.content['grant.inactive.json'])
        legacy['target']['peripheralAssignment'] = {'buttonKey': 'escape', 'sdkChannel': 0}
        with self.assertRaisesRegex(ValueError, 'version-two installation map'):
            bootstrap.active_grant(json.dumps(legacy).encode())
        incomplete = json.loads(self.content['grant.inactive.json'])
        incomplete['target']['peripheralAssignment']['inputMap']['switches'].pop(0)
        with self.assertRaisesRegex(ValueError, 'LEDs must belong'):
            bootstrap.active_grant(json.dumps(incomplete).encode())
        self.assertFalse((self.root / 'policy' / bootstrap.GRANT.name).exists())

    def test_two_button_map_freezes_and_bootstraps_without_future_switches(self):
        observed = json.loads(self.content['grant.inactive.json'])['target']['peripheralAssignment']['inputMap']
        observed['sources'] = observed['sources'][:1]
        observed['switches'] = observed['switches'][:2]
        observed['leds'] = observed['leds'][:2]
        observed.pop('axis')
        input_file = self.root / 'two-button-map.json'
        input_file.write_text(json.dumps(observed))
        output = self.root / 'two-button-packet'
        subprocess.run([sys.executable, '-I', str(ROOT / 'freeze.py'), '--input-map', str(input_file),
                        '--out', str(output)], check=True, stdout=subprocess.PIPE)
        manifest_bytes = (output / 'manifest.json').read_bytes()
        manifest = json.loads(manifest_bytes)
        fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        self.content, self.active = bootstrap.load_bundle(fd, bootstrap.digest(manifest_bytes),
                                                        manifest['activeGrantSha256'])
        self.install()
        installed = json.loads((self.root / 'policy' / bootstrap.GRANT.name).read_bytes())
        self.assertEqual(installed['target']['peripheralAssignment']['inputMap'], observed)
        self.assertEqual(len(observed['switches']), 2)
        self.assertNotIn('axis', observed)

    def test_freeze_preserves_source_and_refuses_invalid_or_existing_output(self):
        before = {name: (ROOT / name).read_bytes() for name in (*bootstrap.FILES, 'manifest.json')}
        failed = self.root / 'invalid-packet'
        bad_map = self.root / 'bad-map.json'
        bad_map.write_text('{"sources":[],"switches":[],"leds":[],"confirmWiring":false}')
        result = subprocess.run([sys.executable, '-I', str(ROOT / 'freeze.py'),
            '--input-map', str(bad_map), '--out', str(failed)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(failed.exists())
        result = subprocess.run([sys.executable, '-I', str(ROOT / 'freeze.py'),
            '--input-map', str(self.root / 'synthetic-map.json'), '--out', str(self.root / 'frozen')],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(before, {name: (ROOT / name).read_bytes() for name in before})
        for name in (*bootstrap.FILES, 'manifest.json'):
            self.assertEqual(stat.S_IMODE((self.root / 'frozen' / name).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE((self.root / 'frozen').stat().st_mode), 0o700)

    def install(self):
        bootstrap.install(self.content, self.active, self.checker, self.policy, self.ledger)

    def test_create_only_root_files_private_genesis_activation_and_retry(self):
        self.install()
        created = [(self.root / 'libexec' / bootstrap.CHECKER.name, self.content['check.py'], 0o644),
                   (self.root / 'policy' / bootstrap.SIGNERS.name, self.content['allowed_signers'], 0o644),
                   (self.root / 'policy' / bootstrap.GRANT.name, self.active, 0o644)]
        for path, data, mode in created:
            self.assertEqual(path.read_bytes(), data)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), mode)
            self.assertEqual(path.stat().st_nlink, 1)
        ledger = self.root / 'mailbox' / bootstrap.LEDGER.name
        before = ledger.read_bytes()
        self.assertEqual(stat.S_IMODE(ledger.stat().st_mode), 0o600)
        row = json.loads(before)
        self.assertEqual(row['namespace'], bootstrap.NAMESPACE)
        self.assertEqual(row['inode'], ledger.stat().st_ino)
        identities = [path.stat().st_ino for path, _, _ in created]
        self.install()
        self.assertEqual(ledger.read_bytes(), before)
        self.assertEqual([path.stat().st_ino for path, _, _ in created], identities)
        for path, data, inode in self.old_paths:
            self.assertEqual((path.read_bytes(), path.stat().st_ino), (data, inode))

    def test_real_ancestry_0775_symlink_and_foreign_owner_refused(self):
        parent = self.root / 'ancestry'
        parent.mkdir(mode=0o700)
        child = parent / 'child'
        child.mkdir(mode=0o755)
        fd = os.open(parent, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, fd)
        opened = bootstrap.walk_directory(fd, ('child',), True)
        os.close(opened)
        child.chmod(0o775)
        with self.assertRaisesRegex(ValueError, 'Unsafe directory ancestry'):
            bootstrap.walk_directory(fd, ('child',), True)
        child.chmod(0o755)
        (parent / 'link').symlink_to(child)
        with self.assertRaises(OSError):
            bootstrap.walk_directory(fd, ('link',), True)
        info = list(child.stat())
        info[4] = 12345
        with self.assertRaisesRegex(ValueError, 'owner'):
            bootstrap.directory_metadata(os.stat_result(info), True)
        with self.assertRaises(ValueError):
            bootstrap.walk_directory(fd, ('..',), True)

    def test_existing_drift_link_and_partial_ledger_refuse_before_any_install(self):
        destination = self.root / 'libexec' / bootstrap.CHECKER.name
        destination.write_bytes(b'foreign checker')
        destination.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'differs'):
            self.install()
        self.assertFalse((self.root / 'policy' / bootstrap.GRANT.name).exists())
        destination.unlink()
        destination.symlink_to(self.root / 'outside')
        with self.assertRaises(OSError):
            self.install()
        destination.unlink()
        ledger = self.root / 'mailbox' / bootstrap.LEDGER.name
        ledger.write_bytes(b'partial')
        ledger.chmod(0o600)
        with self.assertRaises(ValueError):
            self.install()
        self.assertFalse(destination.exists())
        self.assertEqual(ledger.read_bytes(), b'partial')

    def test_partial_publication_retains_inactive_policy_and_resumes_without_reset(self):
        with patch.object(bootstrap, 'initialize_ledger', side_effect=OSError('simulated failure before genesis')):
            with self.assertRaises(OSError):
                self.install()
        grant = self.root / 'policy' / bootstrap.GRANT.name
        self.assertFalse(json.loads(grant.read_bytes())['active'])
        self.assertFalse((self.root / 'mailbox' / bootstrap.LEDGER.name).exists())
        self.install()
        self.assertTrue(json.loads(grant.read_bytes())['active'])
        ledger = self.root / 'mailbox' / bootstrap.LEDGER.name
        before = ledger.read_bytes()
        with ledger.open('ab') as stream:
            stream.write(b'{"not":"genesis"}\n')
        with self.assertRaisesRegex(ValueError, 'used, partial, or corrupt'):
            self.install()
        self.assertEqual(ledger.read_bytes(), before + b'{"not":"genesis"}\n')
        ledger.unlink()
        with self.assertRaisesRegex(ValueError, 'do not recreate history'):
            self.install()
        self.assertFalse(ledger.exists())

    def test_activation_failure_keeps_genesis_and_inactive_grant(self):
        with patch.object(bootstrap.os, 'replace', side_effect=OSError('simulated activation failure')):
            with self.assertRaises(OSError):
                self.install()
        grant = self.root / 'policy' / bootstrap.GRANT.name
        ledger = self.root / 'mailbox' / bootstrap.LEDGER.name
        self.assertFalse(json.loads(grant.read_bytes())['active'])
        identity, content = ledger.stat().st_ino, ledger.read_bytes()
        self.install()
        self.assertEqual((ledger.stat().st_ino, ledger.read_bytes()), (identity, content))
        self.assertTrue(json.loads(grant.read_bytes())['active'])

    def test_manifest_activation_source_and_existing_key_pins(self):
        with self.assertRaisesRegex(ValueError, 'manifest hash'):
            bootstrap.load_bundle(self.packet, '0' * 64, self.active_sha)
        with self.assertRaisesRegex(ValueError, 'activation hash'):
            bootstrap.load_bundle(self.packet, bootstrap.digest(self.manifest), '0' * 64)
        source = self.root / 'packet' / 'check.py'
        source.write_bytes(source.read_bytes() + b'\n# changed\n')
        with self.assertRaisesRegex(ValueError, 'source mismatch'):
            bootstrap.load_bundle(self.packet, bootstrap.digest(self.manifest), self.active_sha)
        old = self.root / 'policy' / bootstrap.WEB_SIGNERS.name
        old.write_bytes(self.content['allowed_signers'])
        with self.assertRaisesRegex(ValueError, 'retain the existing'):
            self.install()
        old.write_bytes(b'foreign public key\n')
        with self.assertRaisesRegex(ValueError, 'retain the existing'):
            self.install()
        self.assertFalse((self.root / 'libexec' / bootstrap.CHECKER.name).exists())

    def test_ledger_inode_mode_and_hardlink_are_not_reset(self):
        self.install()
        ledger = self.root / 'mailbox' / bootstrap.LEDGER.name
        data = ledger.read_bytes()
        other = ledger.with_name('replacement')
        other.write_bytes(data)
        other.chmod(0o600)
        other.replace(ledger)
        with self.assertRaisesRegex(ValueError, 'replaced ledger'):
            self.install()
        ledger.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'Unsafe file metadata'):
            self.install()
        ledger.chmod(0o600)
        os.link(ledger, other)
        with self.assertRaisesRegex(ValueError, 'Unsafe file metadata'):
            self.install()


if __name__ == '__main__':
    unittest.main()
