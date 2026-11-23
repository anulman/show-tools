#!/usr/bin/env python3
"""Local data-only staging prototype. Admission is external and not implemented here."""
import argparse
import ctypes
from dataclasses import dataclass
import fcntl
import gzip
import grp
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import pwd
import re
import secrets
import stat
import sys
import tarfile
import time
from types import SimpleNamespace

CHUNK = 1024 * 1024
MAX_ARCHIVE = 100 * CHUNK
MAX_EXPANDED = 256 * CHUNK
MAX_MEMBERS = 2048
MAX_READ_BYTES = 8 * MAX_EXPANDED
VALIDATOR_SHA256 = 'f3983e3177d9e09b364658cbfb374382879c6f2c253672886eaa66dbf1e31cf4'
THREE_SONG_VALIDATOR_SHA256 = '8d64fee84136c594ae3fca769cdb87c6cde5efefb64a8c73a782468bde4b1065'
PRE_CATALOG_VALIDATOR_SHA256 = '4fd35fce4131918823b5970952e0112702122151244f72c9b5aa6b01e38c2260'
LEGACY_VALIDATOR_SHA256 = 'eef5759425f47f0128ded96918603ab9b0fd06c9e695b42e7ae26dfcb02a1d7c'
CHECKER_SHA256 = 'ff28dab2fc95eb4b4e7937a547529d4edd110874f87fd5e7de19d47f6d654d7d'
PRODUCTION_APPROVED = False
TARGET_ROOT = Path('/home/anulman/.local/share/show-tools')
ASSIGNED_UID = ASSIGNED_GID = 1000
ASSIGNED_USER = 'anulman'
ASSIGNED_HOME = Path('/home/anulman')
QUALIFIED_SHARE = ASSIGNED_HOME / '.local/share'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def identity(info):
    return info.st_dev, info.st_ino


def metadata(info):
    return identity(info), info.st_mode, info.st_uid, info.st_gid, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def archive_metadata(info):
    return info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns


def no_posix_acl(fd):
    inspect = getattr(os, 'listxattr', None)
    require(callable(inspect), 'FD ACL inspection is unavailable')
    require(not {'system.posix_acl_access', 'system.posix_acl_default', 'com.apple.system.Security'} & set(inspect(fd)),
            'Unexpected directory ACL')


def private_group():
    account, group = pwd.getpwuid(ASSIGNED_UID), grp.getgrgid(ASSIGNED_GID)
    require((account.pw_name, account.pw_uid, account.pw_gid, account.pw_dir)
            == (ASSIGNED_USER, ASSIGNED_UID, ASSIGNED_GID, str(ASSIGNED_HOME)), 'Assigned account identity differs')
    require(group.gr_name == ASSIGNED_USER and group.gr_gid == ASSIGNED_GID
            and set(group.gr_mem) <= {ASSIGNED_USER}, 'Assigned group is not private')
    accounts = pwd.getpwall()
    require(0 < len(accounts) <= 65536 and sum(row.pw_name == ASSIGNED_USER for row in accounts) == 1,
            'Assigned account enumeration differs')
    for row in accounts:
        memberships = os.getgrouplist(row.pw_name, row.pw_gid)
        require(len(memberships) <= 4096, 'Supplementary group enumeration exceeded its bound')
        if row.pw_name == ASSIGNED_USER:
            require((row.pw_uid, row.pw_gid, row.pw_dir) == (ASSIGNED_UID, ASSIGNED_GID, str(ASSIGNED_HOME))
                    and ASSIGNED_GID in memberships, 'Assigned primary group differs')
        else:
            require(row.pw_uid != ASSIGNED_UID and row.pw_gid != ASSIGNED_GID and ASSIGNED_GID not in memberships,
                    'Assigned group has another primary or supplementary member')


def parts(value):
    require(isinstance(value, str) and value and not re.search(r'[\x00-\x1f\x7f\\]', value), 'Invalid relative path')
    result = tuple(value.split('/'))
    require(len(value) <= 4096 and len(result) <= 64 and all(item not in ('', '.', '..') for item in result), 'Noncanonical relative path')
    return result


def private(info, owner, directory=False):
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and (directory or info.st_nlink == 1)
            and (info.st_uid, info.st_gid) == owner
            and stat.S_IMODE(info.st_mode) in ((0o700,) if directory else (0o600, 0o700)),
            'Expected private owned directory or single-link regular file')


@dataclass(frozen=True)
class ReleasePins:
    source: str
    archive_sha256: str
    archive_bytes: int
    manifest_sha256: str

    def validate(self):
        require(re.fullmatch(r'[a-f0-9]{40}', self.source), 'Invalid source revision')
        require(all(re.fullmatch(r'[a-f0-9]{64}', item) for item in (self.archive_sha256, self.manifest_sha256)), 'Invalid digest')
        require(type(self.archive_bytes) is int and 0 < self.archive_bytes < MAX_ARCHIVE, 'Archive bound exceeded')


@dataclass(frozen=True)
class ExpectedAdmission:
    payload: bytes
    running_preflight_sha256: str


@dataclass(frozen=True)
class AdmissionObservation:
    inspect_report: dict
    request_rows: tuple
    observed_monotonic_ns: int


def expected_admission(value, pins):
    require(type(value) is ExpectedAdmission and type(value.payload) is bytes and 0 < len(value.payload) <= 8192,
            'Exact expected admission payload is required')
    require(re.fullmatch(r'[a-f0-9]{64}', value.running_preflight_sha256), 'Invalid expected running evidence digest')
    def pairs(items):
        result = {}
        for key, item in items:
            require(key not in result, 'Duplicate admission payload field')
            result[key] = item
        return result
    payload = json.loads(value.payload, object_pairs_hook=pairs,
                         parse_constant=lambda _value: (_ for _ in ()).throw(RuntimeError('Nonfinite admission payload')))
    require(type(payload) is dict and payload.get('action') == 'stage'
            and payload.get('targetId') == 'proxmox/anulman/show-tools-web'
            and payload.get('sourceRevision') == pins.source, 'Admission target, action or source differs')
    require(isinstance(payload.get('requestId'), str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}', payload['requestId'])
            and isinstance(payload.get('nonce'), str) and re.fullmatch(r'[a-f0-9]{32}', payload['nonce']), 'Invalid admission identity')
    require(isinstance(payload.get('grantSha256'), str) and re.fullmatch(r'[a-f0-9]{64}', payload['grantSha256'])
            and type(payload.get('grantVersion')) is int and payload['grantVersion'] >= 1
            and isinstance(payload.get('planSha256'), str) and re.fullmatch(r'[a-f0-9]{64}', payload['planSha256']), 'Invalid admission policy or plan pins')
    archive = payload.get('archive')
    require(type(archive) is dict and archive == {
        'url': f'http://100.91.87.3:18742/show-tools-session-release-{pins.source[:7]}.tar.gz',
        'bytes': pins.archive_bytes, 'sha256': pins.archive_sha256,
        'root': 'show-tools-session-release-' + pins.source[:7],
        'installRelease': str(TARGET_ROOT / 'releases' / ('session-' + pins.source[:7]))}, 'Admission archive pins differ')
    evidence = payload.get('evidence')
    require(type(evidence) is list and len(evidence) <= 8
            and [item for item in evidence if type(item) is dict and item.get('kind') == 'artifact-manifest']
            == [{'kind': 'artifact-manifest', 'sha256': pins.manifest_sha256}], 'Signed manifest evidence differs')
    require(type(payload.get('issuedAt')) is int and type(payload.get('expiresAt')) is int
            and 0 < payload['expiresAt'] - payload['issuedAt'] <= 900, 'Invalid admission lifetime')
    return payload


def guard_publication(guard, expected, payload, budget):
    """Validate trusted caller observations, not a cryptographic claim attestation."""
    budget.check()
    started = time.monotonic_ns()
    observed = guard(expected)
    finished = time.monotonic_ns()
    budget.check()
    require(type(observed) is AdmissionObservation, 'Guard must return structured inspection and claim observations')
    require(type(observed.observed_monotonic_ns) is int
            and started <= observed.observed_monotonic_ns <= finished
            and finished - observed.observed_monotonic_ns <= 5_000_000_000, 'Guard observation is stale or outside this invocation')
    report, rows = observed.inspect_report, observed.request_rows
    require(type(report) is dict and report.get('kind') == 'authenticated-candidate' and report.get('executable') is False
            and report.get('hostPreconditions') == 'unverified' and report.get('sshSourceProvenance') == 'not-attested'
            and report.get('checkerSha256') == CHECKER_SHA256 and report.get('pins') == payload
            and report.get('payloadSha256') == hashlib.sha256(expected.payload).hexdigest(), 'Fresh inspection pins differ')
    receipt = report.get('receipt')
    require(type(rows) is tuple and 3 <= len(rows) <= 64 and type(receipt) is dict and rows[-1] == receipt,
            'Fresh inspection must be the latest observed request row')
    keys = set('at operation requestId payloadSha256 nonce grantSha256 grantVersion action outcome evidenceSha256'.split())
    match = {'requestId': payload['requestId'], 'payloadSha256': report['payloadSha256'], 'nonce': payload['nonce'],
             'grantSha256': payload['grantSha256'], 'grantVersion': payload['grantVersion'], 'action': 'stage'}
    claims, running = [], []
    for index, row in enumerate(rows):
        require(type(row) is dict and set(row) == keys and type(row['at']) is int
                and all(row.get(key) == item for key, item in match.items()), 'Observed claim or outcome pins differ')
        state = row['operation'], row['outcome']
        if state == ('claim', 'claimed'):
            require(row['evidenceSha256'] is None, 'Claim has unexpected evidence')
            claims.append(index)
        elif state == ('record', 'running'):
            require(row['evidenceSha256'] == expected.running_preflight_sha256, 'Running preflight evidence differs')
            running.append(index)
        else:
            require(state == ('inspect', 'inspected') and row['evidenceSha256'] is None, 'Request has a terminal, denial or unknown state')
    require(len(claims) == 1 and len(running) == 1 and claims[0] < running[0] < len(rows) - 1
            and receipt['operation'] == 'inspect' and receipt['outcome'] == 'inspected', 'Actual claim then running then fresh inspection required')
    now = time.time()
    require(payload['issuedAt'] <= now + 60 and now <= payload['expiresAt']
            and 0 <= now - receipt['at'] <= 5
            and rows[claims[0]]['at'] <= rows[running[0]]['at'] <= receipt['at'], 'Guard inspection or payload lifetime expired')
    return observed


def guard_still_fresh(observed, payload):
    now = time.time()
    require(0 <= time.monotonic_ns() - observed.observed_monotonic_ns <= 5_000_000_000
            and 0 <= now - observed.inspect_report['receipt']['at'] <= 5
            and now <= payload['expiresAt'], 'Guard expired before publication')


class Budget:
    def __init__(self, seconds=180):
        require(type(seconds) in (int, float) and 0 < seconds <= 180, 'Invalid verification deadline')
        self.deadline, self.bytes = time.monotonic() + seconds, 0

    def check(self, count=0):
        self.bytes += count
        require(self.bytes <= MAX_READ_BYTES, 'Aggregate read bound exceeded')
        require(time.monotonic() < self.deadline, 'Verification deadline exceeded')


class RootAnchor:
    def __init__(self, path, owner):
        self.path, self.owner, self.chain = Path(path), owner, []
        self.home_fd = None
        self.share_fd = None
        require(self.path.is_absolute() and self.path.resolve(strict=True) == self.path, 'Need canonical existing root')
        parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
        self.chain.append((parent, None, None, metadata(os.fstat(parent))))
        try:
            for index, name in enumerate(self.path.parts[1:]):
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
                info = os.fstat(child)
                self.chain.append((child, parent, name, metadata(info)))
                current = Path(*self.path.parts[:index + 2])
                if current == ASSIGNED_HOME:
                    self.home_fd = child
                final = index == len(self.path.parts) - 2
                if final:
                    private(info, owner, directory=True)
                else:
                    owned = (info.st_uid, info.st_gid) in ((0, 0), owner)
                    protected = not info.st_mode & 0o022
                    sticky_root = info.st_uid == 0 and info.st_mode & stat.S_ISVTX
                    qualified = current == QUALIFIED_SHARE and (info.st_uid, info.st_gid) == (ASSIGNED_UID, ASSIGNED_GID)
                    if qualified and stat.S_IMODE(info.st_mode) == 0o775:
                        self.share_fd = child
                        self.qualify_share(child)
                        protected = True
                    require(owned and (protected or sticky_root), 'Unprotected root ancestor')
                parent = child
            self.fd = parent
            private(os.fstat(self.fd), owner, directory=True)
            self.check()
        except BaseException:
            self.close()
            raise

    def check(self):
        if self.share_fd is not None:
            self.qualify_share(self.share_fd)
        for fd, parent, name, before in self.chain:
            now = os.fstat(fd)
            # Child creation changes directory times and link counts.
            stable = lambda value: (identity(value), value.st_mode, value.st_uid, value.st_gid)
            require(stable(now) == (before[0], before[1], before[2], before[3]), 'Root ancestor metadata changed')
            if parent is not None:
                require(stable(os.stat(name, dir_fd=parent, follow_symlinks=False)) == stable(now), 'Root ancestor path changed')

    def qualify_share(self, fd):
        require(self.owner == (ASSIGNED_UID, ASSIGNED_GID) and self.home_fd is not None,
                'Shared ancestor is outside the assigned account')
        info = os.fstat(fd)
        require(fd == self.share_fd and stat.S_ISDIR(info.st_mode)
                and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode)) == (ASSIGNED_UID, ASSIGNED_GID, 0o775),
                'Qualified share identity or mode differs')
        private(os.fstat(self.home_fd), self.owner, directory=True)
        no_posix_acl(self.home_fd)
        no_posix_acl(fd)
        private_group()

    def snapshot(self):
        return tuple((before[0], before[1], before[2], before[3]) for _fd, _parent, _name, before in self.chain)

    def close(self):
        for fd, _parent, _name, _before in reversed(self.chain):
            os.close(fd)
        self.chain = []


class VerifiedReader:
    def __init__(self, fd, owner, budget):
        self.fd, self.owner, self.budget = fd, owner, budget
        self.before = os.fstat(fd)
        private(self.before, owner)
        require(self.before.st_size <= MAX_EXPANDED, 'Read file exceeds expanded bound')

    def read(self, count):
        self.budget.check()
        require(type(count) is int and 0 <= count <= CHUNK + 1, 'Unbounded read refused')
        data = os.read(self.fd, count)
        self.budget.check(len(data))
        return data

    def seek(self, offset, whence=0):
        require(whence == 0 and 0 <= offset <= self.before.st_size, 'Unbounded seek refused')
        return os.lseek(self.fd, offset, whence)

    def tell(self):
        return os.lseek(self.fd, 0, os.SEEK_CUR)

    def __enter__(self):
        return self

    def __exit__(self, kind, value, trace):
        try:
            require(metadata(os.fstat(self.fd)) == metadata(self.before), 'File changed during read')
        finally:
            os.close(self.fd)


class CapturedArchiveReader(VerifiedReader):
    def __init__(self, fd, owner, budget, anchor, path):
        super().__init__(fd, owner, budget)
        self.anchor, self.path = anchor, path

    def check_binding(self):
        self.anchor.check()
        require(metadata(os.stat(self.path.name, dir_fd=self.anchor.fd, follow_symlinks=False)) == metadata(self.before)
                and metadata(os.fstat(self.fd)) == metadata(self.before), 'Captured archive pathname or descriptor changed')

    def __exit__(self, kind, value, trace):
        try:
            self.check_binding()
        finally:
            try:
                super().__exit__(kind, value, trace)
            finally:
                self.anchor.close()


class OwnedTree:
    def __init__(self, fd, owner, budget):
        self.fd, self.owner, self.budget = fd, owner, budget
        self.directories = {(): identity(os.fstat(fd))}
        private(os.fstat(fd), owner, directory=True)

    def directory(self, names, create=False):
        self.budget.check()
        current = os.dup(self.fd)
        try:
            for index, name in enumerate(names):
                key = names[:index + 1]
                if create and key not in self.directories:
                    try:
                        os.mkdir(name, 0o700, dir_fd=current)
                        os.fsync(current)
                    except FileExistsError:
                        pass
                child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=current)
                try:
                    info = os.fstat(child)
                    private(info, self.owner, directory=True)
                    require(identity(os.stat(name, dir_fd=current, follow_symlinks=False)) == identity(info), 'Directory changed during open')
                    require(key not in self.directories or self.directories[key] == identity(info), 'Directory identity changed')
                    self.directories[key] = identity(info)
                except BaseException:
                    os.close(child)
                    raise
                os.close(current)
                current = child
            return current
        except BaseException:
            os.close(current)
            raise

    def info(self, names):
        if not names:
            return os.fstat(self.fd)
        fd = self.directory(names[:-1])
        try:
            return os.stat(names[-1], dir_fd=fd, follow_symlinks=False)
        finally:
            os.close(fd)

    def read(self, names):
        directory = self.directory(names[:-1])
        try:
            fd = os.open(names[-1], os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=directory)
            try:
                require(identity(os.fstat(fd)) == identity(os.stat(names[-1], dir_fd=directory, follow_symlinks=False)), 'File changed during open')
                reader = VerifiedReader(fd, self.owner, self.budget)
            except BaseException:
                os.close(fd)
                raise
            return reader
        finally:
            os.close(directory)

    def write(self, names, incoming, count, mode=0o600):
        require(type(count) is int and 0 <= count <= MAX_EXPANDED and mode in (0o600, 0o700), 'Invalid file bound or mode')
        directory = self.directory(names[:-1], create=True)
        fd = None
        try:
            fd = os.open(names[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, mode, dir_fd=directory)
            private(os.fstat(fd), self.owner)
            received = 0
            digest = hashlib.sha256()
            while True:
                data = incoming.read(min(CHUNK, count - received + 1))
                if not data:
                    break
                received += len(data)
                require(received <= count, 'File exceeds declared byte count')
                digest.update(data)
                remaining = memoryview(data)
                while remaining:
                    written = os.write(fd, remaining)
                    require(written > 0, 'Write made no progress')
                    remaining = remaining[written:]
            require(received == count, 'Incomplete file write')
            os.fsync(fd)
            info = os.fstat(fd)
            private(info, self.owner)
            require(info.st_size == count and identity(self.info(names)) == identity(info), 'Created file changed')
            os.fsync(directory)
            return digest.hexdigest()
        finally:
            if fd is not None:
                os.close(fd)
            os.close(directory)

    def walk(self, root=(), counter=None):
        counter = [0] if counter is None else counter
        directory = self.directory(root)
        try:
            names = []
            with os.scandir(directory) as entries:
                for entry in entries:
                    self.budget.check()
                    counter[0] += 1
                    require(counter[0] <= MAX_MEMBERS, 'Directory member bound exceeded')
                    names.append(entry.name)
            names.sort()
            directories, files = [], []
            for name in names:
                parts(name)
                info = os.stat(name, dir_fd=directory, follow_symlinks=False)
                (directories if stat.S_ISDIR(info.st_mode) else files).append(name)
            yield AnchoredPath(self, root), directories, files
            for name in directories:
                yield from self.walk(root + (name,), counter)
        finally:
            os.close(directory)

    def check_directories(self, sync=False):
        for names, expected in list(self.directories.items()):
            fd = self.directory(names)
            try:
                require(identity(os.fstat(fd)) == expected, 'Directory identity changed')
                if sync:
                    os.fsync(fd)
            finally:
                os.close(fd)


class AnchoredPath:
    def __init__(self, tree, names=()):
        self.tree, self.names = tree, names

    def __truediv__(self, name):
        return AnchoredPath(self.tree, self.names + parts(name))

    def __str__(self):
        return '/'.join(self.names)

    @property
    def name(self):
        return self.names[-1] if self.names else ''

    def relative_to(self, other):
        require(self.tree is other.tree and self.names[:len(other.names)] == other.names, 'Path outside anchored tree')
        return PurePosixPath(*self.names[len(other.names):])

    def stat(self):
        return self.tree.info(self.names)

    lstat = stat

    def is_dir(self):
        return stat.S_ISDIR(self.stat().st_mode)

    def is_file(self):
        return stat.S_ISREG(self.stat().st_mode)

    def is_symlink(self):
        return stat.S_ISLNK(self.stat().st_mode)

    def open(self, mode):
        require(mode == 'rb', 'Validator attempted unsupported file access')
        return self.tree.read(self.names)


def load_validator(path, read_only=False):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Need canonical validator path')
    fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size <= CHUNK
                and not before.st_mode & 0o022, 'Invalid validator file')
        data = os.read(fd, CHUNK + 1)
        require(len(data) == before.st_size and metadata(os.fstat(fd)) == metadata(before), 'Validator changed during capture')
    finally:
        os.close(fd)
    digest = hashlib.sha256(data).hexdigest()
    allowed = {VALIDATOR_SHA256, THREE_SONG_VALIDATOR_SHA256, PRE_CATALOG_VALIDATOR_SHA256, LEGACY_VALIDATOR_SHA256} if read_only else {VALIDATOR_SHA256}
    require(digest in allowed, 'Validator digest mismatch')
    namespace = {'__name__': 'captured_stage_validator', '__file__': str(path)}
    exec(compile(data, str(path), 'exec'), namespace)
    def anchored_path(value):
        require(isinstance(value, AnchoredPath), 'Validator requested a nonanchored path')
        return value
    def walk(value, followlinks=False):
        require(isinstance(value, AnchoredPath) and followlinks is False, 'Unsupported validator walk')
        return value.tree.walk(value.names)
    namespace['Path'] = anchored_path
    namespace['os'] = SimpleNamespace(walk=walk, getuid=os.getuid)
    namespace['_capturedSha256'] = digest
    return namespace


def verify_tree(tree, validator, source, manifest_sha256):
    path = AnchoredPath(tree)
    manifest = validator['validate_release'](path, source)
    require(validator['file_hash'](path / 'release.json') == manifest_sha256, 'Reviewed manifest digest mismatch')
    tree.check_directories()
    return manifest


@dataclass(frozen=True)
class ArchiveFile:
    bytes: int
    mode: int
    sha256: str


@dataclass(frozen=True)
class ArchiveImage:
    files: dict
    directories: set
    raw_headers: int
    expanded_bytes: int
    archive_path: Path
    archive_owner: tuple
    archive_metadata: tuple
    parent_snapshot: tuple
    pins: ReleasePins

    def __iter__(self):
        return iter((self.files, self.directories, self.raw_headers, self.expanded_bytes))

    def revalidate_archive(self, path=None):
        selected = self.archive_path if path is None else Path(path)
        require(selected == self.archive_path, 'Archive revalidation path differs')
        with captured_archive(selected, self.pins, self.archive_owner, Budget()) as source:
            require(source.anchor.snapshot() == self.parent_snapshot
                    and archive_metadata(source.before) == self.archive_metadata, 'Captured archive identity or ancestor changed')
        return self.archive_metadata


def captured_archive(path, pins, owner, budget):
    path = Path(path)
    require(path.is_absolute() and path.resolve(strict=True) == path, 'Need canonical archive file')
    anchor = RootAnchor(path.parent, owner)
    fd = None
    try:
        before = os.stat(path.name, dir_fd=anchor.fd, follow_symlinks=False)
        fd = os.open(path.name, os.O_RDONLY | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=anchor.fd)
        reader = CapturedArchiveReader(fd, owner, budget, anchor, path)
        require(metadata(before) == metadata(reader.before), 'Archive leaf changed during open')
        require(reader.before.st_size == pins.archive_bytes, 'Reviewed archive size mismatch')
        reader.check_binding()
        return reader
    except BaseException:
        if fd is not None:
            os.close(fd)
        anchor.close()
        raise


def archive_image(archive_path, pins, owner, budget):
    with captured_archive(archive_path, pins, owner, budget) as source:
        digest = hashlib.sha256()
        while chunk := source.read(CHUNK):
            digest.update(chunk)
        require(digest.hexdigest() == pins.archive_sha256, 'Reviewed archive SHA256 mismatch')
        source.seek(0)
        expanded, raw_headers = 0, 0
        with gzip.GzipFile(fileobj=source, mode='rb') as stream:
            def read(count):
                nonlocal expanded
                data = stream.read(count)
                expanded += len(data)
                budget.check(len(data))
                require(expanded <= MAX_EXPANDED, 'Expanded archive bound exceeded')
                return data
            while True:
                block = read(512)
                if not block or block == bytes(512):
                    while chunk := read(CHUNK):
                        require(not any(chunk), 'Unexpected data after tar end')
                    break
                require(len(block) == 512, 'Truncated tar header')
                member = tarfile.TarInfo.frombuf(block, 'utf-8', 'surrogateescape')
                raw_headers += 1
                require(raw_headers <= MAX_MEMBERS and member.size >= 0
                        and member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE, tarfile.XHDTYPE, tarfile.XGLTYPE),
                        'Unsupported raw tar header')
                require(member.type not in (tarfile.XHDTYPE, tarfile.XGLTYPE) or member.size <= CHUNK, 'Oversized tar metadata')
                if member.isfile() or member.isdir():
                    raw_name = block[:100].split(b'\0', 1)[0].decode('utf-8', 'surrogateescape')
                    parts(raw_name.removesuffix('/') if member.isdir() else raw_name)
                remaining = ((member.size + 511) // 512) * 512
                while remaining:
                    data = read(min(CHUNK, remaining))
                    require(data, 'Truncated tar body')
                    remaining -= len(data)
        source.seek(0)
        entries, files, directories, total = {}, {}, {()}, 0
        root_name = 'show-tools-session-release-' + pins.source[:7]
        with tarfile.open(fileobj=source, mode='r|gz') as archive:
            for member in archive:
                names = parts(member.name)
                total += member.size
                require(len(entries) < MAX_MEMBERS and 0 <= member.size and total <= MAX_EXPANDED,
                        'Archive member or byte bound exceeded')
                require(names[0] == root_name and (member.isfile() or member.isdir()) and not member.mode & 0o7000
                        and member.sparse is None and not any(key.startswith('GNU.sparse') for key in member.pax_headers), 'Unsafe archive member')
                if 'path' in member.pax_headers:
                    parts(member.pax_headers['path'].removesuffix('/') if member.isdir() else member.pax_headers['path'])
                require(names not in entries and not any(names[:index] in entries and not entries[names[:index]] for index in range(1, len(names))),
                        'Duplicate member or file/directory conflict')
                require(member.isdir() or not any(key[:len(names)] == names for key in entries), 'File/directory conflict')
                entries[names] = member.isdir()
                relative = names[1:]
                for index in range(len(relative)):
                    directories.add(relative[:index])
                if member.isdir():
                    directories.add(relative)
                    continue
                require(relative, 'Release root must be a directory')
                incoming = archive.extractfile(member)
                require(incoming is not None, 'Missing archive stream')
                digest, received = hashlib.sha256(), 0
                with incoming:
                    while chunk := incoming.read(CHUNK):
                        received += len(chunk)
                        budget.check(len(chunk))
                        require(received <= member.size, 'Archive file exceeds declared size')
                        digest.update(chunk)
                require(received == member.size, 'Incomplete archive file')
                files[relative] = ArchiveFile(received, 0o700 if member.mode & 0o100 else 0o600, digest.hexdigest())
        require(('release.json',) in files and files[('release.json',)].sha256 == pins.manifest_sha256,
                'Reviewed manifest digest mismatch')
        source.check_binding()
        return ArchiveImage(files, directories, raw_headers, expanded, Path(archive_path), owner,
                            archive_metadata(source.before), source.anchor.snapshot(), pins)


def compare_image(tree, files, directories):
    actual_files, actual_directories = set(), set()
    for path, children, names in tree.walk():
        actual_directories.add(path.names)
        for name in names:
            key = path.names + (name,)
            actual_files.add(key)
            require(key in files, 'Unlisted release file')
            expected = files[key]
            info = tree.info(key)
            private(info, tree.owner)
            require(info.st_size == expected.bytes and stat.S_IMODE(info.st_mode) == expected.mode, 'Archive-derived file size or mode mismatch')
            digest = hashlib.sha256()
            with tree.read(key) as source:
                while chunk := source.read(CHUNK):
                    digest.update(chunk)
            require(digest.hexdigest() == expected.sha256, 'Archive-derived file digest mismatch')
    require(actual_files == files.keys() and actual_directories == directories, 'Archive-derived complete tree differs')
    tree.check_directories()


def verify_local_release(archive_path, pins, validator_path, release_root, seconds=180):
    """Read files only. This function provides no authorization or idle lease."""
    pins.validate()
    owner, budget = (os.getuid(), os.getgid()), Budget(seconds)
    validator = load_validator(validator_path, read_only=True)
    files, directories, raw_headers, expanded = archive_image(archive_path, pins, owner, budget)
    anchor = RootAnchor(release_root, owner)
    try:
        tree = OwnedTree(anchor.fd, owner, budget)
        compare_image(tree, files, directories)
        manifest = verify_tree(tree, validator, pins.source, pins.manifest_sha256)
        anchor.check()
        budget.check()
        return {'schemaVersion': 1, 'status': 'verified-read-only', 'source': pins.source,
                'archiveSha256': pins.archive_sha256, 'manifestSha256': pins.manifest_sha256,
                'validatorSha256': validator['_capturedSha256'], 'files': len(files), 'manifestRecords': len(manifest['files']),
                'rawHeaders': raw_headers, 'expandedBytes': expanded, 'bytesRead': budget.bytes,
                'admissionProvided': False, 'idleLeaseProvided': False}
    finally:
        anchor.close()


def extract(tar_tree, target_tree, name):
    entries, total, files, directories = {}, 0, {}, {()}
    with tar_tree.read(('release.tar',)) as stream, tarfile.open(fileobj=stream, mode='r|') as archive:
        for member in archive:
            total += member.size
            require(len(entries) < MAX_MEMBERS and 0 <= member.size and total <= MAX_EXPANDED,
                    'Archive member or byte bound exceeded')
            require(member.sparse is None and not any(key.startswith('GNU.sparse') for key in member.pax_headers), 'Sparse member refused')
            names = parts(member.name)
            require(names[0] == name and (member.isfile() or member.isdir()) and not member.mode & 0o7000, 'Unsafe archive member')
            if 'path' in member.pax_headers:
                parts(member.pax_headers['path'].removesuffix('/') if member.isdir() else member.pax_headers['path'])
            relative = names[1:]
            require(names not in entries and not any(names[:index] in entries and not entries[names[:index]] for index in range(1, len(names))),
                    'Duplicate member or file/directory conflict')
            require(member.isdir() or not any(key[:len(names)] == names for key in entries), 'File/directory conflict')
            entries[names] = member.isdir()
            for index in range(len(relative)):
                directories.add(relative[:index])
            if member.isdir():
                directories.add(relative)
                fd = target_tree.directory(relative, create=True)
                os.close(fd)
            else:
                require(relative, 'Release root must be a directory')
                incoming = archive.extractfile(member)
                require(incoming is not None, 'Missing archive stream')
                with incoming:
                    mode = 0o700 if member.mode & 0o100 else 0o600
                    digest = target_tree.write(relative, incoming, member.size, mode)
                    files[relative] = ArchiveFile(member.size, mode, digest)
    return files, directories


def rename_noreplace(source_fd, source, target_fd, target):
    require(sys.platform == 'linux', 'Production publication requires Linux renameat2')
    libc = ctypes.CDLL(None, use_errno=True)
    rename = libc.renameat2
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(source_fd, os.fsencode(source), target_fd, os.fsencode(target), 1):
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error), target)


def stage_local_archive(archive_path, pins, validator_path, target_root, *, prepublish_guard, admission):
    pins.validate()
    require(callable(prepublish_guard), 'Required trusted prepublication guard is missing')
    payload = expected_admission(admission, pins)
    owner, budget = (os.getuid(), os.getgid()), Budget()
    validator = load_validator(validator_path)
    anchor = RootAnchor(target_root, owner)
    owned = OwnedTree(anchor.fd, owner, budget)
    descriptors = []
    attempt_name = 'anchored-' + pins.source[:7] + '-' + secrets.token_hex(16)
    try:
        staging = owned.directory(('staging',), create=True)
        descriptors.append(staging)
        releases = owned.directory(('releases',), create=True)
        descriptors.append(releases)
        anchor.check()
        os.mkdir(attempt_name, 0o700, dir_fd=staging)
        os.fsync(staging)
        attempt_fd = os.open(attempt_name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=staging)
        descriptors.append(attempt_fd)
        attempt = OwnedTree(attempt_fd, owner, budget)
        with captured_archive(archive_path, pins, owner, budget) as reader:
            require(attempt.write(('release.tar.gz',), reader, pins.archive_bytes) == pins.archive_sha256, 'Reviewed archive SHA256 mismatch')
        with attempt.read(('release.tar.gz',)) as compressed, gzip.GzipFile(fileobj=compressed, mode='rb') as expanded:
            directory = attempt.directory(())
            try:
                output = os.open('release.tar', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=directory)
                try:
                    total = 0
                    while data := expanded.read(min(CHUNK, MAX_EXPANDED - total + 1)):
                        total += len(data)
                        require(total <= MAX_EXPANDED, 'Expanded archive bound exceeded')
                        remaining = memoryview(data)
                        while remaining:
                            count = os.write(output, remaining)
                            require(count > 0, 'Write made no progress')
                            remaining = remaining[count:]
                    os.fsync(output)
                finally:
                    os.close(output)
                os.fsync(directory)
            finally:
                os.close(directory)
        validator['inspect_headers'](AnchoredPath(attempt, ('release.tar',)))
        os.mkdir('candidate', 0o700, dir_fd=attempt_fd)
        os.fsync(attempt_fd)
        candidate_fd = os.open('candidate', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=attempt_fd)
        descriptors.append(candidate_fd)
        candidate = OwnedTree(candidate_fd, owner, budget)
        files, directories = extract(attempt, candidate, 'show-tools-session-release-' + pins.source[:7])
        candidate.check_directories(sync=True)
        compare_image(candidate, files, directories)
        manifest = verify_tree(candidate, validator, pins.source, pins.manifest_sha256)
        lock = os.open('.stage.lock', os.O_CREAT | os.O_RDWR | os.O_NONBLOCK | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=releases)
        descriptors.append(lock)
        private(os.fstat(lock), owner)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        require(identity(os.stat('.stage.lock', dir_fd=releases, follow_symlinks=False)) == identity(os.fstat(lock)), 'Promotion lock path changed')
        leaf = 'session-' + pins.source[:7]
        anchor.check()
        owned.check_directories()
        require(identity(os.stat(attempt_name, dir_fd=staging, follow_symlinks=False)) == identity(os.fstat(attempt_fd)), 'Attempt parent changed')
        require(identity(os.stat('candidate', dir_fd=attempt_fd, follow_symlinks=False)) == identity(os.fstat(candidate_fd)), 'Candidate path changed')
        observation = guard_publication(prepublish_guard, admission, payload, budget)
        anchor.check()
        owned.check_directories()
        require(identity(os.stat(attempt_name, dir_fd=staging, follow_symlinks=False)) == identity(os.fstat(attempt_fd)), 'Attempt parent changed after guard')
        require(identity(os.stat('candidate', dir_fd=attempt_fd, follow_symlinks=False)) == identity(os.fstat(candidate_fd)), 'Candidate path changed after guard')
        try:
            existing = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=releases)
        except FileNotFoundError:
            guard_still_fresh(observation, payload)
            rename_noreplace(attempt_fd, 'candidate', releases, leaf)
            os.fsync(attempt_fd)
            os.fsync(releases)
            expected_identity = identity(os.fstat(candidate_fd))
            status = 'staged-only'
        else:
            try:
                expected_identity = identity(os.fstat(existing))
            finally:
                os.close(existing)
            status = 'already-staged'
        anchor.check()
        owned.check_directories()
        published = os.open(leaf, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=releases)
        try:
            require(identity(os.fstat(published)) == expected_identity, 'Published root identity differs')
            published_tree = OwnedTree(published, owner, budget)
            compare_image(published_tree, files, directories)
            verified = verify_tree(published_tree, validator, pins.source, pins.manifest_sha256)
            require(verified == manifest, 'Postpublication manifest differs')
            require(identity(os.stat(leaf, dir_fd=releases, follow_symlinks=False)) == identity(os.fstat(published)), 'Published path changed')
        finally:
            os.close(published)
        anchor.check()
        return {'schemaVersion': 1, 'status': status, 'source': pins.source, 'archiveSha256': pins.archive_sha256,
                'archiveBytes': pins.archive_bytes, 'manifestSha256': pins.manifest_sha256,
                'validatorSha256': VALIDATOR_SHA256, 'retainedAttempt': attempt_name,
                'requestId': payload['requestId'], 'payloadSha256': hashlib.sha256(admission.payload).hexdigest(),
                'prepublishInspectionAt': observation.inspect_report['receipt']['at'], 'prepublishGuardObserved': True,
                'bytesRead': budget.bytes,
                'executablesStarted': False, 'admissionProvided': False}
    finally:
        for fd in reversed(descriptors):
            os.close(fd)
        anchor.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--archive-sha256', required=True)
    parser.add_argument('--archive-bytes', type=int, required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--validator', type=Path, required=True)
    parser.add_argument('--verify-existing', action='store_true')
    args = parser.parse_args()
    require(PRODUCTION_APPROVED, 'Prototype only; reviewed validator and admission integration are not activated')
    require(sys.platform == 'linux' and (os.getuid(), os.geteuid(), os.getgid(), os.getegid()) == (1000, 1000, 1000, 1000), 'Need Linux UID/GID1000')
    pins = ReleasePins(args.source, args.archive_sha256, args.archive_bytes, args.manifest_sha256)
    if args.verify_existing:
        print(json.dumps(verify_local_release(args.archive, pins, args.validator, TARGET_ROOT / 'releases' / ('session-' + pins.source[:7]))))
    else:
        raise RuntimeError('Staging requires a reviewed in-process fixed host guard and exact admission context')


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError) as failure:
        print(json.dumps({'status': 'held', 'message': str(failure)[:1000]}))
        sys.exit(1)
