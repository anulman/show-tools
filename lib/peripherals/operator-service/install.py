"""Operator-run installer for one fixed user service. No root/device/audio actions."""
import argparse
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import selectors
import signal
import time
import socket
import shlex
import shutil
import stat
import subprocess
import sys

UID = GID = 1000
HOME = '/home/anulman'
RELEASE_ROOT = HOME + '/.local/share/show-tools/releases'
PROFILE = HOME + '/.config/show-tools/peripheral.json'
UNIT_NAME = 'show-tools-peripheral.service'
UNIT = HOME + '/.config/systemd/user/' + UNIT_NAME
WEB_PROFILE = HOME + '/.config/show-tools/session.json'
TOKEN = HOME + '/.config/show-tools/credentials/token'
WANTS = HOME + '/.config/systemd/user/default.target.wants'
RELEASE_FILES = {'release.json', 'runtime/node', 'bin/show-tools-peripheral',
                 'gateway/peripheral-cli.mjs', 'native/peripheral/peripheral-host',
                 'bin/show-tools-session', 'gateway/session-cli.mjs'}
ENV = {'HOME': HOME, 'USER': 'anulman', 'LOGNAME': 'anulman', 'PATH': '/usr/bin:/bin',
       'LANG': 'C', 'XDG_RUNTIME_DIR': '/run/user/1000',
       'DBUS_SESSION_BUS_ADDRESS': 'unix:path=/run/user/1000/bus'}



def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def strict_json(data):
    def pairs(values):
        result = {}
        for key, value in values:
            require(key not in result, 'Duplicate JSON field')
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def private_group():
    account, group = pwd.getpwuid(UID), grp.getgrgid(GID)
    require(account.pw_name == 'anulman' and account.pw_gid == GID and account.pw_dir == HOME,
            'Account identity differs from reviewed anulman UID/GID/home')
    require(group.gr_name == 'anulman' and set(group.gr_mem) <= {'anulman'}
            and all(row.pw_name == 'anulman' for row in pwd.getpwall() if row.pw_gid == GID),
            'Group 1000 is not the reviewed private group')


def directory(path):
    require(path == HOME or path.startswith(HOME + '/'), 'Directory outside fixed application home')
    current = ''
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_CLOEXEC)
    try:
        root = os.fstat(fd)
        require(root.st_uid == root.st_gid == 0 and not root.st_mode & 0o022, 'Unexpected root directory ownership/mode')
        for part in Path(path).parts[1:]:
            require(part not in ('', '.', '..'), 'Noncanonical directory')
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=fd)
            os.close(fd)
            fd = child
            current += '/' + part
            info = os.fstat(fd)
            expected = UID if current == HOME or current.startswith(HOME + '/') else 0
            require(info.st_uid == expected and info.st_gid == (GID if expected else 0), 'Unexpected directory owner/group: ' + current)
            require(not info.st_mode & 0o002, 'Other-writable directory: ' + current)
            require(not info.st_mode & 0o020 or expected == UID, 'Shared group-writable ancestor: ' + current)
            require(not {'system.posix_acl_access', 'system.posix_acl_default'} & set(os.listxattr(fd)), 'Extended ACL requires separate review: ' + current)
        return fd
    except BaseException:
        os.close(fd)
        raise


def file_bytes(path, private=False, maximum=256 * 1024 * 1024):
    parent = directory(str(Path(path).parent))
    try:
        fd = os.open(Path(path).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
        try:
            info = os.fstat(fd)
            require(stat.S_ISREG(info.st_mode) and info.st_uid == UID and info.st_gid == GID and info.st_nlink == 1,
                    'Not a reviewed caller-owned single-link regular file: ' + str(path))
            require(not info.st_mode & 0o022 and (not private or stat.S_IMODE(info.st_mode) == 0o600), 'Unsafe file mode: ' + str(path))
            require(info.st_size <= maximum, 'Oversized file: ' + str(path))
            with os.fdopen(fd, 'rb', closefd=False) as stream:
                data = stream.read(maximum + 1)
            require(len(data) <= maximum, 'File grew beyond bound: ' + str(path))
            after = os.fstat(fd)
            signature = lambda value: (value.st_dev, value.st_ino, value.st_mode, value.st_uid, value.st_gid, value.st_nlink, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
            require(signature(info) == signature(after) and after.st_nlink == 1 and len(data) == after.st_size, 'File metadata changed during read: ' + str(path))
            return data, after
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def install_file(path, data):
    parent = directory(str(Path(path).parent))
    temporary = None
    identity = None
    published = False
    try:
        try:
            actual, _ = file_bytes(path, private=True)
            require(actual == data, 'Refusing to overwrite different installed file: ' + path)
            os.fsync(parent)
            require(file_bytes(path, private=True)[0] == data, 'Existing file changed on durable readback: ' + path)
            return False
        except FileNotFoundError:
            pass
        name = '.show-tools-peripheral-' + os.urandom(12).hex()
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW | os.O_CLOEXEC, 0o600, dir_fd=parent)
        temporary = name
        info = os.fstat(fd)
        identity = (info.st_dev, info.st_ino)
        try:
            with os.fdopen(fd, 'wb') as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            try:
                os.link(temporary, Path(path).name, src_dir_fd=parent, dst_dir_fd=parent, follow_symlinks=False)
                published = True
            except FileExistsError:
                require(file_bytes(path, private=True)[0] == data, 'Concurrent different file; nothing overwritten: ' + path)
            os.fsync(parent)
        finally:
            # Remove only our temporary name; never roll back an already-published target.
            current = os.stat(temporary, dir_fd=parent, follow_symlinks=False)
            require((current.st_dev, current.st_ino) == identity, 'Temporary publication evidence changed')
            os.unlink(temporary, dir_fd=parent)
            temporary = None
            os.fsync(parent)
        actual, final = file_bytes(path, private=True)
        require(actual == data and (not published or (final.st_dev, final.st_ino) == identity),
                'Published destination differs on independent readback: ' + path)
        return published
    finally:
        # If publication/cleanup failed, retain the destination and any remaining evidence.
        os.close(parent)


def cleanup_client(process, timeout):
    # Keep the leader unreaped until both signals are sent, so its PID cannot be reused.
    if process.returncode is None:
        signal_error = False
        for action in (signal.SIGTERM, signal.SIGKILL):
            try:
                os.killpg(process.pid, action)
            except ProcessLookupError:
                pass
            except OSError:
                signal_error = True
            if action == signal.SIGTERM:
                time.sleep(min(0.1, timeout / 2))
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise ValueError('Owned command client cleanup unconfirmed; daemon effects uncertain; inspect status before retry') from None
        require(not signal_error, 'Owned command client group cleanup unconfirmed; daemon effects uncertain; inspect status before retry')


def command(args, allowed=(0,), output_limit=65536, timeout=10, cleanup_timeout=1):
    process = subprocess.Popen(args, env=ENV, stdin=subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    buffers = {'stdout': bytearray(), 'stderr': bytearray()}
    deadline = time.monotonic() + timeout
    try:
        with selectors.DefaultSelector() as observer:
            observer.register(process.stdout, selectors.EVENT_READ, 'stdout')
            observer.register(process.stderr, selectors.EVENT_READ, 'stderr')
            while observer.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError('Command client deadline expired; daemon effects uncertain; inspect status before retry')
                events = observer.select(remaining)
                if not events:
                    raise ValueError('Command client deadline expired; daemon effects uncertain; inspect status before retry')
                for key, _ in events:
                    target = buffers[key.data]
                    chunk = os.read(key.fd, min(4096, output_limit - len(target) + 1))
                    if not chunk:
                        observer.unregister(key.fileobj)
                    else:
                        require(len(target) + len(chunk) <= output_limit,
                                'Command client output limit exceeded; daemon effects uncertain; inspect status before retry')
                        target.extend(chunk)
        remaining = deadline - time.monotonic()
        require(remaining > 0, 'Command client deadline expired; daemon effects uncertain; inspect status before retry')
        try:
            code = process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise ValueError('Command client deadline expired; daemon effects uncertain; inspect status before retry') from None
        require(code in allowed, 'Command client failed; daemon effects uncertain; inspect the named user service before retry')
        try:
            return bytes(buffers['stdout']).decode('utf8').strip()
        except UnicodeError:
            raise ValueError('Command client output invalid; daemon effects uncertain; inspect status before retry') from None
    finally:
        try:
            cleanup_client(process, cleanup_timeout)
        finally:
            process.stdout.close()
            process.stderr.close()


def protected_os_directory(path, checked=None):
    require(type(path) is str and path.startswith('/') and os.path.normpath(path) == path
            and not re.search(r'[\x00-\x1f\x7f]', path), 'PATH needs canonical absolute directories')
    checked = set() if checked is None else checked
    if path in checked:
        return os.path.realpath(path, strict=True)
    require(len(checked) < 128, 'PATH directory resolution exceeds bound')
    current = Path('/')
    for part in ('', *Path(path).parts[1:]):
        if part:
            current /= part
        info = current.lstat()
        require(info.st_uid == 0, 'PATH directory ancestry must be root-owned')
        if stat.S_ISLNK(info.st_mode):
            protected_os_directory(os.path.realpath(current, strict=True), checked)
        else:
            require(stat.S_ISDIR(info.st_mode) and not info.st_mode & 0o022,
                    'PATH directory ancestry is writable or not a directory')
    checked.add(path)
    return os.path.realpath(path, strict=True)


def validate_runtime_environment(text):
    environment = {}
    for line in text.splitlines():
        name, separator, value = line.partition('=')
        require(separator and re.fullmatch('[A-Za-z_][A-Za-z0-9_%]*', name) and name not in environment,
                'Cannot parse unique user-manager environment names')
        environment[name] = value
    forbidden = sorted(name for name in environment if
                       (name.startswith('NODE_') and name != 'NODE_ENV')
                       or name.startswith(('LD_', 'DYLD_', 'BASH_FUNC_'))
                       or name in {'OPENSSL_CONF', 'OPENSSL_MODULES', 'ENV', 'BASH_ENV'})
    require(not forbidden, 'Unreviewed runtime environment names: ' + ','.join(forbidden))
    require('PATH' in environment, 'PATH must be explicitly reported by the user manager')
    try:
        parsed = shlex.split(environment['PATH'])
    except ValueError:
        raise ValueError('Cannot parse user-manager PATH') from None
    require(len(parsed) == 1 and len(parsed[0]) <= 8192, 'PATH must be a single explicit bounded value')
    paths = parsed[0].split(':')
    require(len(paths) <= 64, 'PATH directory count exceeds bound')
    try:
        for path in paths:
            protected_os_directory(path)
        selected = shutil.which('dirname', path=parsed[0])
        require(selected is not None, 'PATH does not resolve dirname')
        info = os.lstat(selected)
        require(info.st_uid == 0, 'Resolved dirname must be root-owned')
        canonical = os.path.realpath(selected, strict=True)
        protected_os_directory(str(Path(canonical).parent))
        info = os.stat(canonical, follow_symlinks=False)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022
                and os.access(canonical, os.X_OK), 'Resolved dirname is not a protected executable')
    except OSError:
        raise ValueError('PATH/dirname resolution requires review; environment values withheld') from None
    return canonical


def service_state():
    text = command(['/usr/bin/systemctl', '--user', 'show', UNIT_NAME,
                    '--property=LoadState,ActiveState,MainPID,FragmentPath,DropInPaths,TasksCurrent,NeedDaemonReload'], allowed=(0, 1))
    result = dict(line.split('=', 1) for line in text.splitlines() if '=' in line)
    require(result.get('LoadState') in ('loaded', 'not-found'), 'Unknown user unit load state')
    require(not result.get('DropInPaths') and result.get('FragmentPath', '') in ('', UNIT), 'Foreign peripheral unit or drop-ins')
    return result


def enable_link():
    fd = directory(WANTS)
    try:
        try:
            info = os.stat(UNIT_NAME, dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            return False
        require(stat.S_ISLNK(info.st_mode) and info.st_uid == UID and info.st_gid == GID, 'Foreign enablement link')
        require(os.readlink(UNIT_NAME, dir_fd=fd) in (UNIT, '../' + UNIT_NAME), 'Foreign enablement target')
        return True
    finally:
        os.close(fd)


def validate_profile(profile, release):
    expected = {'version': 1, 'origin': 'https://proxmox.tail54fc55.ts.net:8443',
                'connectAddress': '100.93.139.99', 'tokenFile': TOKEN,
                'helperExecutable': release + '/native/peripheral/peripheral-host',
                'sdkChannel': 0, 'bindingRevision': 1, 'buttonKey': 'escape'}
    require(type(profile) is dict and set(profile) == set(expected) | {'jiggle'}, 'Unexpected peripheral profile fields')
    require(all(type(profile[key]) is type(value) and profile[key] == value for key, value in expected.items()), 'Peripheral target/binding differs from review')
    jiggle = profile['jiggle']
    if jiggle is None:
        return
    require(type(jiggle) is dict and set(jiggle) == {'minimumTravel', 'minimumReversal'}, 'Explicit approved jiggle contract required')
    require(all(type(value) is int for value in jiggle.values()) and 1 <= jiggle['minimumReversal'] <= jiggle['minimumTravel'] <= 32767, 'Invalid jiggle thresholds')


def validate_unit(data, release):
    expected = ('[Unit]\nDescription=Show Tools peripheral controller\nStartLimitIntervalSec=0\n\n[Service]\nType=exec\n'
                'ExecStart="' + release + '/bin/show-tools-peripheral" serve --config "' + PROFILE + '"\n'
                'Restart=on-abnormal\nRestartSec=3s\nKillMode=control-group\nTimeoutStopSec=15s\nSendSIGKILL=yes\nUMask=0077\n\n'
                '[Install]\nWantedBy=default.target\n')
    require(data == expected.encode(), 'Unit differs from reviewed renderer')


def apply(packet, manifest_sha256):
    require(sys.platform == 'linux' and os.getuid() == os.geteuid() == UID and os.getgid() == os.getegid() == GID,
            'Run as anulman UID/GID 1000; this installer never runs as root')
    require(socket.gethostname().split('.')[0] == 'proxmox', 'Wrong application host')
    private_group()
    os.umask(0o077)
    manifest_data, _ = file_bytes(str(packet / 'manifest.json'), private=True, maximum=16384)
    require(digest(manifest_data) == manifest_sha256, 'Manifest differs from operator-reviewed hash')
    manifest = strict_json(manifest_data)
    require(type(manifest) is dict and set(manifest) == {'schemaVersion', 'sourceRevision', 'webSourceRevision', 'webProfileSha256', 'files', 'releaseFiles'}, 'Unexpected manifest fields')
    require(type(manifest['schemaVersion']) is int and manifest['schemaVersion'] == 1, 'Wrong manifest version')
    for key in ('sourceRevision', 'webSourceRevision'):
        require(type(manifest[key]) is str and re.fullmatch('[a-f0-9]{40}', manifest[key]), 'Explicit full release revisions required')
    release = RELEASE_ROOT + '/session-' + manifest['sourceRevision'][:7]
    web_release = RELEASE_ROOT + '/session-' + manifest['webSourceRevision'][:7]
    require(type(manifest['files']) is dict and set(manifest['files']) == {'install.py', 'profile.json', UNIT_NAME}, 'Unexpected packet files')
    require(type(manifest['releaseFiles']) is dict and set(manifest['releaseFiles']) == RELEASE_FILES, 'Unexpected executable pin set')
    for value in [manifest['webProfileSha256'], *manifest['files'].values(), *manifest['releaseFiles'].values()]:
        require(type(value) is str and re.fullmatch('[a-f0-9]{64}', value), 'Invalid manifest digest')
    files = {}
    for name, expected in manifest['files'].items():
        data, _ = file_bytes(str(packet / name), private=True, maximum=65536)
        require(digest(data) == expected, 'Packet checksum mismatch: ' + name)
        files[name] = data
    validate_profile(strict_json(files['profile.json']), release)
    validate_unit(files[UNIT_NAME], release)
    for name, expected in manifest['releaseFiles'].items():
        data, info = file_bytes(release + '/' + name)
        require(digest(data) == expected, 'Installed release checksum mismatch: ' + name)
        if name == 'release.json':
            description = strict_json(data)
            require(type(description) is dict and description.get('sourceRevision') == manifest['sourceRevision'], 'Installed release metadata revision mismatch')
        if name in {'runtime/node', 'bin/show-tools-peripheral', 'native/peripheral/peripheral-host', 'bin/show-tools-session'}:
            require(info.st_mode & 0o100, 'Expected executable: ' + name)
    web_bytes, _ = file_bytes(WEB_PROFILE, private=True, maximum=16384)
    require(digest(web_bytes) == manifest['webProfileSha256'], 'Web profile differs from reviewed deployment')
    web = strict_json(web_bytes)
    require(type(web) is dict, 'Invalid installed web profile')
    require(web.get('serviceName') == 'show-tools-web.service' and web.get('origin') == 'https://proxmox.tail54fc55.ts.net:8443'
            and web.get('connectAddress') == '100.93.139.99' and web.get('tokenFile') == TOKEN and 'caFile' not in web,
            'Web profile authority/TLS differs from review')
    require(type(web.get('server')) is dict and web['server'].get('nodeExecutable') == web_release + '/runtime/node'
            and web['server'].get('entrypoint') == web_release + '/gateway/server.mjs', 'Web profile differs from its separately reviewed release')
    token_fd = directory(str(Path(TOKEN).parent))
    try:
        token = os.stat(Path(TOKEN).name, dir_fd=token_fd, follow_symlinks=False)
        require(stat.S_ISREG(token.st_mode) and token.st_uid == UID and token.st_gid == GID and stat.S_IMODE(token.st_mode) == 0o600 and token.st_nlink == 1, 'Existing token metadata invalid; require a single-link caller-owned regular mode0600 file')
    finally:
        os.close(token_fd)
    for destination, name in ((PROFILE, 'profile.json'), (UNIT, UNIT_NAME)):
        try:
            existing, _ = file_bytes(destination, private=True)
        except FileNotFoundError:
            continue
        require(existing == files[name], 'Refusing to overwrite different installed file: ' + destination)
    # Every packet/release pin is verified before the first service-manager call.
    manager_env = command(['/usr/bin/systemctl', '--user', 'show-environment'])
    validate_runtime_environment(manager_env)
    state = service_state()
    enabled = enable_link()
    if state.get('ActiveState') == 'active':
        require(file_bytes(PROFILE, private=True)[0] == files['profile.json'] and file_bytes(UNIT, private=True)[0] == files[UNIT_NAME]
                and enabled and state.get('NeedDaemonReload') == 'no' and state.get('FragmentPath') == UNIT,
                'Active service differs from reviewed installation; left unchanged')
        print(json.dumps({'alreadyActive': True, 'changed': False, 'audioStartRequested': False}))
        return
    require(state.get('ActiveState') in ('inactive', 'failed') and state.get('MainPID') == '0'
            and state.get('TasksCurrent', '') in ('0', '[not set]', ''), 'Existing service process/unknown state; left unchanged')
    status = command([release + '/bin/show-tools-session', 'audio', 'status', '--profile', WEB_PROFILE])
    require(status == 'Audio off', 'Fresh audio-off status required; no installation/start requested')
    for destination, name in ((PROFILE, 'profile.json'), (UNIT, UNIT_NAME)):
        install_file(destination, files[name])
    command(['/usr/bin/systemctl', '--user', 'daemon-reload'])
    loaded = service_state()
    require(loaded.get('LoadState') == 'loaded' and loaded.get('FragmentPath') == UNIT and loaded.get('NeedDaemonReload') == 'no', 'Reviewed unit not loaded')
    command(['/usr/bin/systemctl', '--user', 'enable', UNIT_NAME])
    require(enable_link(), 'Expected enablement link missing')
    require(command([release + '/bin/show-tools-session', 'audio', 'status', '--profile', WEB_PROFILE]) == 'Audio off',
            'Fresh audio-off status required before start; installed data/enablement retained, no start requested')
    command(['/usr/bin/systemctl', '--user', 'start', UNIT_NAME])
    final = service_state()
    require(final.get('ActiveState') == 'active' and final.get('MainPID', '0').isdigit() and int(final['MainPID']) > 0, 'Controller not active; inspect its named user journal')
    print(json.dumps({'service': UNIT_NAME, 'installed': True, 'enabled': True, 'active': True,
                      'audioStartRequested': False, 'physicalAcceptance': 'separate'}))


if __name__ == '__main__':
    def interrupted(_signal, _frame):
        raise InterruptedError('Installer interrupted; daemon effects uncertain; inspect status before retry')
    signal.signal(signal.SIGTERM, interrupted)
    parser = argparse.ArgumentParser()
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--activate', required=True, action='store_true')
    arguments = parser.parse_args()
    try:
        require(re.fullmatch('[a-f0-9]{64}', arguments.manifest_sha256), 'Invalid manifest pin')
        apply(Path(__file__).absolute().parent, arguments.manifest_sha256)
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print('PERIPHERAL INSTALL HELD: ' + str(error), file=sys.stderr)
        sys.exit(1)
