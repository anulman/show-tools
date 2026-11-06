#!/usr/bin/python3
"""Operator bootstrap step. Create one private ledger before grant activation."""
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import sys
import time

GRANT = Path('/etc/homelab/delegations/show-tools.json')
PATH = Path('/home/anulman/.local/state/show-tools-mailbox/authorization.jsonl')


def initialize(path, now):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        os.fchmod(fd, 0o600)
        info = os.fstat(fd)
        value = {'kind': 'show-tools-authorization-genesis', 'schemaVersion': 1,
                 'principal': 'show-tools-pi', 'namespace': 'show-tools-deploy-v1',
                 'createdAt': now, 'nonce': os.urandom(16).hex(),
                 'device': info.st_dev, 'inode': info.st_ino}
        data = json.dumps(value, sort_keys=True, separators=(',', ':')).encode() + b'\n'
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            if stream.write(data) != len(data):
                raise ValueError('short genesis write')
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)
    return hashlib.sha256(data).hexdigest()


def require_inactive_grant(expected_sha):
    for parent in reversed(GRANT.parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o755:
            raise ValueError('protected installed grant ancestry required')
    fd = os.open(GRANT, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0 or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o644:
            raise ValueError('protected installed grant required')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(32769)
        if len(raw) > 32768 or hashlib.sha256(raw).hexdigest() != expected_sha:
            raise ValueError('reviewed inactive grant hash mismatch')
        grant = json.loads(raw)
        if grant['active'] is not False or type(grant['version']) is not int or grant['version'] != 1:
            raise ValueError('initial inactive grant required; do not reset authorization history')
    finally:
        os.close(fd)


def main():
    if len(sys.argv) != 3 or sys.argv[1] != '--operator-approved-bootstrap' or sys.flags.isolated != 1 or os.getuid() != 1000 or os.geteuid() != 1000 or os.getgid() != 1000 or socket.gethostname().split('.')[0] != 'proxmox':
        raise ValueError('approved isolated operator bootstrap on assigned host user required')
    require_inactive_grant(sys.argv[2])
    for parent in reversed(PATH.parents):
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in (0, 1000) or info.st_mode & 0o022:
            raise ValueError('unsafe ledger ancestry')
    info = PATH.parent.lstat()
    if info.st_uid != 1000 or info.st_gid != 1000 or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError('existing private mailbox directory required')
    result = initialize(PATH, int(time.time()))
    print(json.dumps({'initialized': str(PATH), 'genesisSha256': result, 'activated': False}))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
