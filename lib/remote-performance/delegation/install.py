#!/usr/bin/python3
"""Operator-only fixed-path installation of an inactive delegation bundle."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import socket
import sys
import tempfile

CREATE_DIRECTORIES = (Path('/etc/homelab'), Path('/etc/homelab/delegations'))
REQUIRED_DIRECTORIES = (Path('/'), Path('/usr'), Path('/usr/local'), Path('/usr/local/libexec'), Path('/etc'))
DESTINATIONS = {
    'check.py': Path('/usr/local/libexec/show-tools-delegation-check.py'),
    'grant.inactive.json': Path('/etc/homelab/delegations/show-tools.json'),
    'allowed_signers': Path('/etc/homelab/delegations/show-tools.allowed_signers'),
}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, 'duplicate JSON key')
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs)


def read_file(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= limit,
                'bounded regular source required')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'source size limit')
        return data
    finally:
        os.close(fd)


def directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and not info.st_mode & 0o022, 'unsafe root directory')


def policy_directory(path):
    directory(path)
    require(stat.S_IMODE(path.lstat().st_mode) == 0o755, 'policy ancestry must be mode 0755')


def destination_state(path, expected):
    try:
        info = path.lstat()
    except FileNotFoundError:
        return False
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o644,
            'unsafe existing destination')
    require(read_file(path, 65536) == expected, 'existing destination drift')
    return True


def load_bundle(bundle, manifest_sha):
    require(len(manifest_sha) == 64 and all(c in '0123456789abcdef' for c in manifest_sha), 'pinned manifest SHA256 required')
    raw = read_file(bundle / 'manifest.json', 4096)
    require(digest(raw) == manifest_sha, 'manifest hash mismatch')
    manifest = strict_json(raw)
    require(type(manifest) is dict and set(manifest) == set(DESTINATIONS), 'unexpected manifest files')
    content = {}
    for name in DESTINATIONS:
        entry = manifest[name]
        require(type(entry) is dict and set(entry) == {'bytes', 'sha256'}, 'invalid manifest entry')
        data = read_file(bundle / name, 65536)
        require(type(entry['bytes']) is int and len(data) == entry['bytes']
                and digest(data) == entry['sha256'], 'source hash mismatch')
        content[name] = data
    grant = strict_json(content['grant.inactive.json'])
    require(grant['active'] is False and grant['schemaVersion'] == 1
            and grant['grantId'] == 'show-tools-host-user-v1' and grant['version'] == 1,
            'initial inactive policy required')
    require(grant['checkerSha256'] == digest(content['check.py'])
            and grant['signersSha256'] == digest(content['allowed_signers']), 'frozen policy pins mismatch')
    return content


def install(content):
    created = CREATE_DIRECTORIES
    for path in REQUIRED_DIRECTORIES:
        policy_directory(path)
    for path in created:
        if path.exists() or path.is_symlink():
            policy_directory(path)
    existing = {name: destination_state(path, content[name]) for name, path in DESTINATIONS.items()}
    for path in created:
        try:
            path.mkdir(mode=0o755)
        except FileExistsError:
            pass
        else:
            fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fchown(fd, 0, 0)
                os.fchmod(fd, 0o755)
                os.fsync(fd)
            finally:
                os.close(fd)
        policy_directory(path)
    for name, path in DESTINATIONS.items():
        if existing[name]:
            continue
        fd, temporary = tempfile.mkstemp(prefix='.show-tools-bootstrap-', dir=path.parent)
        try:
            os.fchmod(fd, 0o644)
            os.fchown(fd, 0, 0)
            with os.fdopen(fd, 'wb', closefd=False) as stream:
                require(stream.write(content[name]) == len(content[name]), 'short installation write')
                stream.flush()
                os.fsync(fd)
            os.link(temporary, path, follow_symlinks=False)
        finally:
            os.close(fd)
            os.unlink(temporary)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    return {str(path): digest(content[name]) for name, path in DESTINATIONS.items()}


def policy_replacement(raw, operation):
    grant = strict_json(raw)
    require(type(grant) is dict and type(grant.get('active')) is bool
            and type(grant.get('version')) is int and grant['version'] >= 1
            and grant.get('grantId') == 'show-tools-host-user-v1', 'unsupported current grant')
    if operation == 'activate':
        require(grant['active'] is False, 'inactive grant required')
        grant['active'] = True
    elif operation == 'revoke':
        grant['active'] = False
        grant['version'] += 1
    else:
        raise ValueError('unsupported policy operation')
    return (json.dumps(grant, indent=2) + '\n').encode()


def change_policy(operation, expected_before, expected_after):
    path = DESTINATIONS['grant.inactive.json']
    for parent in reversed(path.parents):
        policy_directory(parent)
    directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(directory_fd, fcntl.LOCK_EX)
        current = read_file(path, 32768)
        destination_state(path, current)
        if digest(current) == expected_after:
            return {'operation': operation, 'grantSha256': expected_after, 'duplicate': True, 'appActions': 0}
        require(digest(current) == expected_before, 'current grant hash mismatch')
        replacement = policy_replacement(current, operation)
        require(digest(replacement) == expected_after, 'reviewed replacement hash mismatch')
        fd, temporary = tempfile.mkstemp(prefix='.show-tools-bootstrap-', dir=path.parent)
        try:
            os.fchown(fd, 0, 0)
            os.fchmod(fd, 0o644)
            with os.fdopen(fd, 'wb', closefd=False) as stream:
                require(stream.write(replacement) == len(replacement), 'short policy write')
                stream.flush()
                os.fsync(fd)
            os.replace(temporary, path)
            os.fsync(directory_fd)
        finally:
            os.close(fd)
            if os.path.exists(temporary):
                os.unlink(temporary)
        return {'operation': operation, 'grantSha256': expected_after, 'duplicate': False, 'appActions': 0}
    finally:
        os.close(directory_fd)


def main(argv):
    require(os.getuid() == 0 and os.geteuid() == 0, 'operator root terminal required')
    require(sys.flags.isolated == 1, 'python3 -I required')
    require(socket.gethostname().split('.')[0] == 'proxmox', 'assigned Proxmox host required')
    require(len(argv) == 3 and argv[0] in ('install', 'activate', 'revoke'),
            'usage: install.py install BUNDLE MANIFEST_SHA, or activate|revoke BEFORE_SHA AFTER_SHA')
    for parent in reversed(Path(__file__).absolute().parents):
        directory(parent)
    info = Path(__file__).lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and info.st_nlink == 1 and not info.st_mode & 0o022, 'root-owned frozen installer required')
    if argv[0] == 'install':
        result = {'installedInactive': install(load_bundle(Path(argv[1]), argv[2])),
                  'activated': False, 'appActions': 0}
    else:
        result = change_policy(argv[0], argv[1], argv[2])
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as exc:
        print(json.dumps({'error': str(exc), 'activated': False}))
        sys.exit(1)
