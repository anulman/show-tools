#!/usr/bin/env python3
"""Supervise one fixed, read-only raw-key trial. Never opens a device."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import selectors
import signal
import stat
import subprocess
import sys
import threading
import time

OBSERVER_SHA256 = 'cca2662e33faf5db85c740945fd94d6fec2c3ab53cb0c653cb9b9b21da38435d'
PUBLISHER_SHA256 = '81379f2ecbbf24d9abc57127305fcdaa95d1b7ce194376015edcd6647c7d5717'
CONTROL_IDS = ('blue', 'yellow', 'red', 'green', 'pedal', 'mushroom')
STAGING_ROOT = Path('/home/anulman/.local/share/show-tools/staging')
MAX_OUTPUT = 1048576
MAX_LINE = 4096
MAX_EVIDENCE = 524288
WATCHDOG_SECONDS = 165


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def metadata(info):
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid, info.st_mode,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def private_file(info):
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (os.getuid(), os.getgid(), 0o600),
            'Need caller-owned single-link regular mode0600')


def same_directory(path, handle):
    before, current = os.fstat(handle), path.lstat()
    require((before.st_uid, before.st_gid, stat.S_IMODE(before.st_mode)) == (os.getuid(), os.getgid(), 0o700),
            'Directory is no longer private caller-owned mode0700')
    require((before.st_dev, before.st_ino, before.st_mode, before.st_uid, before.st_gid)
            == (current.st_dev, current.st_ino, current.st_mode, current.st_uid, current.st_gid),
            'Trial directory pathname changed')


def capture_source(path, digest):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Source path must be canonical')
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        private_file(before)
        require(before.st_size <= 32768, 'Source size exceeds bound')
        data = os.read(fd, 32769)
        require(len(data) == before.st_size and hashlib.sha256(data).hexdigest() == digest, 'Reviewed source hash mismatch')
        require(metadata(before) == metadata(os.fstat(fd)) == metadata(path.lstat()), 'Source changed during capture')
        os.lseek(fd, 0, os.SEEK_SET)
        return fd, data
    except BaseException:
        os.close(fd)
        raise


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON field')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(RuntimeError('Nonfinite JSON')))


def write_all(fd, data):
    remaining = memoryview(data)
    while remaining:
        count = os.write(fd, remaining)
        require(count > 0, 'Write made no progress')
        remaining = remaining[count:]


def atomic_record(directory, name, value, rename):
    temporary = '.record-' + secrets.token_hex(16)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
    created = os.fstat(fd)
    try:
        private_file(created)
        data = (json.dumps(value, separators=(',', ':'), allow_nan=False) + '\n').encode()
        require(len(data) <= 16384, 'Supervisor record exceeds bound')
        write_all(fd, data)
        os.fsync(fd)
    finally:
        os.close(fd)
    try:
        require((os.stat(temporary, dir_fd=directory, follow_symlinks=False).st_dev,
                 os.stat(temporary, dir_fd=directory, follow_symlinks=False).st_ino) == (created.st_dev, created.st_ino),
                'Temporary record replaced')
        rename(directory, temporary, name)
        os.fsync(directory)
    except BaseException:
        # Publication may already have happened; never remove a destination.
        try:
            current = os.stat(temporary, dir_fd=directory, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            if (current.st_dev, current.st_ino) == (created.st_dev, created.st_ino):
                os.unlink(temporary, dir_fd=directory)
                os.fsync(directory)
        raise
    check = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    try:
        before = os.fstat(check)
        private_file(before)
        require((before.st_dev, before.st_ino) == (created.st_dev, created.st_ino)
                and os.read(check, 16385) == data
                and metadata(before) == metadata(os.fstat(check))
                == metadata(os.stat(name, dir_fd=directory, follow_symlinks=False)), 'Record readback failed')
    finally:
        os.close(check)


def child_identity(child):
    result = {'pid': child.pid, 'session': os.getsid(child.pid), 'processGroup': os.getpgid(child.pid)}
    if sys.platform == 'linux':
        fields = Path('/proc/' + str(child.pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
        result['startTicks'] = int(fields[19])
    else:
        result['startTicks'] = None
    require(result['session'] == result['processGroup'] == child.pid, 'Child session identity differs')
    return result


def evidence_terminal(directory, phases, terminal):
    fd = os.open('trial.ndjson', os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
    try:
        before = os.fstat(fd)
        private_file(before)
        require(0 < before.st_size <= MAX_EVIDENCE, 'Trial evidence size exceeds bound')
        data = bytearray()
        while len(data) <= MAX_EVIDENCE:
            block = os.read(fd, min(65536, MAX_EVIDENCE + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        require(len(data) == before.st_size and data.endswith(b'\n')
                and metadata(before) == metadata(os.fstat(fd))
                == metadata(os.stat('trial.ndjson', dir_fd=directory, follow_symlinks=False)), 'Trial evidence changed or is incomplete')
        lines = data.splitlines()
        require(len(lines) <= 4096 and all(len(line) < MAX_LINE for line in lines), 'Trial evidence record bound')
        rows = [strict_json(line) for line in lines]
        actual = [row for row in rows if row.get('type') in ('ready', 'armed', 'terminal')]
        require(actual == phases + [terminal] and rows[-1] == terminal, 'Durable trial phases differ from child output')
        return hashlib.sha256(data).hexdigest()
    finally:
        os.close(fd)


def supervise(observer, publisher, directory, trial, control_id, *, seconds=WATCHDOG_SECONDS, cancelled=None):
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', trial), 'Invalid trial identity')
    require(control_id in CONTROL_IDS and 0 < seconds <= WATCHDOG_SECONDS, 'Invalid control or watchdog')
    directory = Path(directory)
    require(directory.is_absolute() and directory.resolve(strict=True) == directory, 'Trial path must be canonical')
    root = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    child = None
    source = report = None
    logs = []
    selector = selectors.DefaultSelector()
    phases = []
    terminal = None
    error = None
    exit_code = None
    identity = None
    term_requested = kill_requested = False
    started = time.monotonic()
    try:
        info = os.fstat(root)
        require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (os.getuid(), os.getgid(), 0o700),
                'Trial directory must be caller-owned mode0700')
        same_directory(directory, root)
        with os.scandir(root) as entries:
            require(next(entries, None) is None, 'Trial must be empty; no replay')
        source, _data = capture_source(observer, OBSERVER_SHA256)
        publisher_fd, publisher_data = capture_source(publisher, PUBLISHER_SHA256)
        os.close(publisher_fd)
        namespace = {'__name__': 'captured_marker_publisher'}
        exec(compile(publisher_data, str(publisher), 'exec'), namespace)
        rename = namespace['rename_noreplace']
        os.mkdir('supervision', 0o700, dir_fd=root)
        os.fsync(root)
        report = os.open('supervision', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=root)
        require((os.fstat(report).st_uid, os.fstat(report).st_gid, stat.S_IMODE(os.fstat(report).st_mode))
                == (os.getuid(), os.getgid(), 0o700), 'Supervision directory must be private mode0700')
        def publish(name, value):
            same_directory(directory, root)
            same_directory(directory / 'supervision', report)
            atomic_record(report, name, value, rename)
            same_directory(directory, root)
            same_directory(directory / 'supervision', report)
        for name in ('stdout.log', 'stderr.log'):
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=report)
            private_file(os.fstat(fd))
            logs.append(fd)
        bootstrap = ('import os,sys,hashlib; f=' + str(source) + '; b=b""\n'
                     'while len(b)<=32768:\n c=os.read(f,32769-len(b))\n if not c:break\n b+=c\n'
                     'os.close(f)\nassert hashlib.sha256(b).hexdigest()==' + repr(OBSERVER_SHA256)
                     + '\n__file__=' + repr(str(observer)) + '\nsys.argv[0]=__file__\nexec(compile(b,__file__,"exec"))')
        arguments = ['--directory', str(directory), '--trial', trial, '--control-id', control_id]
        same_directory(directory, root)
        child = subprocess.Popen([sys.executable, '-I', '-B', '-c', bootstrap] + arguments,
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 env={'HOME': '/home/anulman', 'USER': 'anulman', 'LOGNAME': 'anulman', 'PATH': '/usr/bin:/bin', 'LANG': 'C'},
                                 start_new_session=True, pass_fds=(source,))
        os.close(source)
        source = None
        identity = child_identity(child)
        publish('child.json', {**identity, 'observerSha256': OBSERVER_SHA256,
                'bootstrapSha256': hashlib.sha256(bootstrap.encode()).hexdigest(), 'arguments': arguments})
        for index, stream in enumerate((child.stdout, child.stderr)):
            os.set_blocking(stream.fileno(), False)
            selector.register(stream, selectors.EVENT_READ, index)
        output_bytes = 0
        pending = b''
        while selector.get_map():
            require(not (cancelled and cancelled()), 'Supervisor cancelled')
            remaining = seconds - (time.monotonic() - started)
            require(remaining > 0, 'Observer watchdog expired')
            for key, _ in selector.select(min(.05, remaining)):
                data = os.read(key.fileobj.fileno(), 65536)
                if not data:
                    selector.unregister(key.fileobj)
                    continue
                output_bytes += len(data)
                require(output_bytes <= MAX_OUTPUT, 'Observer output cap exceeded')
                write_all(logs[key.data], data)
                if key.data:
                    continue
                pending += data
                require(all(len(line) < MAX_LINE for line in pending.split(b'\n')), 'Observer output line exceeds bound')
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    row = strict_json(line)
                    require(isinstance(row, dict), 'Observer output must be a JSON object')
                    kind = row.get('type')
                    require(kind in ('ready', 'armed', 'terminal'), 'Unexpected observer output')
                    require(row.get('schemaVersion') == 2 and row.get('trialId') == trial and row.get('controlId') == control_id,
                            'Observer receipt identity differs')
                    if kind == 'terminal':
                        require(terminal is None and isinstance(row.get('complete'), bool), 'Duplicate or invalid terminal')
                        require(not row['complete'] or len(phases) == 2, 'Completion before READY and ARMED')
                        terminal = row
                    else:
                        require(terminal is None and kind == ('ready' if not phases else 'armed') and len(phases) < 2,
                                'Observer phase out of order')
                        require(isinstance(row.get('nonce'), str) and re.fullmatch(r'[0-9a-f]{32}', row['nonce']), 'Invalid ready nonce')
                        if phases:
                            require(row['nonce'] == phases[0]['nonce'], 'ARM nonce differs')
                        expiry = row.get('readyExpiresMonotonicNs' if kind == 'ready' else 'captureExpiresMonotonicNs')
                        require(type(expiry) is int and expiry > time.monotonic_ns(), 'Observer phase already expired')
                        phases.append(row)
                        same_directory(directory, root)
                        publish(kind + '.json', {**row, 'supervisedChild': identity})
        require(not pending, 'Partial observer output record')
        while True:
            require(not (cancelled and cancelled()), 'Supervisor cancelled')
            remaining = seconds - (time.monotonic() - started)
            require(remaining > 0, 'Observer watchdog expired')
            try:
                exit_code = child.wait(timeout=min(.05, remaining))
                break
            except subprocess.TimeoutExpired:
                pass
        require(not (cancelled and cancelled()), 'Supervisor cancelled')
        require(terminal is not None, 'Observer exited without terminal')
        same_directory(directory, root)
        digest = evidence_terminal(root, phases, terminal)
        require(exit_code == 0 and terminal.get('complete') is True and terminal.get('inputsClosed') is True
                and terminal.get('deviceWrites') is False and terminal.get('processChildren') is False
                and terminal.get('requiresSuccessfulExit') is True and terminal.get('error') is None,
                'Observer did not complete successfully')
    except Exception as failure:
        error = str(failure)[:1000]
        digest = None
    finally:
        if child is not None and child.returncode is None:
            try:
                term_requested = True
                child.terminate()
                exit_code = child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                kill_requested = True
                try:
                    child.kill()
                    exit_code = child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    error = (error or 'Observer failed') + '; child exit unconfirmed'
                except OSError as failure:
                    error = (error or 'Observer failed') + '; child cleanup unconfirmed: ' + str(failure)[:200]
            except OSError as failure:
                error = (error or 'Observer failed') + '; child cleanup unconfirmed: ' + str(failure)[:200]
        selector.close()
        if child is not None:
            for stream in (child.stdout, child.stderr):
                if stream is not None:
                    stream.close()
        for fd in logs:
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        if source is not None:
            os.close(source)
        try:
            if report is not None:
                result = {'schemaVersion': 1, 'type': 'supervisor-result', 'trialId': trial, 'controlId': control_id,
                          'complete': error is None and exit_code == 0, 'error': error, 'child': identity,
                          'exitCode': exit_code, 'exitConfirmed': child is not None and child.returncode is not None,
                          'termRequested': term_requested, 'killRequested': kill_requested,
                          'terminal': terminal, 'evidenceSha256': digest if error is None else None}
                publish('result.json', result)
        finally:
            if report is not None:
                os.close(report)
            os.close(root)
    require(child is not None, error or 'Observer did not launch')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--observer', type=Path, required=True)
    parser.add_argument('--publisher', type=Path, required=True)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--trial', required=True)
    parser.add_argument('--control-id', choices=CONTROL_IDS, required=True)
    args = parser.parse_args()
    require(sys.platform == 'linux' and (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000),
            'Run as Linux anulman UID/GID1000, never root')
    require(STAGING_ROOT in args.directory.parents and STAGING_ROOT in args.observer.parents and STAGING_ROOT in args.publisher.parents,
            'Bench paths must be in app-private staging')
    cancelled = threading.Event()
    for value in (signal.SIGTERM, signal.SIGHUP, signal.SIGINT):
        signal.signal(value, lambda *_: cancelled.set())
    result = supervise(args.observer, args.publisher, args.directory, args.trial, args.control_id, cancelled=cancelled.is_set)
    print(json.dumps(result, separators=(',', ':')), flush=True)
    return 0 if result['complete'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, RuntimeError, ValueError) as failure:
        print(json.dumps({'schemaVersion': 1, 'type': 'error', 'message': str(failure)[:1000]}), flush=True)
        sys.exit(1)
