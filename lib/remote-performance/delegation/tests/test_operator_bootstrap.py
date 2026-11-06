import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import stat
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('operator_bootstrap', ROOT / 'operator-bootstrap.py')
operator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(operator)


def message_fixture():
    rows = []
    for item in json.loads((ROOT / 'tests/fixtures/operator-source-messages.json').read_text()):
        chunks = []
        for part in item['segments']:
            chunks.append(part.encode() if type(part) is str else (ROOT / part['file']).read_bytes()[part['start']:part['end']])
        rows.append((item['id'], b''.join(chunks).decode()))
    return rows


def database(rows):
    db = sqlite3.connect(':memory:')
    db.execute('CREATE TABLE messages (id text primary key, content text not null, created real not null, status text not null, reply text)')
    db.executemany("INSERT INTO messages VALUES (?,?,0,'completed',NULL)", rows)
    return db


class OperatorBootstrap(unittest.TestCase):
    def test_exact_completed_mailbox_rows_reconstruct_all_six_frozen_files(self):
        with contextlib.closing(database(message_fixture())) as db:
            actual = operator.reconstruct(db)
        self.assertEqual(set(actual), set(operator.SOURCES))
        for name, data in actual.items():
            self.assertEqual(data, (ROOT / name).read_bytes())

    @unittest.skipUnless(Path('/proc/self/fd').is_dir(), 'Linux proc fd SQLite integration')
    def test_real_readonly_sqlite_fd_connection_reconstructs_exact_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'mailbox.sqlite3'
            with contextlib.closing(database(message_fixture())) as memory, contextlib.closing(sqlite3.connect(path)) as disk:
                memory.commit()
                memory.backup(disk)
            path.chmod(0o600)
            original_fstat = os.fstat
            def assigned_metadata(fd):
                values = list(original_fstat(fd))
                values[4], values[5] = 1000, 1000
                return os.stat_result(values)
            with patch.object(operator, 'DB', path), patch.object(operator, 'ancestors'), patch.object(Path, 'lstat', return_value=types.SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFDIR | 0o700)), patch.object(operator.os, 'fstat', side_effect=assigned_metadata):
                actual = operator.source_files()
            for name, data in actual.items():
                self.assertEqual(data, (ROOT / name).read_bytes())

    def test_changed_missing_and_oversized_message_fail_closed(self):
        for change in ('changed', 'missing', 'oversized'):
            with self.subTest(change=change), contextlib.closing(database(message_fixture())) as db:
                rid = operator.SOURCES['install.py']['parts'][0][0]
                if change == 'missing':
                    db.execute('DELETE FROM messages WHERE id=?', (rid,))
                else:
                    db.execute('UPDATE messages SET content=? WHERE id=?', ('modified' if change == 'changed' else 'x' * 16001, rid))
                with self.assertRaisesRegex(ValueError, 'source message'):
                    operator.reconstruct(db)

    def test_recursive_view_is_rejected_without_running_its_payload(self):
        with contextlib.closing(sqlite3.connect(':memory:')) as db:
            db.execute("CREATE VIEW messages AS WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT 'x' id, group_concat(x) content,0.0 created,'completed' status,NULL reply FROM n")
            with self.assertRaisesRegex(ValueError, 'ordinary mailbox table required'):
                operator.reconstruct(db)

    def test_virtual_or_generated_schema_cannot_replace_mailbox_table(self):
        with contextlib.closing(sqlite3.connect(':memory:')) as db:
            db.execute('CREATE TABLE messages (id text, content text, created real, status text, reply text, extra text GENERATED ALWAYS AS (content) VIRTUAL)')
            with self.assertRaisesRegex(ValueError, 'schema drift'):
                operator.reconstruct(db)

    def test_sql_progress_budget_interrupts_expensive_query(self):
        with contextlib.closing(database(message_fixture())) as db:
            operator.reconstruct(db)
            with self.assertRaisesRegex(sqlite3.OperationalError, 'interrupted'):
                db.execute('WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n) SELECT sum(x) FROM n').fetchone()

    def test_staged_files_are_exclusive_and_identical_retry_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'source'
            with patch.object(operator.os, 'fchown'):
                operator.frozen_file(path, b'fixed source')
            self.assertEqual(path.read_bytes(), b'fixed source')
            with patch.object(operator, 'read_file', return_value=b'fixed source'):
                operator.frozen_file(path, b'fixed source')
            with patch.object(operator, 'read_file', return_value=b'drift'):
                with self.assertRaisesRegex(ValueError, 'drift'):
                    operator.frozen_file(path, b'fixed source')
            self.assertEqual(path.read_bytes(), b'fixed source')

    def test_real_inventory_helper_matches_reviewed_graph_and_rejects_global_unit(self):
        enabled = ['dirmngr.socket', 'gpg-agent-browser.socket', 'gpg-agent-extra.socket', 'gpg-agent-ssh.socket', 'gpg-agent.socket', 'keyboxd.socket', 'ssh-agent.socket']
        graph = {'default.target': ([], ['basic.target']), 'basic.target': (['paths.target', 'sockets.target', 'timers.target'], []), 'paths.target': ([], []), 'timers.target': ([], []), 'sockets.target': (sorted([*enabled, 'dbus.socket']), [])}
        for foreign in (False, True):
            with self.subTest(foreign=foreign):
                def systemctl(args, **kwargs):
                    self.assertEqual(args[:2], ['/usr/bin/systemctl', '--user'])
                    if args[2] == 'list-unit-files':
                        value = ''.join(name + ' enabled enabled\n' for name in enabled)
                    elif args[3] == 'show-tools-web.service':
                        value = 'LoadState=loaded\nFragmentPath=/etc/systemd/user/show-tools-web.service\nDropInPaths=\nActiveState=inactive\n' if foreign else 'LoadState=not-found\nFragmentPath=\nDropInPaths=\nActiveState=inactive\n'
                    else:
                        wants, requires = graph[args[3]]
                        value = 'Wants=' + ' '.join(wants) + '\nRequires=' + ' '.join(requires) + '\n'
                    return types.SimpleNamespace(stdout=value.encode(), stderr=b'')
                output = io.StringIO()
                with patch.object(operator.os, 'getuid', return_value=1000), patch.object(operator.os, 'geteuid', return_value=1000), patch.object(operator.os, 'getgid', return_value=1000), patch.object(operator.sys, 'flags', types.SimpleNamespace(isolated=1)), patch.object(operator.subprocess, 'run', side_effect=systemctl), contextlib.redirect_stdout(output):
                    if foreign:
                        with self.assertRaisesRegex(ValueError, 'foreign loaded web unit'):
                            exec(compile(operator.INVENTORY, '<fixed-readonly-inventory-fixture>', 'exec'), {})
                    else:
                        exec(compile(operator.INVENTORY, '<fixed-readonly-inventory-fixture>', 'exec'), {})
                        self.assertEqual(operator.digest(json.dumps(json.loads(output.getvalue()), sort_keys=True, separators=(',', ':')).encode()), operator.ENABLED_UNITS_SHA256)

    def test_runuser_receives_verified_initializer_bytes_and_exact_argument_order(self):
        with patch.object(operator, 'run', return_value=b'{}') as run:
            operator.as_user(b'verified initializer', ['--operator-approved-bootstrap', operator.INACTIVE])
        run.assert_called_once_with(['/usr/sbin/runuser', '-u', 'anulman', '--', '/usr/bin/python3', '-B', '-I', '-', '--operator-approved-bootstrap', operator.INACTIVE], b'verified initializer')

    def test_fresh_bootstrap_installs_checks_then_activates_before_persistence(self):
        with tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
            stage = Path(folder)
            bundle = stage / 'bundle'
            events = []
            files = {name: (ROOT / name).read_bytes() for name in operator.SOURCES}
            inventory = {'enabled': [], 'graph': {}}
            def user(source, args=()):
                events.append(('user', source, args))
                return json.dumps(inventory if source == operator.INVENTORY else {'unitEnablement': 'pending-unit-install', 'webStarted': False}).encode()
            def run(args, data=None):
                events.append(('run', args))
                return b'yes\n' if 'show-user' in args else b'{}'
            stack.enter_context(patch.object(operator, 'STAGE', stage))
            stack.enter_context(patch.object(operator, '__file__', str(stage / 'operator-bootstrap.py')))
            stack.enter_context(patch.object(operator.sys, 'argv', ['operator-bootstrap.py']))
            stack.enter_context(patch.object(operator.sys, 'flags', types.SimpleNamespace(isolated=1)))
            for name in ('getuid', 'geteuid'):
                stack.enter_context(patch.object(operator.os, name, return_value=0))
            stack.enter_context(patch.object(operator.socket, 'gethostname', return_value='proxmox'))
            stack.enter_context(patch.object(operator.pwd, 'getpwnam', return_value=types.SimpleNamespace(pw_uid=1000, pw_gid=1000, pw_dir='/home/anulman')))
            stack.enter_context(patch.object(operator.grp, 'getgrgid', return_value=types.SimpleNamespace(gr_name='anulman', gr_mem=[])))
            stack.enter_context(patch.object(operator.pwd, 'getpwall', return_value=[types.SimpleNamespace(pw_name='anulman', pw_gid=1000)]))
            stack.enter_context(patch.object(operator, 'ENABLED_UNITS_SHA256', operator.digest(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode())))
            stack.enter_context(patch.object(operator, 'private_directory', side_effect=lambda p: p.mkdir(exist_ok=True)))
            stack.enter_context(patch.object(operator, 'read_file', return_value=b'wrapper'))
            stack.enter_context(patch.object(operator, 'trusted_tools'))
            stack.enter_context(patch.object(operator, 'boundary', side_effect=lambda: events.append(('boundary',))))
            stack.enter_context(patch.object(operator, 'source_files', return_value=files))
            stack.enter_context(patch.object(operator, 'frozen_file', side_effect=lambda p, b: p.write_bytes(b)))
            stack.enter_context(patch.object(operator, 'grant_state', return_value='absent'))
            stack.enter_context(patch.object(operator, 'LEDGER', stage / 'missing-ledger'))
            stack.enter_context(patch.object(operator, 'as_user', side_effect=user))
            stack.enter_context(patch.object(operator, 'run', side_effect=run))
            stack.enter_context(patch.object(operator, 'verify_protected', side_effect=lambda active: events.append(('protected', active))))
            stack.enter_context(patch.object(operator, 'verify_ledger', side_effect=lambda: events.append(('ledger',))))
            result = operator.bootstrap()
            self.assertEqual(result['grant'], 'ACTIVE')
            self.assertEqual(result['piRecognition'], 'still-required')
            self.assertFalse(result['nativeAudioStartRequested'])
            self.assertEqual(result['unitEnablement'], 'pending-unit-install')
            activation = next(i for i, e in enumerate(events) if e[0] == 'run' and 'activate' in e[1])
            self.assertEqual(events[activation - 1], ('protected', False))
            self.assertIn(('ledger',), events[:activation])
            applied = next(i for i, e in enumerate(events) if e[0] == 'user' and e[1] == operator.PERSISTENCE and e[2] == ['--apply'])
            self.assertGreater(applied, activation)
            calls = [e[1] for e in events if e[0] == 'run']
            self.assertEqual(calls[0], ['/usr/bin/python3', '-B', '-I', str(bundle / 'install.py'), 'install', str(bundle), operator.MANIFEST])
            self.assertFalse(any(arg in ('start', 'restart', '--now') for args in calls for arg in args))

    def test_failure_after_activation_reports_actual_active_state(self):
        output = io.StringIO()
        with patch.object(operator, 'bootstrap', side_effect=RuntimeError('persistence failed')), patch.object(operator, 'grant_state', return_value='active'), contextlib.redirect_stdout(output):
            self.assertEqual(operator.main(), 1)
        self.assertEqual(json.loads(output.getvalue())['actualGrantState'], 'active')

    def test_partial_or_prior_ledger_history_is_never_reinitialized(self):
        source = (ROOT / 'initialize-ledger.py').read_text()
        initializer = types.ModuleType('initializer')
        exec(compile(source, 'initializer', 'exec'), initializer.__dict__)
        with tempfile.TemporaryDirectory() as directory:
            ledger = Path(directory) / 'authorization.jsonl'
            initializer.initialize(ledger, 1)
            original = ledger.read_bytes()
            for bad in (original[:-1], original + b'{}\n', b''):
                ledger.write_bytes(bad)
                info = ledger.stat()
                with patch.object(operator, 'LEDGER', ledger), patch.object(operator, 'ancestors'), patch.object(Path, 'lstat', return_value=types.SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFDIR | 0o700)), patch.object(operator.os, 'fstat', return_value=types.SimpleNamespace(st_uid=1000, st_gid=1000, st_mode=stat.S_IFREG | 0o600, st_nlink=1, st_dev=info.st_dev, st_ino=info.st_ino)):
                    with self.assertRaises(ValueError):
                        operator.verify_ledger()
                self.assertEqual(ledger.read_bytes(), bad)


class PersistenceHelpers(unittest.TestCase):
    def execute_helper(self, directory, action):
        parent = Path(directory) / 'systemd/user'
        parent.mkdir(parents=True, exist_ok=True)
        parent.chmod(0o775)
        parent.parent.chmod(0o775)
        original_lstat = Path.lstat
        original_fstat = os.fstat
        def owned(info, uid=1000, gid=1000):
            values = list(info)
            values[4], values[5] = uid, gid
            return os.stat_result(values)
        def lstat(path, *args, **kwargs):
            result = original_lstat(path, *args, **kwargs)
            if path == parent or parent.parent in path.parents or path == parent.parent:
                return owned(result)
            values = list(result)
            values[0] = stat.S_IFDIR | 0o755
            values[4], values[5] = 0, 0
            return os.stat_result(values)
        source = operator.PERSISTENCE.replace(b'/home/anulman/.config/systemd/user', str(parent).encode())
        output = io.StringIO()
        with patch.object(Path, 'lstat', lstat), patch.object(os, 'fstat', side_effect=lambda fd: owned(original_fstat(fd))), patch.object(os, 'getuid', return_value=1000), patch.object(os, 'geteuid', return_value=1000), patch.object(os, 'getgid', return_value=1000), patch.object(operator.sys, 'flags', types.SimpleNamespace(isolated=1)), patch.object(operator.sys, 'argv', ['-', action]), contextlib.redirect_stdout(output):
            exec(compile(source, '<fixed-uid1000-persistence-fixture>', 'exec'), {})
        return parent, json.loads(output.getvalue())

    def test_preflight_is_read_only_then_apply_prepares_only_named_link(self):
        with tempfile.TemporaryDirectory() as directory:
            parent, status = self.execute_helper(directory, '--check')
            self.assertEqual(status['unitEnablement'], 'absent')
            self.assertFalse((parent / 'default.target.wants').exists())
            parent, status = self.execute_helper(directory, '--apply')
            self.assertEqual(status, {'unitEnablement': 'pending-unit-install', 'webStarted': False})
            link = parent / 'default.target.wants/show-tools-web.service'
            self.assertTrue(link.is_symlink())
            self.assertEqual(os.readlink(link), '../show-tools-web.service')
            self.assertEqual(stat.S_IMODE(parent.stat().st_mode), 0o775)
            self.assertEqual(stat.S_IMODE(parent.parent.stat().st_mode), 0o775)
            self.assertEqual(stat.S_IMODE(link.parent.stat().st_mode), 0o700)
            self.execute_helper(directory, '--apply')

    def test_foreign_unit_and_foreign_link_are_preserved_and_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory) / 'systemd/user'
            parent.mkdir(parents=True)
            unit = parent / 'show-tools-web.service'
            unit.write_bytes(b'foreign unit')
            unit.chmod(0o600)
            with self.assertRaisesRegex(ValueError, 'foreign unit bytes'):
                self.execute_helper(directory, '--apply')
            self.assertEqual(unit.read_bytes(), b'foreign unit')
            unit.unlink()
            wants = parent / 'default.target.wants'
            wants.mkdir()
            link = wants / 'show-tools-web.service'
            link.symlink_to('../other.service')
            with self.assertRaisesRegex(ValueError, 'foreign enablement link'):
                self.execute_helper(directory, '--apply')
            self.assertEqual(os.readlink(link), '../other.service')


if __name__ == '__main__':
    unittest.main()
