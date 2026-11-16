import contextlib
import hashlib
import importlib.util
import io
import json
import os
import signal
import subprocess
import sys
import time
from pathlib import Path
import tempfile
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
directory_impl = m.directory
private_group_impl = m.private_group
command_impl = m.command
REVISION = 'd8fa3cf199496d0f4897357f8e9cfad9f1415e9c'
WEB_REVISION = '1' * 40


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='peripheral-installer-')
        self.root = Path(self.temp.name)
        self.packet = self.root / 'packet'
        self.packet.mkdir()
        self.release = self.root / ('releases/session-' + REVISION[:7])
        self.home = self.root / 'home'
        self.profile = self.home / '.config/show-tools/peripheral.json'
        self.unit = self.home / '.config/systemd/user/show-tools-peripheral.service'
        self.web = self.profile.with_name('session.json')
        self.token = self.home / '.config/show-tools/credentials/token'
        self.wants = self.unit.parent / 'default.target.wants'
        for path in (self.profile.parent, self.unit.parent, self.token.parent, self.wants): path.mkdir(parents=True, exist_ok=True)
        self.calls = []
        self.state = 'missing'
        self.patches = [patch.object(m, name, value) for name, value in {
            'UID': os.getuid(), 'GID': os.getgid(), 'HOME': str(self.home),
            'RELEASE_ROOT': str(self.release.parent), 'PROFILE': str(self.profile), 'UNIT': str(self.unit),
            'WEB_PROFILE': str(self.web), 'TOKEN': str(self.token), 'WANTS': str(self.wants),
            'private_group': lambda: None,
            # Real leaf O_NOFOLLOW/create-only/permission behavior, with owned temp ancestry.
            'directory': lambda path: os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW),
            'command': self.command,
        }.items()]
        self.patches += [patch.object(m.sys, 'platform', 'linux'), patch.object(m.socket, 'gethostname', lambda: 'proxmox')]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
        self.addCleanup(self.temp.cleanup)
        self.old_umask = os.umask(0o077)
        self.addCleanup(lambda: os.umask(self.old_umask))
        self.write(self.token, b'owned-test-token-never-output')
        self.web_data = json.dumps({'serviceName': 'show-tools-web.service', 'origin': 'https://proxmox.tail54fc55.ts.net:8443', 'connectAddress': '100.93.139.99', 'tokenFile': str(self.token), 'server': {'nodeExecutable': str(self.release.parent / ('session-' + WEB_REVISION[:7])) + '/runtime/node', 'entrypoint': str(self.release.parent / ('session-' + WEB_REVISION[:7])) + '/gateway/server.mjs'}}).encode()
        self.write(self.web, self.web_data)
        self.profile_data = json.dumps({'version': 2, 'origin': 'https://proxmox.tail54fc55.ts.net:8443', 'connectAddress': '100.93.139.99', 'tokenFile': str(self.token), 'helperExecutable': str(self.release) + '/native/peripheral/peripheral-host', 'bindingRevision': 1, 'inputMap': {'sources': [{'kind': 'linux', 'id': 'synthetic', 'interfaceNumber': 2, 'eventTypes': [0, 1], 'keyCodes': [41], 'relativeAxes': []}], 'switches': [{'controlId': 'blue', 'sourceId': 'synthetic', 'type': 1, 'code': 41}], 'leds': [], 'confirmWiring': False}, 'jiggle': {'minimumTravel': 4, 'minimumReversal': 2}}).encode()
        self.unit_data = ('[Unit]\nDescription=Show Tools peripheral controller\nStartLimitIntervalSec=0\n\n[Service]\nType=exec\nExecStart="' + str(self.release) + '/bin/show-tools-peripheral" serve --config "' + str(self.profile) + '"\nRestart=on-abnormal\nRestartSec=3s\nKillMode=control-group\nTimeoutStopSec=15s\nSendSIGKILL=yes\nUMask=0077\n\n[Install]\nWantedBy=default.target\n').encode()
        packet_files = {'install.py': Path(m.__file__).read_bytes(), 'profile.json': self.profile_data, m.UNIT_NAME: self.unit_data}
        for name, data in packet_files.items(): self.write(self.packet / name, data)
        release_pins = {}
        for name in m.RELEASE_FILES:
            data = json.dumps({'sourceRevision': REVISION}).encode() if name == 'release.json' else ('synthetic owned release fixture ' + name).encode()
            self.write(self.release / name, data, 0o700)
            release_pins[name] = m.digest(data)
        self.manifest = {'schemaVersion': 2, 'sourceRevision': REVISION, 'webSourceRevision': WEB_REVISION, 'installerSourceRevision': '3' * 40, 'webProfileSha256': m.digest(self.web_data), 'files': {name: m.digest(data) for name, data in packet_files.items()}, 'releaseFiles': release_pins}
        self.manifest_pin = self.pin_manifest()

    def write(self, path, data, mode=0o600):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        path.chmod(mode)

    def pin_manifest(self):
        data = json.dumps(self.manifest).encode()
        self.write(self.packet / 'manifest.json', data)
        return m.digest(data)

    def command(self, args, allowed=(0,)):
        self.calls.append(args)
        require_prefix = ['/usr/bin/systemctl', '--user']
        if args[:2] == require_prefix:
            action = args[2]
            if action == 'show-environment': return getattr(self, 'manager_environment', 'PATH=/usr/bin:/bin')
            if action == 'show':
                present = self.state != 'missing'
                return '\n'.join(['LoadState=' + ('loaded' if present else 'not-found'),
                    'ActiveState=' + ('active' if self.state == 'active' else 'inactive'),
                    'MainPID=' + ('123' if self.state == 'active' else '0'),
                    'FragmentPath=' + (str(self.unit) if present else ''),
                    'DropInPaths=', 'TasksCurrent=' + ('1' if self.state == 'active' else '0'), 'NeedDaemonReload=no'])
            if action == 'daemon-reload': self.state = 'loaded'; return ''
            if action == 'enable':
                if not self.wants.joinpath(m.UNIT_NAME).exists(): self.wants.joinpath(m.UNIT_NAME).symlink_to(self.unit)
                return ''
            if action == 'start': self.state = 'active'; return ''
        if args == [str(self.release) + '/bin/show-tools-session', 'audio', 'status', '--profile', str(self.web)]: return self.audio.pop(0) if isinstance(getattr(self, 'audio', None), list) else getattr(self, 'audio', 'Audio off')
        raise AssertionError('Unexpected command ' + str(args))

    def run_apply(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output): m.apply(self.packet, self.manifest_pin)
        self.assertNotIn('owned-test-token', output.getvalue())
        return json.loads(output.getvalue())

    def waiting_packet(self):
        source = Path(m.__file__).parent.parent.joinpath('bridge-cli.ts').read_bytes()
        self.write(self.release / m.WAITING_SOURCE, source)
        self.manifest = {
            'schemaVersion': 3, 'mode': 'waiting-configuration',
            'sourceRevision': REVISION, 'installerSourceRevision': '3' * 40,
            'waitingCliSourceSha256': m.digest(source),
            'files': {name: value for name, value in self.manifest['files'].items() if name != 'profile.json'},
            'releaseFiles': {**self.manifest['releaseFiles'], m.WAITING_SOURCE: m.digest(source)},
        }
        self.manifest_pin = self.pin_manifest()

    def test_waiting_installs_only_unit_without_credentials_web_or_audio_calls(self):
        self.waiting_packet()
        self.web.unlink()
        self.token.unlink()
        result = self.run_apply()
        self.assertEqual(result['mode'], 'waiting-configuration')
        self.assertTrue(result['active'])
        self.assertFalse(self.profile.exists())
        self.assertEqual(self.unit.read_bytes(), self.unit_data)
        self.assertTrue(self.wants.joinpath(m.UNIT_NAME).is_symlink())
        self.assertTrue(all(call[:2] == ['/usr/bin/systemctl', '--user'] for call in self.calls))
        self.calls.clear()
        self.assertFalse(self.run_apply()['changed'])
        self.assertEqual([args[2] for args in self.calls], ['show-environment', 'show'])

    def test_waiting_refuses_existing_valid_invalid_and_dangling_profile_before_service_calls(self):
        self.waiting_packet()
        for data in (self.profile_data, b'{}', b'not JSON'):
            with self.subTest(data=data):
                self.write(self.profile, data)
                with self.assertRaisesRegex(ValueError, 'requires absent'): self.run_apply()
                self.assertEqual(self.profile.read_bytes(), data)
                self.assertEqual(self.calls, [])
                self.profile.unlink()
        self.profile.symlink_to(self.root / 'absent-target')
        with self.assertRaisesRegex(ValueError, 'requires absent'): self.run_apply()
        self.assertTrue(self.profile.is_symlink())
        self.assertEqual(self.calls, [])

    def test_waiting_late_configuration_blocks_start_and_preserves_installed_evidence(self):
        self.waiting_packet()
        original = self.command
        def create_before_start(args, **kwargs):
            result = original(args, **kwargs)
            if args[2] == 'enable': self.write(self.profile, b'concurrent configuration')
            return result
        with patch.object(m, 'command', side_effect=create_before_start):
            with self.assertRaisesRegex(ValueError, 'requires absent'): self.run_apply()
        self.assertEqual(self.profile.read_bytes(), b'concurrent configuration')
        self.assertEqual(self.unit.read_bytes(), self.unit_data)
        self.assertFalse(any('start' in call for call in self.calls))
        self.assertTrue(self.wants.joinpath(m.UNIT_NAME).is_symlink())

    def test_waiting_source_pin_and_manifest_mode_gate_manager_calls(self):
        self.waiting_packet()
        source = self.release / m.WAITING_SOURCE
        source.write_bytes(b'old CLI with no missing-configuration wait')
        with self.assertRaisesRegex(ValueError, 'release checksum'): self.run_apply()
        self.assertEqual(self.calls, [])
        self.manifest['mode'] = 'unknown'
        self.manifest_pin = self.pin_manifest()
        with self.assertRaisesRegex(ValueError, 'manifest fields'): self.run_apply()
        self.assertEqual(self.calls, [])

    def test_success_only_installs_named_controller_and_idempotent_active_rerun_has_no_mutation(self):
        result = self.run_apply()
        self.assertEqual(self.profile.read_bytes(), self.profile_data)
        self.assertEqual(self.unit.read_bytes(), self.unit_data)
        self.assertEqual(self.profile.stat().st_mode & 0o777, 0o600)
        self.assertTrue(result['active'])
        self.assertFalse(result['audioStartRequested'])
        self.assertEqual([args[2] for args in self.calls if args[0] == '/usr/bin/systemctl'], ['show-environment', 'show', 'daemon-reload', 'show', 'enable', 'start', 'show'])
        self.calls.clear()
        self.audio = 'Audio ready; transport playing'
        result = self.run_apply()
        self.assertFalse(result['changed'])
        self.assertEqual([args[2] for args in self.calls], ['show-environment', 'show'])

    def test_every_release_pin_gates_all_service_calls(self):
        for name in m.RELEASE_FILES:
            with self.subTest(name=name):
                original = (self.release / name).read_bytes()
                (self.release / name).write_bytes(b'wrong')
                with self.assertRaisesRegex(ValueError, 'release checksum'): self.run_apply()
                self.assertEqual(self.calls, [])
                (self.release / name).write_bytes(original)

    def test_packet_manifest_pin_and_code_pin_gate_service_calls(self):
        self.manifest_pin = '0' * 64
        with self.assertRaisesRegex(ValueError, 'Manifest differs'): self.run_apply()
        self.assertEqual(self.calls, [])
        self.manifest_pin = self.pin_manifest()
        self.write(self.packet / 'install.py', b'different installer')
        with self.assertRaisesRegex(ValueError, 'Packet checksum'): self.run_apply()
        self.assertEqual(self.calls, [])

    def test_active_performance_holds_before_any_file_install_or_activation(self):
        self.audio = 'Audio ready; transport playing'
        with self.assertRaisesRegex(ValueError, 'Fresh audio-off'): self.run_apply()
        self.assertFalse(self.profile.exists())
        self.assertFalse(self.unit.exists())
        self.assertFalse(any('start' in args or 'enable' in args or 'daemon-reload' in args for args in self.calls))

    def test_foreign_profile_is_never_overwritten(self):
        self.write(self.profile, b'foreign')
        with self.assertRaisesRegex(ValueError, 'Refusing to overwrite'): self.run_apply()
        self.assertEqual(self.profile.read_bytes(), b'foreign')
        self.assertFalse(self.unit.exists())
        self.assertFalse(any('start' in args or 'enable' in args for args in self.calls))

    def test_symlink_profile_and_release_executable_are_refused(self):
        other = self.root / 'other'
        self.write(other, b'protected owned fixture')
        self.profile.symlink_to(other)
        with self.assertRaises(OSError): self.run_apply()
        self.assertEqual(other.read_bytes(), b'protected owned fixture')
        self.profile.unlink()
        executable = self.release / 'runtime/node'
        executable.unlink(); executable.symlink_to(other)
        self.calls.clear()
        with self.assertRaises(OSError): self.run_apply()
        self.assertEqual(self.calls, [])

    def test_incorrect_web_profile_and_unsafe_token_permissions_hold_before_service_calls(self):
        self.web.write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'Web profile differs'): self.run_apply()
        self.assertEqual(self.calls, [])
        self.web.write_bytes(self.web_data)
        self.token.chmod(0o640)
        with self.assertRaisesRegex(ValueError, 'token metadata'): self.run_apply()
        self.assertEqual(self.calls, [])

    def test_create_only_file_is_atomic_and_exact_existing_is_idempotent(self):
        m.install_file(str(self.profile), b'complete')
        self.assertFalse(m.install_file(str(self.profile), b'complete'))
        with self.assertRaisesRegex(ValueError, 'overwrite'): m.install_file(str(self.profile), b'changed')
        self.assertEqual(self.profile.read_bytes(), b'complete')
        self.assertFalse(list(self.profile.parent.glob('.show-tools-peripheral-*')))

    def test_profile_requires_explicit_jiggle_and_refuses_extra_or_ca_fields(self):
        profile = json.loads(self.profile_data)
        del profile['jiggle']
        with self.assertRaises(ValueError): m.validate_profile(profile, str(self.release))
        m.validate_profile({**json.loads(self.profile_data), 'jiggle': None}, str(self.release))
        for value in ({'minimumTravel': True, 'minimumReversal': 1}, {'minimumTravel': 1, 'minimumReversal': 2}):
            with self.subTest(value=value):
                with self.assertRaises(ValueError): m.validate_profile({**json.loads(self.profile_data), 'jiggle': value}, str(self.release))
        with self.assertRaises(ValueError): m.validate_profile({**json.loads(self.profile_data), 'caFile': '/arbitrary'}, str(self.release))

    def test_map_requires_observed_linux_inputs_and_never_translates_legacy_keys(self):
        profile = json.loads(self.profile_data)
        m.validate_profile(profile, str(self.release))
        legacy = {key: value for key, value in profile.items() if key != 'inputMap'}
        legacy.update(version=1, sdkChannel=0, buttonKey='escape')
        with self.assertRaises(ValueError): m.validate_profile(legacy, str(self.release))
        for change in ('missing-source', 'unobserved-code', 'alias', 'unsorted', 'unconfirmed-led', 'musical-target', 'hid-source'):
            mapping = json.loads(self.profile_data)['inputMap']
            if change == 'missing-source': mapping['switches'][0]['sourceId'] = 'missing'
            elif change == 'unobserved-code': mapping['switches'][0]['code'] = 99
            elif change == 'alias': mapping['switches'].append({**mapping['switches'][0], 'controlId': 'yellow'})
            elif change == 'unsorted': mapping['sources'][0]['keyCodes'] = [42, 41]
            elif change == 'unconfirmed-led': mapping['leds'] = [{'controlId': 'blue', 'sdkChannel': 0}]
            elif change == 'musical-target': mapping['switches'][0]['target'] = 'R1'
            elif change == 'hid-source': mapping['sources'][0]['kind'] = 'hid'
            with self.subTest(change=change):
                with self.assertRaises(ValueError): m.validate_profile({**profile, 'inputMap': mapping}, str(self.release))

    def test_root_and_wrong_host_are_refused_before_any_action(self):
        with patch.object(m.os, 'getuid', lambda: -1):
            with self.assertRaisesRegex(ValueError, 'UID/GID'): self.run_apply()
        with patch.object(m.socket, 'gethostname', lambda: 'other-host'):
            with self.assertRaisesRegex(ValueError, 'Wrong application host'): self.run_apply()
        self.assertEqual(self.calls, [])

    def test_retained_private_group_0775_unit_ancestry_is_accepted_without_chmod(self):
        def metadata(uid, gid, mode):
            return os.stat_result((stat.S_IFDIR | mode, 1, 1, 1, uid, gid, 0, 0, 0, 0))
        values = [metadata(0, 0, 0o755), metadata(0, 0, 0o755)] + [metadata(1000, 1000, 0o775)] * 4
        with patch.object(m, 'HOME', '/home/anulman'), patch.object(m, 'UID', 1000), patch.object(m, 'GID', 1000), patch.object(m.os, 'open', side_effect=range(10, 16)) as opened, patch.object(m.os, 'fstat', side_effect=values), patch.object(m.os, 'close'), patch.object(m.os, 'listxattr', return_value=[], create=True), patch.object(m.os, 'chmod') as chmod:
            self.assertEqual(directory_impl('/home/anulman/.config/systemd/user'), 15)
            self.assertTrue(all(call.args[1] & os.O_NOFOLLOW for call in opened.call_args_list[1:]))
            chmod.assert_not_called()
        values[1] = metadata(0, 0, 0o775)
        with patch.object(m, 'HOME', '/home/anulman'), patch.object(m, 'UID', 1000), patch.object(m, 'GID', 1000), patch.object(m.os, 'open', side_effect=range(10, 16)), patch.object(m.os, 'fstat', side_effect=values), patch.object(m.os, 'close'), patch.object(m.os, 'listxattr', return_value=[], create=True):
            with self.assertRaisesRegex(ValueError, 'group-writable ancestor'):
                directory_impl('/home/anulman/.config/systemd/user')

    def test_private_group_exception_refuses_other_members_or_primary_group_users(self):
        account = SimpleNamespace(pw_name='anulman', pw_gid=1000, pw_dir='/home/anulman')
        group = SimpleNamespace(gr_name='anulman', gr_mem=[])
        with patch.object(m, 'HOME', '/home/anulman'), patch.object(m, 'UID', 1000), patch.object(m, 'GID', 1000), patch.object(m.pwd, 'getpwuid', return_value=account), patch.object(m.grp, 'getgrgid', return_value=group), patch.object(m.pwd, 'getpwall', return_value=[account]) as users:
            private_group_impl()
            group.gr_mem = ['other']
            with self.assertRaisesRegex(ValueError, 'private group'): private_group_impl()
            group.gr_mem = []
            users.return_value = [account, SimpleNamespace(pw_name='other', pw_gid=1000)]
            with self.assertRaisesRegex(ValueError, 'private group'): private_group_impl()

    def test_hostile_or_absent_manager_path_holds_before_any_install_or_activation(self):
        for environment in ('PATH=/tmp/unreviewed-bin:/usr/bin:/bin', 'LANG=C', 'PATH=:/usr/bin', 'PATH=relative:/usr/bin'):
            with self.subTest(environment=environment):
                self.manager_environment = environment
                self.calls.clear()
                with self.assertRaises(ValueError) as raised: self.run_apply()
                self.assertNotIn(environment.split('=', 1)[-1], str(raised.exception))
                self.assertFalse(self.profile.exists())
                self.assertFalse(self.unit.exists())
                self.assertEqual(self.calls, [['/usr/bin/systemctl', '--user', 'show-environment']])

    def test_trusted_manager_path_resolves_protected_os_dirname_and_allows_benign_node_env(self):
        canonical = m.validate_runtime_environment('PATH=/usr/bin:/bin\nNODE_ENV=production')
        self.assertEqual(canonical, os.path.realpath('/usr/bin/dirname'))
        with self.assertRaisesRegex(ValueError, 'PATH must be explicitly'): m.validate_runtime_environment('LANG=C')

    def test_runtime_overrides_report_names_without_values(self):
        names = ['NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_PATH', 'LD_PRELOAD', 'LD_AUDIT', 'DYLD_INSERT_LIBRARIES', 'OPENSSL_CONF', 'OPENSSL_MODULES', 'ENV', 'BASH_ENV']
        for name in names:
            with self.subTest(name=name):
                with self.assertRaises(ValueError) as raised:
                    m.validate_runtime_environment('PATH=/usr/bin:/bin\n' + name + '=SECRET-VALUE-NEVER-PRINT')
                self.assertIn(name, str(raised.exception))
                self.assertNotIn('SECRET-VALUE', str(raised.exception))

    def test_disabled_jiggle_profile_installs_without_threshold_defaults(self):
        profile = json.loads(self.profile_data)
        profile['jiggle'] = None
        self.profile_data = json.dumps(profile).encode()
        self.write(self.packet / 'profile.json', self.profile_data)
        self.manifest['files']['profile.json'] = m.digest(self.profile_data)
        self.manifest_pin = self.pin_manifest()
        self.assertTrue(self.run_apply()['active'])
        self.assertIsNone(json.loads(self.profile.read_bytes())['jiggle'])

    def test_independent_release_revisions_are_required_and_web_prefix_is_checked(self):
        self.manifest['sourceRevision'] = '../outside'
        self.manifest_pin = self.pin_manifest()
        with self.assertRaisesRegex(ValueError, 'full release revisions'): self.run_apply()
        self.assertEqual(self.calls, [])
        self.manifest['sourceRevision'] = REVISION
        self.manifest['webSourceRevision'] = '2' * 40
        self.manifest_pin = self.pin_manifest()
        with self.assertRaisesRegex(ValueError, 'separately reviewed release'): self.run_apply()
        self.assertEqual(self.calls, [])

    def test_hardlinks_in_every_metadata_boundary_hold_before_service_calls(self):
        self.write(self.profile, self.profile_data)
        self.write(self.unit, self.unit_data)
        targets = [self.packet / name for name in ('manifest.json', 'install.py', 'profile.json', m.UNIT_NAME)]
        targets += [self.release / name for name in m.RELEASE_FILES]
        targets += [self.profile, self.unit, self.web, self.token]
        for index, target in enumerate(targets):
            with self.subTest(target=target.name):
                alias = self.root / ('hardlink-' + str(index))
                os.link(target, alias)
                try:
                    with self.assertRaises(ValueError): self.run_apply()
                    self.assertEqual(self.calls, [])
                finally: alias.unlink()

    def test_publication_unlink_is_followed_by_directory_fsync_then_independent_readback(self):
        events = []
        fsync, unlink, read = m.os.fsync, m.os.unlink, m.file_bytes
        def sync(fd):
            events.append('dirsync' if stat.S_ISDIR(os.fstat(fd).st_mode) else 'filesync')
            return fsync(fd)
        def remove(*args, **kwargs):
            events.append('unlink')
            return unlink(*args, **kwargs)
        def readback(*args, **kwargs):
            if self.profile.exists(): events.append('readback')
            return read(*args, **kwargs)
        with patch.object(m.os, 'fsync', side_effect=sync), patch.object(m.os, 'unlink', side_effect=remove), patch.object(m, 'file_bytes', side_effect=readback):
            m.install_file(str(self.profile), b'complete')
        self.assertEqual(events, ['filesync', 'dirsync', 'unlink', 'dirsync', 'readback'])
        self.assertEqual(self.profile.stat().st_nlink, 1)

    def test_partial_publication_fsync_failure_holds_and_exact_singlelink_retry_is_safe(self):
        original = m.os.fsync
        calls = 0
        def fail_once(fd):
            nonlocal calls
            calls += 1
            if calls == 2: raise OSError('injected publication directory fsync failure')
            return original(fd)
        with patch.object(m.os, 'fsync', side_effect=fail_once):
            with self.assertRaises(OSError): m.install_file(str(self.profile), b'complete')
        self.assertEqual(self.profile.read_bytes(), b'complete')
        self.assertEqual(self.profile.stat().st_nlink, 1)
        self.assertFalse(m.install_file(str(self.profile), b'complete'))

    def test_unlink_failure_retains_linked_evidence_and_retry_fails_closed(self):
        with patch.object(m.os, 'unlink', side_effect=OSError('injected temporary unlink failure')):
            with self.assertRaises(OSError): m.install_file(str(self.profile), b'complete')
        self.assertEqual(self.profile.stat().st_nlink, 2)
        self.assertEqual(len(list(self.profile.parent.glob('.show-tools-peripheral-*'))), 1)
        with self.assertRaises(ValueError): m.install_file(str(self.profile), b'complete')
        self.assertEqual(self.calls, [])

    def test_final_independent_readback_rejects_postpublication_metadata_drift(self):
        original = m.os.unlink
        def change_after_unlink(*args, **kwargs):
            result = original(*args, **kwargs)
            self.profile.chmod(0o640)
            return result
        with patch.object(m.os, 'unlink', side_effect=change_after_unlink):
            with self.assertRaisesRegex(ValueError, 'Unsafe file mode'): m.install_file(str(self.profile), b'complete')
        self.assertEqual(self.profile.read_bytes(), b'complete')
        self.assertEqual(self.calls, [])

    def test_ready_audio_idle_and_ended_do_not_authorize_initial_activation(self):
        for status in ('Audio ready; transport idle', 'Audio ready; transport ended', 'Audio ready; transport count-in'):
            self.audio = status
            self.calls.clear()
            with self.assertRaisesRegex(ValueError, 'Fresh audio-off'): self.run_apply()
            self.assertFalse(self.profile.exists())
            self.assertFalse(self.unit.exists())
            self.assertFalse(any('enable' in call or 'start' in call for call in self.calls))

    def test_audio_must_still_be_off_immediately_before_start_without_forcing_it(self):
        self.audio = ['Audio off', 'Audio ready; transport idle']
        with self.assertRaisesRegex(ValueError, 'before start'): self.run_apply()
        self.assertTrue(self.profile.exists())
        self.assertTrue(self.unit.exists())
        self.assertFalse(any('start' in call for call in self.calls))
        self.assertFalse(any('off' in call or 'stop' in call for call in self.calls))

    def test_fifo_is_opened_nonblocking_and_rejected_before_read(self):
        fifo = self.root / 'fifo'
        os.mkfifo(fifo, 0o600)
        driver = """
import importlib.util,os,sys
spec=importlib.util.spec_from_file_location('fifo_installer',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m.UID=os.getuid();m.GID=os.getgid();m.directory=lambda path:os.open(path,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
try:m.file_bytes(sys.argv[2],private=True)
except ValueError:print('nonregular rejected');sys.exit(0)
sys.exit(1)
"""
        result = subprocess.run([sys.executable, '-I', '-c', driver, str(Path(m.__file__).resolve()), str(fifo)], capture_output=True, text=True, timeout=2)
        self.assertEqual((result.returncode,result.stdout.strip()), (0,'nonregular rejected'))
        self.assertEqual(self.calls, [])


    def test_strict_json_rejects_duplicate_and_nonfinite_values(self):
        for value in (b'{"a":1,"a":2}', b'{"a":NaN}'):
            with self.assertRaises(ValueError): m.strict_json(value)


class CommandClientTests(unittest.TestCase):
    def setUp(self):
        if sys.platform == 'darwin':
            original = os.killpg
            def darwin_empty_group(pid, action):
                try:
                    return original(pid, action)
                except PermissionError:
                    # Darwin reports EPERM for an exited child-only group. Normalize
                    # only after a non-reaping wait confirms this is our dead child.
                    exited = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
                    if action == signal.SIGKILL and exited is not None and exited.si_pid == pid:
                        raise ProcessLookupError from None
                    raise
            self.normalized = patch.object(m.os, 'killpg', side_effect=darwin_empty_group)
            self.normalized.start()
            self.addCleanup(self.normalized.stop)

    def run_client(self, code, **options):
        return command_impl([sys.executable, '-I', '-c', code], **options)

    def test_exact_output_bound_succeeds_and_stdout_stderr_overflow_fail(self):
        self.assertEqual(self.run_client("import sys; sys.stdout.write('x'*64)", output_limit=64), 'x'*64)
        for stream in ('stdout', 'stderr'):
            with self.subTest(stream=stream):
                with self.assertRaisesRegex(ValueError, 'output limit'):
                    self.run_client("import sys,time; sys.%s.write('x'*65); sys.%s.flush(); time.sleep(30)" % (stream, stream), output_limit=64)

    def test_capture_deadline_and_pipe_closed_live_client_are_cleaned_up(self):
        original = m.subprocess.Popen
        for code in ("import time; time.sleep(30)", "import os,time; os.close(1); os.close(2); time.sleep(30)"):
            clients = []
            def spawn(*args, **kwargs):
                child = original(*args, **kwargs); clients.append(child); return child
            with patch.object(m.subprocess, 'Popen', side_effect=spawn):
                began = time.monotonic()
                with self.assertRaisesRegex(ValueError, 'deadline'):
                    self.run_client(code, timeout=0.1)
                self.assertLess(time.monotonic()-began, 2)
                self.assertIsNotNone(clients[0].returncode)

    def test_client_failure_retains_daemon_effect_evidence_and_does_not_kill_other_session(self):
        service = subprocess.Popen([sys.executable, '-I', '-c', 'import time; time.sleep(30)'], start_new_session=True)
        try:
            with tempfile.TemporaryDirectory(prefix='client-effects-') as root:
                marker = str(Path(root) / 'effect')
                code = "from pathlib import Path; import sys,time; Path(%r).write_text('daemon request may have applied'); sys.stdout.write('x'*65); sys.stdout.flush(); time.sleep(30)" % marker
                with self.assertRaisesRegex(ValueError, 'effects uncertain'):
                    self.run_client(code, output_limit=64)
                self.assertEqual(Path(marker).read_text(), 'daemon request may have applied')
                self.assertIsNone(service.poll())
        finally:
            service.terminate(); service.wait(timeout=2)

    def test_metadata_failure_still_kills_and_reaps_owned_client(self):
        clients = []
        original = m.subprocess.Popen
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs); clients.append(child); return child
        with patch.object(m.subprocess, 'Popen', side_effect=spawn), patch.object(m, 'owned_group_live', side_effect=ValueError('metadata unavailable')):
            with self.assertRaisesRegex(ValueError, 'deadline'):
                self.run_client("import time; time.sleep(30)", timeout=.1)
        self.assertIsNotNone(clients[0].returncode)

    def test_exited_leader_cannot_leave_same_group_heartbeat_running(self):
        service = subprocess.Popen([sys.executable, '-I', '-c', 'import time; time.sleep(30)'], start_new_session=True)
        try:
            for exit_code in (0, 3):
                with self.subTest(exit_code=exit_code), tempfile.TemporaryDirectory(prefix='owned-descendant-') as root:
                    heartbeat = Path(root) / 'heartbeat'
                    code = """
import os,signal,time
from pathlib import Path
pid=os.fork()
if pid:
 while not Path(%r).exists(): time.sleep(.001)
 os._exit(%d)
os.close(1); os.close(2)
signal.signal(signal.SIGTERM,signal.SIG_IGN)
while True:
 Path(%r).write_text(str(time.monotonic_ns()))
 time.sleep(.005)
""" % (str(heartbeat), exit_code, str(heartbeat))
                    if exit_code:
                        with self.assertRaisesRegex(ValueError, 'client failed'):
                            self.run_client(code)
                    else:
                        self.assertEqual(self.run_client(code), '')
                    before = heartbeat.read_text()
                    time.sleep(.08)
                    self.assertEqual(heartbeat.read_text(), before)
                    self.assertIsNone(service.poll())
        finally:
            service.terminate(); service.wait(timeout=2)

    def test_real_repeat_term_int_hup_cannot_interrupt_owned_client_cleanup(self):
        with tempfile.TemporaryDirectory(prefix='repeat-client-cancel-') as root:
            ready, entered, result = (Path(root) / name for name in ('ready', 'cleanup', 'result'))
            child_code = "import signal,time; from pathlib import Path; [signal.signal(s,signal.SIG_IGN) for s in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP)]; Path(%r).write_text('ready'); time.sleep(30)" % str(ready)
            driver = """
import importlib.util,json,signal,subprocess,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('owned_installer',sys.argv[1]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
clients=[]; spawn=m.subprocess.Popen

def record(*args,**kwargs):
 p=spawn(*args,**kwargs); clients.append(p); return p
m.subprocess.Popen=record
cleanup=m.cleanup_client

def marked(*args):
 Path(sys.argv[3]).write_text('cleanup'); return cleanup(*args)
m.cleanup_client=marked

def interrupted(_signum,_frame): raise InterruptedError('first cancellation')
for value in (signal.SIGTERM,signal.SIGINT,signal.SIGHUP): signal.signal(value,interrupted)
try: m.command([sys.executable,'-I','-c',sys.argv[2]])
except BaseException as error:
 Path(sys.argv[4]).write_text(json.dumps({'error':type(error).__name__,'clientReturncode':clients[0].returncode})); sys.exit(7)
sys.exit(0)
"""
            parent = subprocess.Popen([sys.executable, '-I', '-c', driver, str(Path(m.__file__).resolve()), child_code, str(entered), str(result)])
            try:
                for _ in range(300):
                    if ready.exists(): break
                    time.sleep(0.01)
                self.assertTrue(ready.exists())
                os.kill(parent.pid, signal.SIGTERM)
                for _ in range(300):
                    if entered.exists(): break
                    time.sleep(0.001)
                self.assertTrue(entered.exists())
                for value in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
                    time.sleep(0.01)
                    try: os.kill(parent.pid, value)
                    except ProcessLookupError: pass
                self.assertEqual(parent.wait(timeout=3), 7)
                evidence = json.loads(result.read_text())
                self.assertTrue(evidence['error'])
                self.assertEqual(evidence['clientReturncode'], -signal.SIGKILL)
            finally:
                if parent.poll() is None: parent.kill(); parent.wait(timeout=2)

    def test_cancellation_cleans_only_owned_client_and_reports_no_success(self):
        clients = []
        original = m.subprocess.Popen
        def spawn(*args, **kwargs):
            child = original(*args, **kwargs); clients.append(child); return child
        with patch.object(m.subprocess, 'Popen', side_effect=spawn), patch.object(m.selectors.DefaultSelector, 'select', side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt): self.run_client("import sys,time; print('ready',flush=True); time.sleep(30)")
        self.assertIsNotNone(clients[0].returncode)


if __name__ == '__main__': unittest.main()
