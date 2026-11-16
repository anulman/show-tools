#!/usr/bin/python3
"""Operator-only bootstrap of the separate, fixed peripheral admission policy."""
import hashlib
import json
import os
from pathlib import Path
import pwd
import secrets
import socket
import stat
import sys
import time

ROOT_UID = ROOT_GID = 0
APP_UID = APP_GID = 1000
CHECKER = Path('/usr/local/libexec/show-tools-peripheral-delegation-check.py')
GRANT = Path('/etc/homelab/delegations/show-tools-peripheral.json')
SIGNERS = Path('/etc/homelab/delegations/show-tools-peripheral.allowed_signers')
WEB_SIGNERS = Path('/etc/homelab/delegations/show-tools.allowed_signers')
LEDGER = Path('/home/anulman/.local/state/show-tools-mailbox/authorization-peripheral.jsonl')
STAGING = Path('/home/anulman/.local/share/show-tools/staging')
NAMESPACE = 'show-tools-peripheral-deploy-v1'
FILES = ('check.py', 'grant.inactive.json', 'allowed_signers', 'bootstrap.py')


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True).encode()


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def directory_metadata(info, policy):
    require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022,
            'Unsafe directory ancestry, including group-writable ancestry')
    allowed = {(ROOT_UID, ROOT_GID)} if policy else {(ROOT_UID, ROOT_GID), (APP_UID, APP_GID)}
    require((info.st_uid, info.st_gid) in allowed, 'Unexpected directory owner')


def walk_directory(start, components, policy):
    fd = os.dup(start)
    try:
        directory_metadata(os.fstat(fd), policy)
        for name in components:
            require(name not in ('', '.', '..') and '/' not in name, 'Invalid directory component')
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = child
            directory_metadata(os.fstat(fd), policy)
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_directory(path, policy):
    require(path.is_absolute(), 'Fixed absolute directory required')
    root = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        return walk_directory(root, path.parts[1:], policy)
    finally:
        os.close(root)


def read_at(directory, name, owner, group, mode, limit=65536):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=directory)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (owner, group, mode)
                and info.st_size <= limit, 'Unsafe file metadata: ' + name)
        data = b''
        while len(data) <= limit:
            chunk = os.read(fd, min(8192, limit + 1 - len(data)))
            if not chunk:
                break
            data += chunk
        require(len(data) <= limit, 'Oversized file: ' + name)
        return data, (info.st_dev, info.st_ino)
    finally:
        os.close(fd)


def source_at(directory, name):
    return read_at(directory, name, APP_UID, APP_GID, 0o600)[0]


def active_grant(inactive):
    value = strict_json(inactive)
    require(type(value.get('active')) is bool and value['active'] is False and
            type(value.get('version')) is int and value['version'] == 1 and
            value.get('grantId') == 'show-tools-peripheral-host-user-v1', 'Initial inactive grant required')
    assignment = value.get('target', {}).get('peripheralAssignment', {})
    require(type(assignment.get('mapVersion')) is int and assignment['mapVersion'] == 2
            and type(assignment.get('inputMap')) is dict,
            'Reviewed explicit version-two installation map required')
    input_map = assignment['inputMap']
    require(type(input_map.get('switches')) is list and type(input_map.get('leds')) is list
            and all(type(item) is dict for item in input_map['switches'] + input_map['leds'])
            and {item.get('controlId') for item in input_map['switches']}
                == {'blue', 'yellow', 'red', 'green', 'pedal', 'mushroom'}
            and len(input_map['switches']) == 6 and len(input_map['leds']) == 4
            and {item.get('controlId') for item in input_map['leds']} == {'blue', 'yellow', 'red', 'green'}
            and type(input_map.get('axis')) is dict and input_map.get('confirmWiring') is True,
            'Complete six-switch, spinner and four-arcade-LED assignment required')
    value['active'] = True
    return (json.dumps(value, indent=2) + '\n').encode()


def load_bundle(directory, manifest_sha, active_sha):
    manifest_bytes = source_at(directory, 'manifest.json')
    require(digest(manifest_bytes) == manifest_sha, 'Reviewed manifest hash mismatch')
    manifest = strict_json(manifest_bytes)
    require(type(manifest) is dict and set(manifest) == {'schemaVersion', 'files', 'activeGrantSha256'}
            and type(manifest['schemaVersion']) is int and manifest['schemaVersion'] == 1
            and type(manifest['files']) is dict and set(manifest['files']) == set(FILES), 'Unexpected manifest schema')
    content = {}
    for name in FILES:
        entry = manifest['files'][name]
        require(type(entry) is dict and set(entry) == {'bytes', 'sha256'}, 'Unexpected file manifest')
        content[name] = source_at(directory, name)
        require(type(entry['bytes']) is int and len(content[name]) == entry['bytes'] and
                digest(content[name]) == entry['sha256'], 'Reviewed source mismatch: ' + name)
    grant = strict_json(content['grant.inactive.json'])
    require(grant['checkerSha256'] == digest(content['check.py']) and
            grant['signersSha256'] == digest(content['allowed_signers']), 'Frozen policy pins mismatch')
    require(grant['principal']['signatureNamespace'] == NAMESPACE and
            grant['target']['id'] == 'proxmox/anulman/show-tools-peripheral' and
            grant['constraints']['managerRestartPolicy'] == 'on-abnormal', 'Unexpected fixed peripheral policy')
    active = active_grant(content['grant.inactive.json'])
    require(digest(active) == active_sha == manifest['activeGrantSha256'], 'Reviewed activation hash mismatch')
    return content, active


def write_all(fd, data):
    remaining = memoryview(data)
    while remaining:
        count = os.write(fd, remaining)
        require(count > 0, 'Short write')
        remaining = remaining[count:]
    os.fsync(fd)


def expected_file(directory, name, content):
    try:
        actual, identity = read_at(directory, name, ROOT_UID, ROOT_GID, 0o644)
    except FileNotFoundError:
        return None
    require(actual == content, 'Existing protected file differs: ' + name)
    return identity


def publish_new(directory, name, content):
    if expected_file(directory, name, content) is not None:
        return
    temporary = '.show-tools-peripheral-' + secrets.token_hex(12)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                 0o600, dir_fd=directory)
    try:
        os.fchown(fd, ROOT_UID, ROOT_GID)
        os.fchmod(fd, 0o644)
        write_all(fd, content)
        os.link(temporary, name, src_dir_fd=directory, dst_dir_fd=directory, follow_symlinks=False)
        os.fsync(directory)
    finally:
        os.close(fd)
        os.unlink(temporary, dir_fd=directory)
        os.fsync(directory)
    expected_file(directory, name, content)


def ledger_genesis(fd, now):
    info = os.fstat(fd)
    return {'kind': 'show-tools-authorization-genesis', 'schemaVersion': 1,
            'principal': 'show-tools-pi', 'namespace': NAMESPACE, 'createdAt': now,
            'nonce': secrets.token_hex(16), 'device': info.st_dev, 'inode': info.st_ino}


def checked_genesis(directory):
    data, identity = read_at(directory, LEDGER.name, APP_UID, APP_GID, 0o600, 4096)
    require(data.endswith(b'\n') and len(data.splitlines()) == 1, 'Existing ledger is used, partial, or corrupt; do not reset it')
    value = strict_json(data)
    require(type(value) is dict and set(value) == {'kind', 'schemaVersion', 'principal', 'namespace',
            'createdAt', 'nonce', 'device', 'inode'}, 'Unexpected ledger genesis')
    require(value['kind'] == 'show-tools-authorization-genesis' and type(value['schemaVersion']) is int
            and value['schemaVersion'] == 1 and value['principal'] == 'show-tools-pi' and
            value['namespace'] == NAMESPACE and type(value['createdAt']) is int and
            0 <= value['createdAt'] <= 4102444800 and type(value['nonce']) is str and
            len(value['nonce']) == 32 and all(c in '0123456789abcdef' for c in value['nonce']) and
            type(value['device']) is int and type(value['inode']) is int and
            (value['device'], value['inode']) == identity, 'Invalid or replaced ledger genesis')
    return data, identity


def initialize_ledger(directory):
    try:
        checked_genesis(directory)
        return
    except FileNotFoundError:
        pass
    fd = os.open(LEDGER.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                 0o600, dir_fd=directory)
    try:
        os.fchown(fd, APP_UID, APP_GID)
        os.fchmod(fd, 0o600)
        write_all(fd, canonical(ledger_genesis(fd, int(time.time()))) + b'\n')
    finally:
        os.close(fd)
        os.fsync(directory)
    checked_genesis(directory)


def activate(directory, inactive, active):
    current, identity = read_at(directory, GRANT.name, ROOT_UID, ROOT_GID, 0o644)
    if current == active:
        return
    require(current == inactive, 'Existing grant drift; no policy replacement')
    temporary = '.show-tools-peripheral-activate-' + secrets.token_hex(12)
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC,
                 0o600, dir_fd=directory)
    try:
        os.fchown(fd, ROOT_UID, ROOT_GID)
        os.fchmod(fd, 0o644)
        write_all(fd, active)
        require(read_at(directory, GRANT.name, ROOT_UID, ROOT_GID, 0o644) == (current, identity),
                'Grant changed before activation')
        os.replace(temporary, GRANT.name, src_dir_fd=directory, dst_dir_fd=directory)
        os.fsync(directory)
    finally:
        os.close(fd)
        try:
            os.unlink(temporary, dir_fd=directory)
        except FileNotFoundError:
            pass
    expected_file(directory, GRANT.name, active)


def install(content, active, checker_dir, policy_dir, ledger_dir):
    # These descriptor roots are opened from the fixed production paths in main.
    old_signers, _ = read_at(policy_dir, WEB_SIGNERS.name, ROOT_UID, ROOT_GID, 0o644, 4096)
    require(content['allowed_signers'].replace(b'namespaces="show-tools-peripheral-deploy-v1"',
                                             b'namespaces="show-tools-deploy-v1"') == old_signers,
            'New signer must retain the existing protected principal and key')
    expected_file(checker_dir, CHECKER.name, content['check.py'])
    expected_file(policy_dir, SIGNERS.name, content['allowed_signers'])
    try:
        current, _ = read_at(policy_dir, GRANT.name, ROOT_UID, ROOT_GID, 0o644)
        require(current in (content['grant.inactive.json'], active), 'Existing grant differs')
    except FileNotFoundError:
        current = content['grant.inactive.json']
    try:
        checked_genesis(ledger_dir)
    except FileNotFoundError:
        require(current != active, 'Active policy without its ledger; do not recreate history')
    publish_new(checker_dir, CHECKER.name, content['check.py'])
    publish_new(policy_dir, SIGNERS.name, content['allowed_signers'])
    publish_new(policy_dir, GRANT.name, current)
    initialize_ledger(ledger_dir)
    expected_file(checker_dir, CHECKER.name, content['check.py'])
    expected_file(policy_dir, SIGNERS.name, content['allowed_signers'])
    checked_genesis(ledger_dir)
    require(read_at(policy_dir, WEB_SIGNERS.name, ROOT_UID, ROOT_GID, 0o644, 4096)[0] == old_signers,
            'Existing signer policy changed during bootstrap')
    activate(policy_dir, content['grant.inactive.json'], active)


def main(argv):
    require(sys.flags.isolated == 1 and os.getresuid() == (0, 0, 0) and os.getresgid() == (0, 0, 0)
            and socket.gethostname().split('.')[0] == 'proxmox', 'Isolated operator root invocation on the assigned host required')
    require(len(argv) == 4 and argv[0] == '--operator-approved-bootstrap',
            'usage: --operator-approved-bootstrap BUNDLE MANIFEST_SHA ACTIVE_GRANT_SHA')
    account = pwd.getpwnam('anulman')
    require((account.pw_uid, account.pw_gid, account.pw_dir) == (APP_UID, APP_GID, '/home/anulman'), 'Assigned user changed')
    bundle = Path(argv[1])
    require(bundle.is_absolute() and bundle.resolve(strict=True) == bundle and STAGING in bundle.parents,
            'Canonical packet below the fixed app staging directory required')
    os.umask(0o077)
    source = os.open(bundle, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    descriptors = []
    try:
        info = os.fstat(source)
        require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (APP_UID, APP_GID, 0o700), 'Private app-owned source packet required')
        content, active = load_bundle(source, argv[2], argv[3])
        for path, policy in ((CHECKER.parent, True), (GRANT.parent, True), (LEDGER.parent, False)):
            descriptors.append(open_directory(path, policy))
        info = os.fstat(descriptors[2])
        require((info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (APP_UID, APP_GID, 0o700), 'Existing strict private mailbox directory required')
        print('Installing a separate peripheral admission policy: manager restart on-abnormal; no audio lifecycle, enablement, firmware, permissions or web-policy changes.', flush=True)
        install(content, active, *descriptors)
        print(json.dumps({'activated': True, 'grantSha256': digest(active), 'appActions': 0,
                          'oldWebPolicyChanged': False, 'managerRestartPolicy': 'on-abnormal'}))
    finally:
        os.close(source)
        for fd in descriptors:
            os.close(fd)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except Exception as error:
        print(json.dumps({'error': str(error), 'bootstrapDidNotComplete': True,
                          'existingFilesAndPartialEvidenceRetained': True}), file=sys.stderr)
        sys.exit(1)
