#!/usr/bin/env python3
"""Bounded, operator-armed, read-only raw I-PAC key trials. Import opens nothing.

Qualification derives from reviewed observer32fbceb41ed6; this is new source,
not a relabelling of that automatic30-second diagnostic. No process children,
exclusive grabs, HID/LED writes, audio or application/service commands exist.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import stat
import struct
import sys
import time

EVENT = struct.Struct('llHHi')
USB_BUS = Path('/sys/bus/usb/devices')
SYS_DEVICES = Path('/sys/devices')
INPUT_CLASS = Path('/sys/class/input')
DEV_INPUT = Path('/dev/input')
RUNNING = True
READY_SECONDS = 120
CAPTURE_SECONDS = 30
MAX_RECORDS = 4096
MAX_RAW_RECORDS = 32768
MAX_BYTES = 524288
MAX_SIGNATURES = 16
CONTROL_IDS = ('blue', 'yellow', 'red', 'green', 'pedal', 'mushroom')
UID = GID = 1000
STAGING_ROOT = Path('/home/anulman/.local/share/show-tools/staging')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def stop(_signal, _frame):
    global RUNNING
    RUNNING = False


def attribute(path, name):
    with (path / name).open('r', encoding='ascii') as source:
        value = source.read(257)
    require(len(value) <= 256, 'Oversized USB identity attribute')
    return value.strip()


def snapshot(path):
    require(path.resolve(strict=True) == path and SYS_DEVICES in path.parents, 'USB parent is not canonical under sysfs')
    require([attribute(path, key) for key in ('idVendor', 'idProduct', 'serial')] == ['d209', '0410', '4'], 'I-PAC identity changed')
    info = path.stat()
    return info.st_dev, info.st_ino, attribute(path, 'busnum'), attribute(path, 'devnum')


def discover():
    entries = list(USB_BUS.iterdir())
    require(len(entries) <= 256, 'USB enumeration exceeded its bound')
    boards = {entry.resolve(strict=True) for entry in entries if (entry / 'idVendor').is_file() and (entry / 'idProduct').is_file() and attribute(entry, 'idVendor') == 'd209' and attribute(entry, 'idProduct') == '0410'}
    require(len(boards) == 1, 'Need exactly one connected d209:0410 board')
    parent = boards.pop()
    return parent, snapshot(parent)


def node_id(info):
    require(stat.S_ISCHR(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1, 'Unexpected input-node type or owner')
    return info.st_dev, info.st_ino, info.st_rdev


def input_identity(data):
    bus, vendor, product, _version = struct.unpack('HHHH', data)
    require((bus, vendor, product) == (3, 0xd209, 0x0410), 'Opened input is not the expected USB I-PAC')


def candidates(parent):
    entries = list(INPUT_CLASS.iterdir())
    require(len(entries) <= 1024, 'Input enumeration exceeded its bound')
    return [(entry, entry.resolve(strict=True), DEV_INPUT / entry.name) for entry in entries if re.fullmatch(r'event[0-9]+', entry.name) and parent in entry.resolve(strict=True).parents]


def open_inputs(parent, instance):
    opened = []
    try:
        for entry, canonical, path in candidates(parent):
            require(RUNNING and snapshot(parent) == instance, 'Stopped or USB instance changed before input open')
            before = node_id(path.lstat())
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
            try:
                require(node_id(os.fstat(fd)) == before and node_id(path.lstat()) == before and entry.resolve(strict=True) == canonical, 'Input node changed during open')
                identity = bytearray(8)
                fcntl.ioctl(fd, 0x80084502, identity, True)
                input_identity(identity)
                opened.append((fd, entry, canonical, path, before))
            except BaseException:
                os.close(fd)
                raise
        require(opened and snapshot(parent) == instance, 'No matching inputs or USB instance changed')
        return opened
    except BaseException:
        for record in opened:
            os.close(record[0])
        raise


def validate_inputs(records):
    for _fd, entry, canonical, path, identity in records:
        require(entry.resolve(strict=True) == canonical and node_id(path.lstat()) == identity, 'Input node changed during observation')


def decode(data, device):
    require(data, 'Input detached: ' + str(device))
    require(len(data) % EVENT.size == 0, 'Partial input_event record')
    for seconds, micros, kind, code, value in EVENT.iter_unpack(data):
        require(0 <= seconds <= 9223372035 and 0 <= micros < 1000000, 'Invalid monotonic input timestamp')
        require(not (kind == 0 and code == 3), 'SYN_DROPPED; key state is unknown')
        if kind == 1 or (kind == 4 and code == 4):
            require(kind != 1 or value in (0, 1, 2), 'Invalid EV_KEY value')
            yield {'type': 'key' if kind == 1 else 'scan', 'device': str(device),
                   'deviceSeconds': seconds, 'deviceMicroseconds': micros,
                   'eventType': kind, 'code': code, 'value': value}


def ioctl_read(number, size):
    return (2 << 30) | (size << 16) | (ord('E') << 8) | number


def bit_codes(data):
    return [code for code in range(len(data) * 8) if data[code // 8] & (1 << (code % 8))]


def capabilities(fd):
    result = {}
    for name, number, size in [('eventTypes', 0x20, 8), ('keyCodes', 0x21, 96), ('relativeAxes', 0x22, 8)]:
        data = bytearray(size)
        fcntl.ioctl(fd, ioctl_read(number, size), data, True)
        result[name] = bit_codes(data)
    return result


def interface_number(canonical, parent):
    for path in (canonical, *canonical.parents):
        if path == parent:
            break
        try:
            value = attribute(path, 'bInterfaceNumber')
        except FileNotFoundError:
            continue
        require(re.fullmatch(r'[0-9a-fA-F]{1,2}', value), 'Invalid USB interface number')
        return int(value, 16)
    raise RuntimeError('No USB interface identity for input')


def held_snapshot(records, source_caps):
    results = []
    for record, caps in zip(records, source_caps):
        fd, _entry, _canonical, path, _identity = record
        started = time.monotonic_ns()
        bitmap = bytearray(96)
        # EV_KEY absence is an observed capability, never a failed ioctl assumed empty.
        if 1 in caps['eventTypes']:
            fcntl.ioctl(fd, ioctl_read(0x18, len(bitmap)), bitmap, True)
        results.append({'device': str(path), 'heldStateKnown': True,
                        'keyCapable': 1 in caps['eventTypes'], 'held': bit_codes(bitmap),
                        'sampleStartedMonotonicNs': started, 'sampleCompletedMonotonicNs': time.monotonic_ns()})
    return results


def require_released(snapshots):
    require(snapshots and all(row['heldStateKnown'] and not row['held'] for row in snapshots),
            'Initial, arm or final held state is unknown or not released')


def private_regular(info, uid, gid):
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, gid, 0o600),
            'Control/evidence file must be private caller-owned single-link regular mode0600')


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, 'Duplicate control marker key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(RuntimeError('Nonfinite marker')))


def marker(directory, operation, trial, nonce, uid, gid):
    require(operation in ('arm', 'stop'), 'Unknown marker operation')
    try:
        fd = os.open(operation + '.json', os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    except FileNotFoundError:
        return False
    try:
        before = os.fstat(fd)
        private_regular(before, uid, gid)
        require(before.st_size <= 512, 'Oversized control marker')
        data = os.read(fd, 513)
        after = os.fstat(fd)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_uid, value.st_gid,
                                  value.st_mode, value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
        require(identity(before) == identity(after) and len(data) == before.st_size, 'Control marker changed during capture')
        value = strict_json(data)
        require(type(value) is dict and set(value) == {'op', 'trialId', 'nonce'}
                and value == {'op': operation, 'trialId': trial, 'nonce': nonce}, 'Wrong trial, nonce or control marker fields')
        return True
    finally:
        os.close(fd)


class Evidence:
    def __init__(self, directory, uid, gid):
        self.fd = os.open('trial.ndjson', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
        try:
            private_regular(os.fstat(self.fd), uid, gid)
            os.fsync(directory)
        except BaseException:
            os.close(self.fd)
            raise
        self.bytes = self.records = self.raw_records = 0

    def emit(self, value, terminal=False):
        data = (json.dumps(value, separators=(',', ':'), ensure_ascii=True) + '\n').encode()
        require(len(data) <= 4096, 'Oversized evidence record')
        require(self.records < MAX_RECORDS - (0 if terminal else 1)
                and self.bytes + len(data) <= MAX_BYTES - (0 if terminal else 4096), 'Evidence record/byte cap reached')
        require(os.write(self.fd, data) == len(data), 'Short evidence write')
        self.bytes += len(data)
        self.records += 1
        if value['type'] in ('ready', 'armed'):
            print(json.dumps(value, separators=(',', ':')), flush=True)

    def close(self):
        try:
            os.fsync(self.fd)
        finally:
            os.close(self.fd)


class TrialGate:
    def __init__(self, now):
        self.ready_deadline = now + READY_SECONDS * 1000000000
        self.armed_at = self.deadline = None
        self.keys = {}
        self.counts = {}
        self.last_time = {}

    def arm(self, now):
        require(self.armed_at is None and now < self.ready_deadline, 'Readiness expired or trial already armed')
        self.armed_at = now
        self.deadline = now + CAPTURE_SECONDS * 1000000000

    def observe(self, event, now):
        require(self.armed_at is not None, 'Input before ARM')
        require(now < self.deadline, 'Input admission deadline expired')
        stamp = event['deviceSeconds'] * 1000000000 + event['deviceMicroseconds'] * 1000
        require(self.armed_at <= stamp <= now, 'Input predates ARM or is in the future')
        device = event['device']
        require(stamp >= self.last_time.get(device, self.armed_at), 'Per-interface timestamp regressed')
        self.last_time[device] = stamp
        if event['type'] != 'key':
            return
        key = (device, event['code'])
        require(key in self.counts or len(self.counts) < MAX_SIGNATURES, 'Key signature cap reached')
        counts = self.counts.setdefault(key, {'presses': 0, 'releases': 0, 'repeats': 0})
        down = self.keys.get(key, False)
        value = event['value']
        if value == 2:
            require(down, 'Repeat without a captured fresh press')
            counts['repeats'] += 1
        elif value == 1:
            require(not down, 'Duplicate down without release')
            self.keys[key] = True
            counts['presses'] += 1
        else:
            require(down, 'Release without a captured fresh press')
            self.keys[key] = False
            counts['releases'] += 1

    def result(self):
        rows = [{'device': key[0], 'code': key[1], **counts} for key, counts in sorted(self.counts.items())]
        complete = self.armed_at is not None and len(rows) == 1 and not any(self.keys.values())
        complete = complete and rows[0]['presses'] == rows[0]['releases'] == 3
        return {'complete': bool(complete), 'keySignatures': rows,
                'heldFromEvents': [{'device': key[0], 'code': key[1]} for key, down in self.keys.items() if down]}


def drain(records, gate, evidence):
    for record in records:
        fd, _entry, _canonical, path, _identity = record
        while RUNNING:
            try:
                require(evidence.raw_records < MAX_RAW_RECORDS, 'Raw read record cap reached')
                data = os.read(fd, EVENT.size * min(64, MAX_RAW_RECORDS - evidence.raw_records))
            except BlockingIOError:
                break
            require(data and len(data) % EVENT.size == 0, 'Input detached or partial record')
            evidence.raw_records += len(data) // EVENT.size
            for event in decode(data, path):
                now = time.monotonic_ns()
                gate.observe(event, now)
                evidence.emit({**event, 'receivedMonotonicNs': now})


def run(directory, trial, control_id):
    global RUNNING
    RUNNING = True
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', trial), 'Invalid trial identity')
    require(control_id in CONTROL_IDS, 'Choose one explicitly named physical control')
    require(directory.is_absolute() and directory.resolve(strict=True) == directory
            and STAGING_ROOT in directory.parents,
            'Trial directory must be canonical in app-private staging')
    handle = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    evidence = None
    records = []
    selector = selectors.DefaultSelector()
    error = None
    result = {'complete': False, 'keySignatures': [], 'heldFromEvents': []}
    gate = None
    nonce = secrets.token_hex(16)
    final = []
    try:
        info = os.fstat(handle)
        require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (UID, GID, 0o700), 'Trial directory must be private1000:1000/0700')
        for name in ('arm.json', 'stop.json'):
            try:
                os.stat(name, dir_fd=handle, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise RuntimeError('Control marker already exists; no trial replay')
        evidence = Evidence(handle, UID, GID)
        parent, instance = discover()
        records = open_inputs(parent, instance)
        source_caps = []
        for fd, _entry, canonical, path, _identity in records:
            # Per-open event clock only: no device/firmware configuration changes.
            fcntl.ioctl(fd, (1 << 30) | (4 << 16) | (ord('E') << 8) | 0xa0, struct.pack('i', time.CLOCK_MONOTONIC))
            caps = capabilities(fd)
            source_caps.append(caps)
            selector.register(fd, selectors.EVENT_READ)
            evidence.emit({'type': 'source', 'device': str(path), 'canonical': str(canonical),
                           'interfaceNumber': interface_number(canonical, parent), 'eventClock': 'CLOCK_MONOTONIC', **caps})
        initial = held_snapshot(records, source_caps)
        for row in initial:
            evidence.emit({'type': 'snapshot', 'phase': 'initial', **row})
        require_released(initial)
        gate = TrialGate(time.monotonic_ns())
        drain(records, gate, evidence)
        evidence.emit({'type': 'ready', 'trialId': trial, 'schemaVersion': 2, 'controlId': control_id, 'nonce': nonce,
                       'usbParent': str(parent), 'instance': instance, 'readyExpiresMonotonicNs': gate.ready_deadline,
                       'evidence': str(directory / 'trial.ndjson'), 'captureStarted': False})
        while RUNNING:
            now = time.monotonic_ns()
            if gate.armed_at is None:
                require(now < gate.ready_deadline, 'Readiness deadline expired without ARM')
            elif now >= gate.deadline:
                break
            require(snapshot(parent) == instance, 'USB instance changed during trial')
            validate_inputs(records)
            selector.select(.05)
            drain(records, gate, evidence)
            if marker(handle, 'stop', trial, nonce, UID, GID):
                require(gate.armed_at is not None, 'Trial cancelled before ARM')
                break
            if gate.armed_at is None and marker(handle, 'arm', trial, nonce, UID, GID):
                drain(records, gate, evidence)
                armed_snapshot = held_snapshot(records, source_caps)
                require_released(armed_snapshot)
                for row in armed_snapshot:
                    evidence.emit({'type': 'snapshot', 'phase': 'arm', **row})
                gate.arm(time.monotonic_ns())
                evidence.emit({'type': 'armed', 'trialId': trial, 'schemaVersion': 2, 'controlId': control_id, 'nonce': nonce,
                               'armedMonotonicNs': gate.armed_at, 'captureExpiresMonotonicNs': gate.deadline})
        require(RUNNING and gate.armed_at is not None, 'Trial interrupted or never armed')
        require(snapshot(parent) == instance, 'USB instance changed at trial end')
        validate_inputs(records)
        final = held_snapshot(records, source_caps)
        for row in final:
            evidence.emit({'type': 'snapshot', 'phase': 'final', **row})
        require_released(final)
        # A key bitmap cannot prove the event queue was loss-free. Consume the
        # final queue after snapshots; a late drop or key edge still invalidates
        # completion. This barrier is an observation, never a future idle lease.
        drain(records, gate, evidence)
        require(RUNNING, 'Trial interrupted during final observation')
        evidence.emit({'type': 'drain-barrier', 'phase': 'final', 'completedMonotonicNs': time.monotonic_ns()})
        result = gate.result()
        require(result['complete'], 'Need one unambiguous key signature and exactly three fresh press/release pairs')
    except (OSError, RuntimeError, ValueError, KeyboardInterrupt) as failure:
        error = str(failure)[:1000]
        result['complete'] = False
        if gate is not None:
            result = {**gate.result(), 'complete': False}
    finally:
        selector.close()
        inputs_closed = True
        for record in records:
            try:
                os.close(record[0])
            except OSError:
                inputs_closed = False
                error = error or 'Input close outcome unconfirmed'
                result['complete'] = False
        # Inputs are closed before committing evidence. Observed/pending stop
        # signals cancel completion. Signals arriving during this final durable
        # commit are delivered afterward; they cannot start another observation.
        watched = {signal.SIGTERM, signal.SIGHUP, signal.SIGINT}
        previous = signal.pthread_sigmask(signal.SIG_BLOCK, watched)
        try:
            if not RUNNING or signal.sigpending() & watched:
                error = error or 'Interrupted before durable completion'
                result['complete'] = False
            terminal = {'type': 'terminal', 'trialId': trial, 'schemaVersion': 2, 'controlId': control_id, **result,
                        'error': error, 'rawReadRecords': evidence.raw_records if evidence else 0,
                        'inputsClosed': inputs_closed, 'requiresSuccessfulExit': True,
                        'deviceWrites': False, 'processChildren': False}
            try:
                if evidence is not None:
                    try:
                        evidence.emit(terminal, terminal=True)
                    finally:
                        evidence.close()
            finally:
                os.close(handle)
            # No public completion precedes durable evidence and FD cleanup.
            print(json.dumps(terminal, separators=(',', ':')), flush=True)
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)

    return 0 if result['complete'] else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--trial', required=True)
    parser.add_argument('--control-id', choices=CONTROL_IDS, required=True)
    args = parser.parse_args()
    require(sys.platform == 'linux' and EVENT.size == 24 and struct.calcsize('P') == 8, 'Need Linux64-bit input_event layout')
    require((os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (UID, UID, GID, GID), 'Run as anulman UID/GID1000, never root')
    for value in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(value, stop)
    return run(args.directory, args.trial, args.control_id)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as failure:
        print(json.dumps({'type': 'error', 'message': str(failure)[:1000]}), flush=True)
        sys.exit(1)
