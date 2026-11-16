"""Owned files/pipes only. No USB, input, HID, audio or service is accessed."""
import importlib.util
import json
import os
from pathlib import Path
import stat
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'bench' / 'raw_keys.py'
spec = importlib.util.spec_from_file_location('raw_keys', SOURCE)
raw = importlib.util.module_from_spec(spec)
spec.loader.exec_module(raw)


def event(value, micros=1000, code=30, kind=1, seconds=1):
    return raw.EVENT.pack(seconds, micros, kind, code, value)


def decoded(value, micros=1000, device='owned-pipe', code=30):
    return next(raw.decode(event(value, micros, code), device))


producer_spec = importlib.util.spec_from_file_location('publish_marker', SOURCE.with_name('publish_marker.py'))
producer = importlib.util.module_from_spec(producer_spec)
producer_spec.loader.exec_module(producer)


def write_marker(directory, op, trial='trial1', nonce='a' * 32):
    return producer.publish_marker(directory, op, trial, nonce)


class ParserTests(unittest.TestCase):
    def test_complete_raw_records(self):
        rows = list(raw.decode(event(1) + event(2, 2000) + event(0, 3000) + event(458782, 3000, code=4, kind=4), 'test-node'))
        self.assertEqual([x['value'] for x in rows], [1, 2, 0, 458782])
        self.assertEqual([x['eventType'] for x in rows], [1, 1, 1, 4])
        self.assertEqual(rows[0]['device'], 'test-node')

    def test_loss_partial_value_and_time_fail(self):
        for data in (b'', b'x', event(0, kind=0, code=3), event(3), event(1, seconds=-1), event(1, micros=1000000)):
            with self.subTest(data=data), self.assertRaises(RuntimeError):
                list(raw.decode(data, 'owned'))

    def test_known_ioctl_encoding(self):
        self.assertEqual(raw.ioctl_read(0x02, 8), 0x80084502)
        self.assertEqual(raw.ioctl_read(0x18, 96), 0x80604518)
        self.assertEqual(raw.bit_codes(bytes([0x81, 0x01])), [0, 7, 8])

    def test_unknown_and_nonempty_snapshot_never_ready(self):
        for rows in ([{'heldStateKnown': False, 'held': []}], [{'heldStateKnown': True, 'held': [30]}], []):
            with self.assertRaises(RuntimeError):
                raw.require_released(rows)


class GateTests(unittest.TestCase):
    def test_three_pairs_with_repeat(self):
        gate = raw.TrialGate(0)
        with self.assertRaises(RuntimeError):
            gate.observe(decoded(1), 1002000000)
        gate.arm(1000000000)
        values = [1, 2, 0, 1, 0, 1, 0]
        for index, value in enumerate(values, 1):
            gate.observe(decoded(value, index * 1000), 1010000000)
        result = gate.result()
        self.assertTrue(result['complete'])
        self.assertEqual(result['keySignatures'][0], {'device': 'owned-pipe', 'code': 30, 'presses': 3, 'releases': 3, 'repeats': 1})
        self.assertEqual(result['heldFromEvents'], [])

    def test_barriers_deadline_and_loss(self):
        gate = raw.TrialGate(0)
        with self.assertRaises(RuntimeError):
            gate.arm(raw.READY_SECONDS * 1000000000)
        gate.arm(1000000000)
        for row, now in ((next(raw.decode(event(1, 999999, seconds=0), 'owned-pipe')), 1000000001), (decoded(1), 1000000000), (decoded(1), gate.deadline)):
            with self.assertRaises(RuntimeError):
                gate.observe(row, now)
        with self.assertRaises(RuntimeError):
            gate.arm(1000000001)
        gate.observe(decoded(1), 1002000000)
        self.assertFalse(gate.result()['complete'])
        for row in (decoded(1, 2000), decoded(0, 500)):
            with self.assertRaises(RuntimeError):
                gate.observe(row, 1003000000)

    def test_orphan_repeat_release_and_ambiguous_sources(self):
        for value in (0, 2):
            gate = raw.TrialGate(0); gate.arm(1000000000)
            with self.assertRaises(RuntimeError):
                gate.observe(decoded(value), 1002000000)
        gate = raw.TrialGate(0); gate.arm(1000000000)
        for name in ('sourceA', 'sourceB'):
            for index, value in enumerate([1, 0, 1, 0, 1, 0], 1):
                gate.observe(decoded(value, index * 1000, name), 1010000000)
        self.assertFalse(gate.result()['complete'])
        self.assertEqual(len(gate.result()['keySignatures']), 2)


class FileTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp.name).resolve()
        self.fd = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        self.uid, self.gid = os.getuid(), os.getgid()

    def tearDown(self):
        os.close(self.fd)
        self.temp.cleanup()

    def marker(self):
        return raw.marker(self.fd, 'arm', 'trial1', 'a' * 32, self.uid, self.gid)

    def test_marker_is_exact_private_and_create_only(self):
        self.assertFalse(self.marker())
        path = write_marker(self.directory, 'arm')
        self.assertTrue(self.marker())
        with self.assertRaises(FileExistsError):
            write_marker(self.directory, 'arm')
        path.chmod(0o644)
        with self.assertRaises(RuntimeError):
            self.marker()
        path.chmod(0o600)
        os.link(path, self.directory / 'second')
        with self.assertRaises(RuntimeError):
            self.marker()

    def test_marker_is_absent_until_complete_publication(self):
        original_write = os.write
        def partial_write(fd, data):
            self.assertFalse(self.marker())
            return original_write(fd, data[:max(1, len(data) // 2)])
        with patch.object(os, 'write', side_effect=partial_write):
            write_marker(self.directory, 'arm')
        self.assertTrue(self.marker())

    def test_producer_rejects_invalid_identity_before_writes(self):
        for args in (('other', 'trial1', 'a' * 32), ('arm', '../trial', 'a' * 32), ('arm', 'trial1', 'b' * 31)):
            with self.subTest(args=args), self.assertRaises(RuntimeError):
                producer.publish_marker(self.directory, *args)
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_producer_refuses_directory_mode_owner_and_symlink(self):
        self.directory.chmod(0o775)
        try:
            with self.assertRaises(RuntimeError):
                write_marker(self.directory, 'arm')
        finally:
            self.directory.chmod(0o700)
        with patch.object(producer.os, 'getuid', return_value=self.uid + 1), self.assertRaises(RuntimeError):
            write_marker(self.directory, 'arm')
        alias = self.directory / 'alias'
        alias.symlink_to(self.directory)
        with self.assertRaises(RuntimeError):
            write_marker(alias, 'arm')
        self.assertEqual(list(self.directory.iterdir()), [alias])

    def test_producer_never_replaces_existing_destination(self):
        destination = self.directory / 'arm.json'
        other = self.directory / 'other'
        other.write_bytes(b'preserve'); other.chmod(0o600)
        for kind in ('symlink', 'hardlink', 'directory'):
            if kind == 'symlink': destination.symlink_to(other)
            elif kind == 'hardlink': os.link(other, destination)
            else: destination.mkdir()
            before = destination.lstat()
            with self.subTest(kind=kind), self.assertRaises(FileExistsError):
                write_marker(self.directory, 'arm')
            self.assertEqual(destination.lstat(), before)
            self.assertEqual(other.read_bytes(), b'preserve')
            if kind == 'directory': destination.rmdir()
            else: destination.unlink()
        self.assertEqual(list(self.directory.iterdir()), [other])

    def test_producer_write_failure_cleans_only_temporary(self):
        with patch.object(producer.os, 'write', side_effect=OSError('synthetic write failure')), self.assertRaises(OSError):
            write_marker(self.directory, 'arm')
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_producer_refuses_linked_temporary(self):
        fsync = os.fsync
        alias = self.directory / 'second-link'
        def linked(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                temporary = next(self.directory.glob('.marker-*'))
                os.link(temporary, alias)
            fsync(fd)
        with patch.object(producer.os, 'fsync', side_effect=linked), self.assertRaises(RuntimeError):
            write_marker(self.directory, 'arm')
        self.assertFalse((self.directory / 'arm.json').exists())
        self.assertEqual(list(self.directory.iterdir()), [alias])

    def test_concurrent_publication_has_one_immutable_winner(self):
        barrier = threading.Barrier(2)
        results = []
        def publish(nonce):
            barrier.wait(timeout=3)
            try:
                write_marker(self.directory, 'arm', nonce=nonce)
                results.append(('published', nonce))
            except FileExistsError:
                results.append(('exists', nonce))
            except BaseException as failure:
                results.append(('error', failure))
        threads = [threading.Thread(target=publish, args=(value * 32,)) for value in ('a', 'b')]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=3)
        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(sorted(result[0] for result in results), ['exists', 'published'])
        nonce = next(result[1] for result in results if result[0] == 'published')
        self.assertTrue(raw.marker(self.fd, 'arm', 'trial1', nonce, self.uid, self.gid))
        self.assertEqual([path.name for path in self.directory.iterdir()], ['arm.json'])

    def test_producer_refuses_changed_temporary_mode(self):
        fsync = os.fsync
        def changed(fd):
            if stat.S_ISREG(os.fstat(fd).st_mode):
                os.fchmod(fd, 0o644)
            fsync(fd)
        with patch.object(producer.os, 'fsync', side_effect=changed), self.assertRaises(RuntimeError):
            write_marker(self.directory, 'arm')
        self.assertEqual(list(self.directory.iterdir()), [])

    def test_publication_fsync_failure_retains_marker_without_success(self):
        fsync = os.fsync
        def failed(fd):
            if stat.S_ISDIR(os.fstat(fd).st_mode):
                raise OSError('synthetic directory fsync failure')
            fsync(fd)
        with patch.object(producer.os, 'fsync', side_effect=failed), self.assertRaises(OSError):
            write_marker(self.directory, 'arm')
        self.assertTrue(self.marker())
        with self.assertRaises(FileExistsError):
            write_marker(self.directory, 'arm')

    def test_invalid_marker_bytes(self):
        path = self.directory / 'arm.json'
        for data in (b'{"op":"arm","op":"arm","trialId":"trial1","nonce":"' + b'a' * 32 + b'"}',
                     json.dumps({'op': 'arm', 'trialId': 'other', 'nonce': 'a' * 32}).encode(),
                     json.dumps({'op': 'arm', 'trialId': 'trial1', 'nonce': 'b' * 32}).encode(), b'x' * 513):
            path.write_bytes(data); path.chmod(0o600)
            with self.subTest(data=data), self.assertRaises((RuntimeError, ValueError)):
                self.marker()

    def test_symlink_and_fifo_refuse_without_blocking(self):
        path = self.directory / 'arm.json'
        outside = self.directory / 'outside'; outside.write_text('not a marker')
        path.symlink_to(outside)
        with self.assertRaises(OSError):
            self.marker()
        path.unlink(); os.mkfifo(path, 0o600)
        # A blocking-open regression must not hang the whole test process.
        code = '''import importlib.util,os,sys
s=importlib.util.spec_from_file_location('probe',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
f=os.open(sys.argv[2],os.O_RDONLY|os.O_DIRECTORY)
try:m.marker(f,'arm','trial1','a'*32,os.getuid(),os.getgid())
except (RuntimeError,OSError):sys.exit(0)
sys.exit(2)
'''
        result = subprocess.run([sys.executable, '-I', '-c', code, str(SOURCE), str(self.directory)], timeout=3, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_marker_replacement_during_read_is_rejected(self):
        path = write_marker(self.directory, 'arm')
        original = os.read
        def changed(fd, count):
            data = original(fd, count)
            with path.open('ab') as stream:
                stream.write(b' ')
            return data
        with patch.object(raw.os, 'read', side_effect=changed), self.assertRaises(RuntimeError):
            self.marker()

    def test_evidence_caps_reserve_terminal_and_no_overwrite(self):
        writer = raw.Evidence(self.fd, self.uid, self.gid)
        try:
            with self.assertRaises(FileExistsError):
                raw.Evidence(self.fd, self.uid, self.gid)
            with patch.object(raw, 'MAX_RECORDS', 3):
                writer.emit({'type': 'test'})
                writer.emit({'type': 'test'})
                with self.assertRaises(RuntimeError):
                    writer.emit({'type': 'test'})
                writer.emit({'type': 'terminal', 'complete': False}, terminal=True)
        finally:
            writer.close()
        info = (self.directory / 'trial.ndjson').stat()
        self.assertEqual(stat.S_IMODE(info.st_mode), 0o600)
        self.assertEqual(info.st_nlink, 1)
        self.assertEqual(len((self.directory / 'trial.ndjson').read_text().splitlines()), 3)

    def test_evidence_byte_cap_reserves_failure_footer(self):
        writer = raw.Evidence(self.fd, self.uid, self.gid)
        try:
            with patch.object(raw, 'MAX_BYTES', 6000):
                writer.emit({'type': 'payload', 'data': 'x' * 1000})
                with self.assertRaises(RuntimeError):
                    writer.emit({'type': 'payload', 'data': 'x' * 1000})
                writer.emit({'type': 'terminal', 'complete': False}, terminal=True)
        finally:
            writer.close()
        self.assertLessEqual((self.directory / 'trial.ndjson').stat().st_size, 6000)

    def test_owned_pipe_parser_marker_arm_and_record_cap(self):
        read_fd, write_fd = os.pipe()
        os.set_blocking(read_fd, False)
        writer = raw.Evidence(self.fd, self.uid, self.gid)
        gate = raw.TrialGate(0)
        try:
            write_marker(self.directory, 'arm')
            if self.marker():
                gate.arm(1000000000)
            os.write(write_fd, event(1) + event(0, 2000) + event(1, 3000))
            with patch.object(raw.time, 'monotonic_ns', return_value=1004000000), patch.object(raw, 'MAX_RAW_RECORDS', 2), self.assertRaises(RuntimeError):
                raw.drain([(read_fd, None, None, Path('owned-pipe'), None)], gate, writer)
            self.assertEqual(writer.raw_records, 2)
            self.assertEqual(writer.records, 2)
            self.assertEqual(len(os.read(read_fd, 1024)), raw.EVENT.size)
        finally:
            writer.close(); os.close(read_fd); os.close(write_fd)


class RunTests(unittest.TestCase):
    def exercise(self, premature=False, held=False, unknown=False, final_held=False, ready_timeout=False, final_drop=False, final_interrupt=False, close_interrupt=False):
        with tempfile.TemporaryDirectory() as folder:
            staging = Path(folder).resolve(); directory = staging / 'trial'; directory.mkdir(mode=0o700)
            read_fd, write_fd = os.pipe(); os.set_blocking(read_fd, False)
            record = (read_fd, None, Path('synthetic-interface'), Path('owned-pipe'), None)
            failures = []
            def control():
                try:
                    deadline = time.monotonic() + 3
                    phase = 'ready'
                    while time.monotonic() < deadline:
                        path = directory / 'trial.ndjson'
                        data = path.read_bytes() if path.exists() else b''
                        rows = [json.loads(line) for line in data.split(b'\n')[:-1]]
                        if any(row['type'] == 'terminal' for row in rows):
                            return
                        ready = next((row for row in rows if row['type'] == 'ready'), None)
                        if phase == 'ready' and ready:
                            if ready_timeout:
                                phase = 'finish'
                            elif premature:
                                stamp = time.monotonic_ns()
                                os.write(write_fd, event(1, (stamp % 1000000000) // 1000, seconds=stamp // 1000000000))
                                phase = 'finish'
                            else:
                                write_marker(directory, 'arm', nonce=ready['nonce'])
                                phase = 'armed'
                        if phase == 'armed' and any(row['type'] == 'armed' for row in rows):
                            stamp = time.monotonic_ns()
                            os.write(write_fd, b''.join(event(value, (stamp % 1000000000) // 1000, seconds=stamp // 1000000000) for value in [1, 0, 1, 0, 1, 0]))
                            write_marker(directory, 'stop', nonce=ready['nonce'])
                            phase = 'finish'
                        time.sleep(.005)
                    raise AssertionError('Owned trial did not terminate')
                except BaseException as failure:
                    failures.append(failure)
                    raw.RUNNING = False
            snapshot_count = 0
            def ioctl(fd, command, value, *args):
                nonlocal snapshot_count
                if command == raw.ioctl_read(0x20, 8):
                    value[0] = 3
                elif command == raw.ioctl_read(0x21, 96):
                    value[3] = 1 << 6
                elif command == raw.ioctl_read(0x18, 96):
                    snapshot_count += 1
                    if unknown: raise OSError(5, 'synthetic unknown held state')
                    if held or (final_held and snapshot_count == 3): value[3] = 1 << 6
                    if final_drop and snapshot_count == 3: os.write(write_fd, event(0, kind=0, code=3))
                    if final_interrupt and snapshot_count == 3: raw.stop(None, None)
                return 0
            real_close = os.close
            def close(fd):
                if close_interrupt and fd == read_fd: raw.stop(None, None)
                return real_close(fd)
            thread = threading.Thread(target=control)
            patches = [patch.object(raw, 'UID', os.getuid()), patch.object(raw, 'GID', os.getgid()),
                       patch.object(raw, 'READY_SECONDS', .03 if ready_timeout else 120),
                       patch.object(raw, 'STAGING_ROOT', staging), patch.object(raw, 'discover', return_value=(Path('synthetic-usb'), ('instance',))),
                       patch.object(raw, 'snapshot', return_value=('instance',)), patch.object(raw, 'open_inputs', return_value=[record]),
                       patch.object(raw.os, 'close', side_effect=close),
                       patch.object(raw, 'validate_inputs'), patch.object(raw, 'interface_number', return_value=2), patch.object(raw.fcntl, 'ioctl', side_effect=ioctl)]
            try:
                for item in patches: item.start()
                thread.start()
                code = raw.run(directory, 'trial1', 'blue')
                thread.join(timeout=4)
                self.assertFalse(thread.is_alive())
                self.assertEqual(failures, [])
                rows = [json.loads(line) for line in (directory / 'trial.ndjson').read_text().splitlines()]
                if premature or held or unknown or final_held or ready_timeout or final_drop or final_interrupt or close_interrupt:
                    self.assertEqual(code, 1)
                    self.assertFalse(rows[-1]['complete'])
                    if final_held or final_drop or final_interrupt or close_interrupt: self.assertEqual([row['type'] for row in rows].count('key'), 6)
                    else: self.assertFalse(any(row['type'] == 'key' for row in rows))
                    if held or unknown: self.assertFalse(any(row['type'] == 'ready' for row in rows))
                else:
                    self.assertEqual(code, 0)
                    self.assertTrue(rows[-1]['complete'])
                    self.assertEqual([row['type'] for row in rows].count('key'), 6)
                    self.assertEqual(rows[-1]['keySignatures'][0]['presses'], 3)
                self.assertTrue(rows[-1]['inputsClosed'])
                with self.assertRaises(OSError): os.fstat(read_fd)
            finally:
                raw.RUNNING = False
                thread.join(timeout=4)
                for item in reversed(patches): item.stop()
                os.close(write_fd)

    def test_real_run_files_pipes_ready_arm_stop(self): self.exercise()
    def test_premature_input_cannot_arm(self): self.exercise(premature=True)
    def test_held_snapshot_cannot_ready(self): self.exercise(held=True)
    def test_unknown_snapshot_cannot_ready(self): self.exercise(unknown=True)
    def test_final_held_snapshot_overrules_complete_event_pairs(self): self.exercise(final_held=True)
    def test_actual_readiness_deadline_without_arm(self): self.exercise(ready_timeout=True)
    def test_loss_during_final_snapshot_is_drained_and_rejected(self): self.exercise(final_drop=True)
    def test_interrupt_during_final_snapshot_cannot_complete(self): self.exercise(final_interrupt=True)
    def test_interrupt_during_input_close_cannot_complete(self): self.exercise(close_interrupt=True)


if __name__ == '__main__':
    unittest.main()
