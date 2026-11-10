import contextlib
import hashlib
import importlib.util
import io
import json
import os
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


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='peripheral-installer-')
        self.root = Path(self.temp.name)
        self.packet = self.root / 'packet'
        self.packet.mkdir()
        self.release = self.root / 'release'
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
            'RELEASE': str(self.release), 'PROFILE': str(self.profile), 'UNIT': str(self.unit),
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
        self.web_data = json.dumps({'serviceName': 'show-tools-web.service', 'origin': 'https://proxmox.tail54fc55.ts.net:8443', 'connectAddress': '100.93.139.99', 'tokenFile': str(self.token)}).encode()
        self.write(self.web, self.web_data)
        self.profile_data = json.dumps({'version': 1, 'origin': 'https://proxmox.tail54fc55.ts.net:8443', 'connectAddress': '100.93.139.99', 'tokenFile': str(self.token), 'helperExecutable': str(self.release) + '/native/peripheral/peripheral-host', 'sdkChannel': 0, 'bindingRevision': 1, 'buttonKey': 'escape', 'jiggle': {'minimumTravel': 4, 'minimumReversal': 2}}).encode()
        self.unit_data = ('[Unit]\nDescription=Show Tools peripheral controller\nStartLimitIntervalSec=0\n\n[Service]\nType=exec\nExecStart="' + str(self.release) + '/bin/show-tools-peripheral" serve --config "' + str(self.profile) + '"\nRestart=on-abnormal\nRestartSec=3s\nKillMode=control-group\nTimeoutStopSec=15s\nSendSIGKILL=yes\nUMask=0077\n\n[Install]\nWantedBy=default.target\n').encode()
        packet_files = {'install.py': Path(m.__file__).read_bytes(), 'profile.json': self.profile_data, m.UNIT_NAME: self.unit_data}
        for name, data in packet_files.items(): self.write(self.packet / name, data)
        release_pins = {}
        for name in m.RELEASE_FILES:
            data = ('synthetic owned release fixture ' + name).encode()
            self.write(self.release / name, data, 0o700)
            release_pins[name] = m.digest(data)
        self.manifest = {'schemaVersion': 1, 'sourceRevision': m.REVISION, 'webProfileSha256': m.digest(self.web_data), 'files': {name: m.digest(data) for name, data in packet_files.items()}, 'releaseFiles': release_pins}
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
            if action == 'enable': self.wants.joinpath(m.UNIT_NAME).symlink_to(self.unit); return ''
            if action == 'start': self.state = 'active'; return ''
        if args == [str(self.release) + '/bin/show-tools-session', 'audio', 'status', '--profile', str(self.web)]: return getattr(self, 'audio', 'Audio off')
        raise AssertionError('Unexpected command ' + str(args))

    def run_apply(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output): m.apply(self.packet, self.manifest_pin)
        self.assertNotIn('owned-test-token', output.getvalue())
        return json.loads(output.getvalue())

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
        with self.assertRaisesRegex(ValueError, 'Performance active'): self.run_apply()
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
        with self.assertRaises(ValueError): m.validate_profile(profile)
        for value in (None, {'minimumTravel': True, 'minimumReversal': 1}, {'minimumTravel': 1, 'minimumReversal': 2}):
            with self.subTest(value=value):
                with self.assertRaises(ValueError): m.validate_profile({**json.loads(self.profile_data), 'jiggle': value})
        with self.assertRaises(ValueError): m.validate_profile({**json.loads(self.profile_data), 'caFile': '/arbitrary'})

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

    def test_strict_json_rejects_duplicate_and_nonfinite_values(self):
        for value in (b'{"a":1,"a":2}', b'{"a":NaN}'):
            with self.assertRaises(ValueError): m.strict_json(value)


if __name__ == '__main__': unittest.main()
