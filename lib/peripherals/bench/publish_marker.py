#!/usr/bin/env python3
"""Publish complete, create-only ARM/STOP markers. No device is opened."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys

STAGING_ROOT = Path('/home/anulman/.local/share/show-tools/staging')


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(info):
    return info.st_dev, info.st_ino


def metadata(info):
    return identity(info), info.st_mode, info.st_uid, info.st_gid, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def private_file(info, uid, gid):
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1
            and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, gid, 0o600),
            'Marker must be private caller-owned single-link regular mode0600')


def rename_noreplace(directory, source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    if sys.platform == 'linux':
        rename, flag = libc.renameat2, 1
    elif sys.platform == 'darwin':
        rename, flag = libc.renameatx_np, 4
    else:
        raise RuntimeError('Atomic marker publication requires Linux or macOS')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(directory, os.fsencode(source), directory, os.fsencode(destination), flag):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), destination)


def publish_marker(directory, operation, trial, nonce):
    require(operation in ('arm', 'stop'), 'Choose arm or stop')
    require(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', trial), 'Invalid trial identity')
    require(re.fullmatch(r'[0-9a-f]{32}', nonce), 'Invalid ready nonce')
    directory = Path(directory)
    require(directory.is_absolute() and directory.resolve(strict=True) == directory, 'Need a canonical absolute trial directory')
    uid, gid = os.getuid(), os.getgid()
    handle = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    temporary = '.marker-' + secrets.token_hex(16)
    pending = None
    name = operation + '.json'
    data = json.dumps({'op': operation, 'trialId': trial, 'nonce': nonce}, separators=(',', ':')).encode()
    try:
        info = os.fstat(handle)
        require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (uid, gid, 0o700)
                and identity(directory.lstat()) == identity(info), 'Trial directory must be private caller-owned mode0700')
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=handle)
        try:
            pending = identity(os.fstat(fd))
            private_file(os.fstat(fd), uid, gid)
            remaining = memoryview(data)
            while remaining:
                count = os.write(fd, remaining)
                require(count > 0, 'Marker write made no progress')
                remaining = remaining[count:]
            os.fsync(fd)
            complete = os.fstat(fd)
            private_file(complete, uid, gid)
        finally:
            os.close(fd)
        ready = os.stat(temporary, dir_fd=handle, follow_symlinks=False)
        private_file(ready, uid, gid)
        require(metadata(ready) == metadata(complete), 'Temporary marker changed before publication')
        created = pending
        rename_noreplace(handle, temporary, name)
        pending = None
        os.fsync(handle)
        published = os.open(name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=handle)
        try:
            before = os.fstat(published)
            private_file(before, uid, gid)
            require(identity(before) == created, 'Published marker identity differs')
            require(os.read(published, 513) == data, 'Published marker bytes differ')
            after = os.fstat(published)
            private_file(after, uid, gid)
            require(metadata(before) == metadata(after) and identity(os.stat(name, dir_fd=handle, follow_symlinks=False)) == identity(before),
                    'Published marker changed during readback')
        finally:
            os.close(published)
        require(identity(directory.lstat()) == identity(info), 'Trial directory changed during publication')
        return directory / name
    finally:
        try:
            if pending is not None:
                require(identity(os.stat(temporary, dir_fd=handle, follow_symlinks=False)) == pending,
                        'Temporary marker changed; refusing cleanup')
                os.unlink(temporary, dir_fd=handle)
                os.fsync(handle)
        finally:
            os.close(handle)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--op', choices=('arm', 'stop'), required=True)
    parser.add_argument('--trial', required=True)
    parser.add_argument('--nonce', required=True)
    args = parser.parse_args()
    require(sys.platform == 'linux' and (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000),
            'Run as Linux anulman UID/GID1000, never root')
    require(STAGING_ROOT in args.directory.parents, 'Trial must be in app-private staging')
    path = publish_marker(args.directory, args.op, args.trial, args.nonce)
    print(json.dumps({'schemaVersion': 1, 'type': 'marker-published', 'op': args.op, 'trialId': args.trial, 'path': str(path)}, separators=(',', ':')), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError) as failure:
        print(json.dumps({'schemaVersion': 1, 'type': 'error', 'message': str(failure)[:1000]}), flush=True)
        sys.exit(1)
