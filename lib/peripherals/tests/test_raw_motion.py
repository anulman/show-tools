"""Owned pipes/files and synthetic ioctl results only. No hardware is accessed."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / 'bench' / 'raw_motion.py'
spec = importlib.util.spec_from_file_location('raw_motion', SOURCE)
motion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(motion)
raw = motion.raw
publisher_spec = importlib.util.spec_from_file_location('publish_marker', SOURCE.with_name('publish_marker.py'))
publisher = importlib.util.module_from_spec(publisher_spec)
publisher_spec.loader.exec_module(publisher)


def event(value=1, code=1, kind=2, stamp=1001000000):
    return raw.EVENT.pack(stamp // 1000000000, (stamp % 1000000000) // 1000, kind, code, value)


def decoded(value=1, code=1, device='owned-pipe', stamp=1001000000):
    return next(motion.decode(event(value, code, stamp=stamp), device))


CAPS = {'eventTypes': [0, 2], 'keyCodes': [], 'relativeAxes': [0, 1], 'interfaceNumber': 1}


class GateTests(unittest.TestCase):
    def gate(self):
        gate = motion.MotionGate(0, 1, {'owned-pipe': CAPS})
        gate.arm(1000000000)
        return gate

    def test_signed_counts_preserve_every_observed_axis(self):
        gate = self.gate()
        for value, code in ((4, 1), (-2, 1), (9, 0), (0, 1)):
            gate.observe(decoded(value, code), 1002000000)
        result = gate.result()
        self.assertTrue(result['complete'])
        self.assertEqual(result['observedAxes'], [
            {'device': 'owned-pipe', 'interfaceNumber': 1, 'eventType': 2, 'code': 0, 'samples': 1,
             'delta': 9, 'positiveCounts': 9, 'negativeCounts': 0},
            {'device': 'owned-pipe', 'interfaceNumber': 1, 'eventType': 2, 'code': 1, 'samples': 2,
             'delta': 2, 'positiveCounts': 4, 'negativeCounts': 2}])

    def test_motion_is_not_calibration_or_direction_inference(self):
        gate = self.gate()
        for value in (2, -2):
            gate.observe(decoded(value), 1002000000)
        row = gate.result()['observedAxes'][0]
        self.assertEqual(row['delta'], 0)
        self.assertTrue(gate.result()['complete'])
        self.assertFalse(any(key in row for key in ('polarity', 'degrees', 'rpm', 'countsPerRevolution', 'operatorDirection')))

    def test_zero_only_is_not_observed_motion(self):
        gate = self.gate()
        gate.observe(decoded(0), 1002000000)
        self.assertFalse(gate.result()['complete'])

    def test_arm_deadline_timestamp_and_source_fences(self):
        before = motion.MotionGate(0, 1, {'owned-pipe': CAPS})
        with self.assertRaises(RuntimeError): before.observe(decoded(), 1002000000)
        with self.assertRaises(RuntimeError): before.arm(before.ready_deadline)
        gate = self.gate()
        for row, now in ((decoded(stamp=999999000), 1002000000), (decoded(stamp=1003000000), 1002000000),
                         (decoded(), gate.deadline), (decoded(device='foreign'), 1002000000), (decoded(code=3), 1002000000)):
            with self.subTest(row=row), self.assertRaises(RuntimeError): gate.observe(row, now)
        gate.observe(decoded(stamp=1001001000), 1002000000)
        with self.assertRaises(RuntimeError): gate.observe(decoded(stamp=1001000000), 1002000000)
        with self.assertRaises(RuntimeError): gate.arm(1003000000)

    def test_caps_bound_samples_and_axis_state(self):
        gate = self.gate()
        with patch.object(raw, 'MAX_SIGNATURES', 1):
            gate.observe(decoded(), 1002000000)
            with self.assertRaises(RuntimeError): gate.observe(decoded(code=0), 1002000000)
        with patch.object(raw, 'MAX_RAW_RECORDS', 1), self.assertRaises(RuntimeError):
            gate.observe(decoded(), 1002000000)

    def test_decoder_rejects_loss_partial_keys_and_bad_timestamps(self):
        for data in (b'', b'x', event(kind=0, code=3), event(kind=1), event(kind=4, code=4), raw.EVENT.pack(-1, 0, 2, 1, 1)):
            with self.subTest(data=data), self.assertRaises(RuntimeError): list(motion.decode(data, 'owned'))
        self.assertEqual(list(motion.decode(event(kind=0, code=0), 'owned')), [])
        self.assertEqual(next(motion.decode(event(-2147483648), 'owned'))['value'], -2147483648)

    def test_capture_seconds_are_explicit_and_bounded(self):
        for value in (None, 0, 31, True, 1.5):
            with self.subTest(value=value), self.assertRaises(RuntimeError): motion.MotionGate(0, value, {})

    def test_reviewed_reader_capture_rejects_hash_links_and_symlinks(self):
        with patch.object(motion, 'RAW_SHA256', '0' * 64), self.assertRaises(RuntimeError):
            motion.load_reader()
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            copy = directory / 'raw_keys.py'
            copy.write_bytes(SOURCE.with_name('raw_keys.py').read_bytes())
            with patch.object(motion, '__file__', str(directory / 'raw_motion.py')):
                self.assertEqual(motion.load_reader().MAX_RAW_RECORDS, 32768)
                alias = directory / 'alias'; os.link(copy, alias)
                with self.assertRaises(RuntimeError): motion.load_reader()
                copy.unlink(); copy.symlink_to(alias)
                with self.assertRaises(RuntimeError): motion.load_reader()


class RunTests(unittest.TestCase):
    def exercise(self, direction='clockwise', variant='success'):
        with tempfile.TemporaryDirectory() as temporary:
            staging = Path(temporary).resolve()
            directory = staging / 'trial'; directory.mkdir(mode=0o700)
            read_fd, write_fd = os.pipe(); os.set_blocking(read_fd, False)
            records = [(read_fd, Path('entry'), Path('canonical'), Path('owned-pipe'), ('identity',))]
            output, failures = io.StringIO(), []
            snapshots = 0
            def held(_records, _caps):
                nonlocal snapshots
                snapshots += 1
                if variant == 'final-drop' and snapshots == 3:
                    os.write(write_fd, event(kind=0, code=3, stamp=time.monotonic_ns()))
                if variant == 'final-interrupt' and snapshots == 3:
                    raw.RUNNING = False
                return [{'device': 'owned-pipe', 'heldStateKnown': variant != 'unknown', 'held': [1] if variant == 'held' or (variant == 'final-held' and snapshots == 3) else []}]
            def writer():
                try:
                    deadline, phase = time.monotonic() + 3, 'ready'
                    while time.monotonic() < deadline:
                        path = directory / 'trial.ndjson'
                        data = path.read_bytes() if path.exists() else b''
                        rows = [json.loads(line) for line in data.split(b'\n')[:-1]]
                        if any(row['type'] == 'terminal' for row in rows): return
                        ready = next((row for row in rows if row['type'] == 'ready'), None)
                        if phase == 'ready' and ready:
                            if variant == 'timeout':
                                phase = 'finish'
                            elif variant == 'premature':
                                os.write(write_fd, event(stamp=time.monotonic_ns()))
                                phase = 'finish'
                            else:
                                publisher.publish_marker(directory, 'arm', 'trial1', ready['nonce'])
                                phase = 'armed'
                        if phase == 'armed' and any(row['type'] == 'armed' for row in rows):
                            time.sleep(.002)
                            stamp = time.monotonic_ns()
                            values = [event(4, stamp=stamp), event(-2, stamp=stamp), event(3, code=0, stamp=stamp)]
                            if variant == 'zero': values = [event(0, stamp=stamp)]
                            if variant == 'key': values = [event(kind=1, stamp=stamp)]
                            if variant == 'detach': os.close(write_fd); return
                            os.write(write_fd, b''.join(values))
                            publisher.publish_marker(directory, 'stop', 'trial1', ready['nonce'])
                            phase = 'finish'
                        time.sleep(.002)
                    raise AssertionError('Owned motion trial did not terminate')
                except BaseException as failure:
                    failures.append(failure); raw.RUNNING = False
            thread = threading.Thread(target=writer)
            with patch.multiple(raw, UID=os.getuid(), GID=os.getgid(), STAGING_ROOT=staging), \
                 patch.object(raw, 'discover', return_value=(Path('synthetic-usb'), ('instance',))), \
                 patch.object(raw, 'snapshot', return_value=('changed',) if variant == 'usb-change' else ('instance',)), \
                 patch.object(raw, 'open_inputs', return_value=records), \
                 patch.object(raw, 'validate_inputs', side_effect=OSError('synthetic endpoint changed') if variant == 'endpoint-change' else None), \
                 patch.object(raw, 'capabilities', return_value={'eventTypes': [0], 'keyCodes': [], 'relativeAxes': []} if variant == 'no-axis' else CAPS), \
                 patch.object(raw, 'interface_number', return_value=1), patch.object(raw, 'held_snapshot', side_effect=held), \
                 patch.object(raw.fcntl, 'ioctl', side_effect=OSError('synthetic clock ioctl failure') if variant == 'clock-error' else None), contextlib.redirect_stdout(output):
                if variant == 'timeout': ready_cap = patch.object(raw, 'READY_SECONDS', .02)
                else: ready_cap = contextlib.nullcontext()
                with ready_cap:
                    thread.start()
                    code = motion.run(directory, 'trial1', direction, 1)
                    thread.join(timeout=3)
            self.assertFalse(thread.is_alive()); self.assertEqual(failures, [])
            try: os.close(write_fd)
            except OSError: pass
            with self.assertRaises(OSError): os.fstat(read_fd)
            rows = [json.loads(line) for line in (directory / 'trial.ndjson').read_text().splitlines()]
            terminal = rows[-1]
            self.assertEqual(terminal['type'], 'terminal'); self.assertTrue(terminal['inputsClosed'])
            self.assertEqual(terminal['schemaVersion'], 1); self.assertEqual(terminal['controlId'], 'knob')
            self.assertEqual(terminal['operatorDirection'], direction)
            self.assertFalse(terminal['deviceWrites']); self.assertFalse(terminal['processChildren'])
            self.assertTrue(terminal['requiresSuccessfulExit'])
            public = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual(public[-1], terminal)
            if variant == 'success':
                self.assertEqual(code, 0); self.assertTrue(terminal['complete'])
                self.assertEqual(len(terminal['observedAxes']), 2)
                self.assertTrue(all(isinstance(row['receivedMonotonicNs'], str) for row in rows if row['type'] == 'motion'))
                self.assertEqual(terminal['observedAxes'][1]['delta'], 2)
            else:
                self.assertEqual(code, 1); self.assertFalse(terminal['complete'])
            return terminal

    def test_real_owned_pipe_marker_evidence_lifecycle_both_direction_labels(self):
        for direction in motion.DIRECTIONS:
            with self.subTest(direction=direction): self.exercise(direction)

    def test_failed_qualification_and_input_never_complete(self):
        for variant in ('held', 'unknown', 'premature', 'zero', 'key', 'detach', 'timeout', 'no-axis', 'clock-error', 'usb-change', 'endpoint-change'):
            with self.subTest(variant=variant): self.exercise(variant=variant)

    def test_final_barriers_reject_late_loss_held_and_interrupt(self):
        for variant in ('final-drop', 'final-held', 'final-interrupt'):
            with self.subTest(variant=variant): self.exercise(variant=variant)

    def test_invalid_request_is_rejected_before_trial_open(self):
        for trial, direction, seconds in (('../bad', 'clockwise', 1), ('ok', 'left', 1), ('ok', 'clockwise', 0)):
            with self.assertRaises(RuntimeError): motion.run(Path('/not-a-trial'), trial, direction, seconds)

    def test_cli_requires_explicit_direction_and_duration(self):
        result = subprocess.run([sys.executable, '-I', str(SOURCE), '--help'], capture_output=True, text=True, timeout=3)
        self.assertEqual(result.returncode, 0)
        self.assertIn('--direction {clockwise,counterclockwise}', result.stdout)
        self.assertIn('--capture-seconds CAPTURE_SECONDS', result.stdout)


if __name__ == '__main__':
    unittest.main()
