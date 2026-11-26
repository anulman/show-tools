#!/usr/bin/env python3
"""Bounded read-only dial observations. Direction labels are operator reports."""
import argparse
import hashlib
import os
from pathlib import Path
import signal
import stat
import sys
from types import ModuleType

RAW_SHA256 = 'cca2662e33faf5db85c740945fd94d6fec2c3ab53cb0c653cb9b9b21da38435d'
DIRECTIONS = ('clockwise', 'counterclockwise')


def load_reader():
    path = Path(__file__).with_name('raw_keys.py')
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise RuntimeError('Need canonical reviewed reader path')
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > 32768:
            raise RuntimeError('Invalid reviewed reader file')
        data = os.read(fd, 32769)
        signature = lambda s: (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_gid, s.st_nlink, s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        if len(data) != before.st_size or hashlib.sha256(data).hexdigest() != RAW_SHA256 or signature(before) != signature(os.fstat(fd)) or signature(before) != signature(path.lstat()):
            raise RuntimeError('Reviewed reader bytes changed')
    finally:
        os.close(fd)
    module = ModuleType('captured_motion_reader')
    module.__file__ = str(path)
    exec(compile(data, str(path), 'exec'), module.__dict__)
    return module


raw = load_reader()


def decode(data, device):
    for event in raw.decode(data, device):
        raw.require(event['type'] not in ('key', 'scan'), 'Unexpected keyboard input during dial observation')
    for seconds, micros, kind, code, value in raw.EVENT.iter_unpack(data):
        if kind == 2:
            yield {'type': 'motion', 'device': str(device), 'deviceSeconds': seconds,
                   'deviceMicroseconds': micros, 'eventType': 2, 'code': code, 'value': value}


class MotionGate:
    def __init__(self, now, seconds, sources, *, diagnostic_only=False):
        raw.require(type(seconds) is int and 1 <= seconds <= raw.CAPTURE_SECONDS, 'Capture seconds must be explicit integer1..30')
        self.ready_deadline = now + raw.READY_SECONDS * 1000000000
        self.seconds, self.sources = seconds, sources
        self.diagnostic_only = diagnostic_only
        self.armed_at = self.deadline = None
        self.axes, self.last_time = {}, {}
        self.motion_records = 0

    def arm(self, now):
        raw.require(self.armed_at is None and now < self.ready_deadline, 'Readiness expired or already armed')
        self.armed_at, self.deadline = now, now + self.seconds * 1000000000

    def observe(self, event, now):
        stamp = event['deviceSeconds'] * 1000000000 + event['deviceMicroseconds'] * 1000
        device = event['device']
        if self.diagnostic_only:
            earliest = self.last_time.get(device, 0)
        else:
            raw.require(self.armed_at is not None and now < self.deadline, 'Motion before ARM or after deadline')
            earliest = self.last_time.get(device, self.armed_at)
        raw.require(earliest <= stamp <= now, 'Motion timestamp outside current capture')
        self.last_time[device] = stamp
        source = self.sources.get(device)
        raw.require(source is not None and 2 in source['eventTypes'] and event['code'] in source['relativeAxes'], 'Motion absent from qualified capabilities')
        raw.require(self.motion_records < raw.MAX_RAW_RECORDS, 'Motion record cap reached')
        self.motion_records += 1
        if self.diagnostic_only and (self.armed_at is None or not self.armed_at <= stamp < self.deadline):
            return False
        if event['value'] == 0:
            return True
        key = device, event['code']
        raw.require(key in self.axes or len(self.axes) < raw.MAX_SIGNATURES, 'Motion axis cap reached')
        row = self.axes.setdefault(key, {'device': device, 'interfaceNumber': source['interfaceNumber'], 'eventType': 2,
                                       'code': event['code'], 'samples': 0, 'delta': 0, 'positiveCounts': 0, 'negativeCounts': 0})
        row['samples'] += 1
        row['delta'] += event['value']
        row['positiveCounts' if event['value'] > 0 else 'negativeCounts'] += abs(event['value'])
        return True

    def result(self):
        return {'complete': self.armed_at is not None and bool(self.axes),
                'observedAxes': [dict(row) for _key, row in sorted(self.axes.items())]}


def drain(records, gate, evidence):
    for fd, _entry, _canonical, path, _identity in records:
        while raw.RUNNING:
            try:
                raw.require(evidence.raw_records < raw.MAX_RAW_RECORDS, 'Raw motion record cap reached')
                data = os.read(fd, raw.EVENT.size * min(64, raw.MAX_RAW_RECORDS - evidence.raw_records))
            except BlockingIOError:
                break
            raw.require(data and len(data) % raw.EVENT.size == 0, 'Input detached or partial record')
            evidence.raw_records += len(data) // raw.EVENT.size
            for event in decode(data, path):
                now = raw.time.monotonic_ns()
                counted = gate.observe(event, now)
                evidence.emit({**event, 'type': 'motion' if counted else 'out-of-window-motion',
                               'receivedMonotonicNs': str(now)})


def run(directory, trial, direction, capture_seconds, *, diagnostic_only=False):
    raw.RUNNING = True
    raw.require(raw.re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', trial), 'Invalid trial identity')
    raw.require(direction in DIRECTIONS, 'Choose an explicit operator direction')
    raw.require(type(capture_seconds) is int and 1 <= capture_seconds <= raw.CAPTURE_SECONDS, 'Capture seconds must be explicit integer1..30')
    raw.require(directory.is_absolute() and directory.resolve(strict=True) == directory and raw.STAGING_ROOT in directory.parents, 'Need canonical trial directory in app-private staging')
    handle = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    evidence, records, gate, error = None, [], None, None
    selector = raw.selectors.DefaultSelector()
    result = {'complete': False, 'observedAxes': []}
    nonce = raw.secrets.token_hex(16)
    context = {'trialId': trial, 'schemaVersion': 1, 'controlId': 'knob', 'operatorDirection': direction}
    try:
        info = os.fstat(handle)
        raw.require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (raw.UID, raw.GID, 0o700), 'Trial must be private1000:1000/0700')
        for name in ('arm.json', 'stop.json'):
            try:
                os.stat(name, dir_fd=handle, follow_symlinks=False)
            except FileNotFoundError:
                continue
            raise RuntimeError('Control marker already exists; no replay')
        evidence = raw.Evidence(handle, raw.UID, raw.GID)
        parent, instance = raw.discover()
        records = raw.open_inputs(parent, instance)
        source_caps, sources = [], {}
        for fd, _entry, canonical, path, _identity in records:
            raw.fcntl.ioctl(fd, (1 << 30) | (4 << 16) | (ord('E') << 8) | 0xa0, raw.struct.pack('i', raw.time.CLOCK_MONOTONIC))
            caps = raw.capabilities(fd)
            source_caps.append(caps)
            sources[str(path)] = {**caps, 'interfaceNumber': raw.interface_number(canonical, parent)}
            selector.register(fd, raw.selectors.EVENT_READ)
            evidence.emit({'type': 'source', 'device': str(path), 'canonical': str(canonical), 'eventClock': 'CLOCK_MONOTONIC', **sources[str(path)]})
        raw.require(any(2 in caps['eventTypes'] and caps['relativeAxes'] for caps in source_caps), 'No qualified relative-axis source')
        def snapshot(phase):
            rows = raw.held_snapshot(records, source_caps)
            for row in rows:
                evidence.emit({'type': 'snapshot', 'phase': phase, **row})
            raw.require_released(rows)
        snapshot('initial')
        gate = MotionGate(raw.time.monotonic_ns(), capture_seconds, sources, diagnostic_only=diagnostic_only)
        drain(records, gate, evidence)
        evidence.emit({'type': 'ready', **context, 'nonce': nonce, 'usbParent': str(parent), 'instance': instance,
                       'readyExpiresMonotonicNs': gate.ready_deadline, 'captureStarted': False, 'evidence': str(directory / 'trial.ndjson')})
        while raw.RUNNING:
            now = raw.time.monotonic_ns()
            if gate.armed_at is None:
                raw.require(now < gate.ready_deadline, 'Readiness deadline expired without ARM')
            elif now >= gate.deadline:
                break
            raw.require(raw.snapshot(parent) == instance, 'USB instance changed during motion trial')
            raw.validate_inputs(records)
            selector.select(.05)
            drain(records, gate, evidence)
            if raw.marker(handle, 'stop', trial, nonce, raw.UID, raw.GID):
                raw.require(gate.armed_at is not None, 'Motion trial cancelled before ARM')
                break
            if gate.armed_at is None and raw.marker(handle, 'arm', trial, nonce, raw.UID, raw.GID):
                drain(records, gate, evidence)
                snapshot('arm')
                gate.arm(raw.time.monotonic_ns())
                evidence.emit({'type': 'armed', **context, 'nonce': nonce, 'armedMonotonicNs': gate.armed_at, 'captureExpiresMonotonicNs': gate.deadline})
        raw.require(raw.RUNNING and gate.armed_at is not None, 'Motion trial interrupted or never armed')
        raw.require(raw.snapshot(parent) == instance, 'USB instance changed at trial end')
        raw.validate_inputs(records)
        snapshot('final')
        drain(records, gate, evidence)
        raw.require(raw.RUNNING, 'Motion trial interrupted during final observation')
        evidence.emit({'type': 'drain-barrier', 'phase': 'final', 'completedMonotonicNs': str(raw.time.monotonic_ns())})
        result = gate.result()
        raw.require(result['complete'], 'Need actual nonzero relative motion')
    except (OSError, RuntimeError, ValueError, KeyboardInterrupt) as failure:
        error = str(failure)[:1000]
        result = {**(gate.result() if gate else result), 'complete': False}
    finally:
        selector.close()
        closed = True
        for record in records:
            try:
                os.close(record[0])
            except OSError:
                closed, error, result['complete'] = False, error or 'Input close outcome unconfirmed', False
        watched = {signal.SIGTERM, signal.SIGHUP, signal.SIGINT}
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, watched)
        try:
            if not raw.RUNNING or signal.sigpending() & watched:
                error, result['complete'] = error or 'Interrupted before durable completion', False
            terminal = {'type': 'terminal', **context, **result, 'error': error, 'rawReadRecords': evidence.raw_records if evidence else 0,
                        'inputsClosed': closed, 'requiresSuccessfulExit': True, 'deviceWrites': False, 'processChildren': False}
            try:
                if evidence is not None:
                    try:
                        evidence.emit(terminal, terminal=True)
                    finally:
                        evidence.close()
            finally:
                os.close(handle)
            print(raw.json.dumps(terminal, separators=(',', ':')), flush=True)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)
    return 0 if result['complete'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--trial', required=True)
    parser.add_argument('--direction', choices=DIRECTIONS, required=True)
    parser.add_argument('--capture-seconds', type=int, required=True)
    parser.add_argument('--diagnostic-only', action='store_true', help='Keep out-of-window motion as separate, uncounted evidence')
    args = parser.parse_args()
    raw.require(sys.platform == 'linux' and raw.EVENT.size == 24 and raw.struct.calcsize('P') == 8, 'Need Linux64-bit input_event layout')
    raw.require((os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000), 'Run as anulman UID/GID1000, never root')
    for number in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(number, raw.stop)
    return run(args.directory, args.trial, args.direction, args.capture_seconds, diagnostic_only=args.diagnostic_only)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as failure:
        print(raw.json.dumps({'type': 'error', 'message': str(failure)[:1000]}), flush=True)
        sys.exit(1)
