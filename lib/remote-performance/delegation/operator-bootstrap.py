#!/usr/bin/python3
"""Operator-only root bootstrap. No app deployment or audio command is executed."""
import contextlib
import fcntl
import grp
import hashlib
import json
import os
from pathlib import Path
import pwd
import re
import socket
import sqlite3
import stat
import subprocess
import sys

STAGE = Path('/root/show-tools-bootstrap-89b1999')
DB = Path('/home/anulman/.local/state/show-tools-mailbox/mailbox.sqlite3')
LEDGER = DB.with_name('authorization.jsonl')
GRANT = Path('/etc/homelab/delegations/show-tools.json')
INACTIVE = '079cc0ec67b130f07b3f6733ad106f93502baa545024c02591231128ce8e1ec1'
ACTIVE = '74defe726c332337bb773873310c5786217002b9d9d8e517d754344cf8d29943'
MANIFEST = '8ca889aaa69176a644b5225be17798a0b2d40fb0ea708125383143d0fc73a0e5'
ENABLED_UNITS_SHA256 = 'ba93a5ca023752588ef60355cef4fd559b0225b55c3be8186b41cde30f6ffa73'
PROTECTED = {
    Path('/usr/local/libexec/show-tools-delegation-check.py'): 'ff28dab2fc95eb4b4e7937a547529d4edd110874f87fd5e7de19d47f6d654d7d',
    Path('/etc/homelab/delegations/show-tools.allowed_signers'): 'd5a1cc72bb6b0631907c7cad1b1285ecb26d4c712fd858bcc2d7588968798de8',
}
BOUNDARY = {
    '/home/anulman/homelab/show-tools-bridge/mailbox.py': (0o664, '25571b39703d940fd28694b897ec1a54c1acd865f2eff9899a2b3b8b477614f0'),
    '/home/anulman/.pi/agent/extensions/show-tools-mailbox.ts': (0o664, '407c9268f2d67d35590d68d090366ab495bb1c0c929d6c994d8716f81bc466b5'),
    '/home/anulman/.ssh/authorized_keys': (0o600, '05649b8438fba87e5e30c1a21115f139a573673bf10027f1d09d8c6b0423e747'),
}
TOOLS = {
    '/usr/sbin/runuser': 'ea71a94cb0097f3e1d5ce2fa8fb775bf1bd1ddd74960fad3ee22d7d8d1ef4488',
    '/usr/bin/loginctl': '4e4841997883337cfcf82a5dd410dd1a3f44d5f7c012fb8e4ac81d88bb2b19b0',
}
SOURCES = {'install.py': {'bytes': 8658, 'sha256': '467154ad80046fe042fd9e622d28e6cddf958a3adbf05a075221ac6d093e0f07', 'parts': [['bootstrap-source-006', '76787e666a80837eca98b09718bbbcfec15c527b8a3728c33bd0c193b22bd3b3', 552, 8658]]}, 'check.py': {'bytes': 24394, 'sha256': 'ff28dab2fc95eb4b4e7937a547529d4edd110874f87fd5e7de19d47f6d654d7d', 'parts': [['bootstrap-source-008', '3cd0c4b7ea55e08a8af1b5e300692eb124c894a599cd2941f1900295469c327b', 553, 10352], ['bootstrap-source-009', '7d0228185b6d14191f3ac0638ce1cc475a749402fb258396a9f0faa1dc36c600', 557, 10341], ['bootstrap-source-010', '1f0584bf940be93113dfea180d34dc40a6e709405c47df6c33fc5ad1bd56124d', 556, 3701]]}, 'grant.inactive.json': {'bytes': 4960, 'sha256': '079cc0ec67b130f07b3f6733ad106f93502baa545024c02591231128ce8e1ec1', 'parts': [['bootstrap-source-002', 'f980a1bcce2cd74e41648bc265648e75d996baf1655f1e625f544248829ba129', 561, 4960]]}, 'allowed_signers': {'bytes': 129, 'sha256': 'd5a1cc72bb6b0631907c7cad1b1285ecb26d4c712fd858bcc2d7588968798de8', 'parts': [['bootstrap-source-003', 'c28c7657060960b9f1a8ba6bd471bc7c06b4f2fec39b8c65296da73c409e26e4', 766, 129]]}, 'initialize-ledger.py': {'bytes': 3602, 'sha256': '665adce7739eae6119b57e8b78faf5f5cb3175128e3cc43685abc3573091bc34', 'parts': [['bootstrap-source-007', '3006b1994d8173c9261d6c8fdf9ae6154076ebf5947e2c457374b335843577cf', 562, 3602]]}, 'manifest.json': {'bytes': 384, 'sha256': '8ca889aaa69176a644b5225be17798a0b2d40fb0ea708125383143d0fc73a0e5', 'parts': [['bootstrap-source-011', '3c52eb457e6053645ac3de02b4656e530d1b091c0af43471990eb8161014c92e', 5932, 384]]}}


def require(value, reason):
    if not value:
        raise ValueError(reason)


def digest(value):
    return hashlib.sha256(value).hexdigest()


def strict_json(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, 'duplicate JSON key')
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))


def ancestors(path, root_only=False, exact_mode=None):
    for parent in reversed(path.parents):
        info = parent.lstat()
        require(stat.S_ISDIR(info.st_mode), 'symlink or non-directory ancestor')
        require(info.st_uid == 0 if root_only else info.st_uid in (0, 1000), 'unexpected ancestor owner')
        require(not info.st_mode & (0o022 if root_only else 0o002), 'writable ancestor')
        if exact_mode is not None:
            require(info.st_gid == 0 and stat.S_IMODE(info.st_mode) == exact_mode, 'protected ancestry mode drift')


def read_file(path, uid, gid, mode, limit=65536):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == uid and info.st_gid == gid
                and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == mode, 'unsafe file metadata')
        require(info.st_size <= limit, 'file size limit')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            data = stream.read(limit + 1)
        require(len(data) <= limit, 'file size limit')
        return data
    finally:
        os.close(fd)


def root_file(path, expected):
    ancestors(path, root_only=True, exact_mode=0o755)
    data = read_file(path, 0, 0, 0o644)
    require(digest(data) == expected, 'protected file digest drift')
    return data


def trusted_tools():
    for filename, expected in TOOLS.items():
        path = Path(filename)
        ancestors(path, root_only=True)
        require(digest(read_file(path, 0, 0, 0o755, 1048576)) == expected, 'system tool drift')


def boundary():
    for filename, (mode, expected) in BOUNDARY.items():
        path = Path(filename)
        ancestors(path)
        require(digest(read_file(path, 1000, 1000, mode)) == expected, 'bridge or SSH boundary drift')


def reconstruct(connection):
    connection.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 65536)
    connection.setlimit(sqlite3.SQLITE_LIMIT_SQL_LENGTH, 65536)
    connection.setlimit(sqlite3.SQLITE_LIMIT_COLUMN, 64)
    connection.set_progress_handler(lambda: 1, 100000)
    connection.execute('PRAGMA trusted_schema=OFF')
    connection.execute('PRAGMA query_only=ON')
    connection.execute('PRAGMA busy_timeout=3000')
    schema = connection.execute("SELECT type,substr(sql,1,4097) FROM sqlite_schema WHERE name='messages'").fetchone()
    require(schema is not None and schema[0] == 'table' and type(schema[1]) is str
            and len(schema[1]) <= 4096 and schema[1].lstrip().upper().startswith('CREATE TABLE '), 'ordinary mailbox table required')
    columns = connection.execute('PRAGMA table_xinfo(messages)').fetchall()
    require([(row[1], row[2].lower(), row[6]) for row in columns] ==
            [('id', 'text', 0), ('content', 'text', 0), ('created', 'real', 0), ('status', 'text', 0), ('reply', 'text', 0)], 'mailbox schema drift')
    files = {}
    for name, specification in SOURCES.items():
        pieces = []
        for rid, message_sha, offset, length in specification['parts']:
            row = connection.execute('SELECT substr(CAST(content AS BLOB),1,16001) FROM messages WHERE id=?', (rid,)).fetchone()
            require(row is not None and type(row[0]) is bytes and len(row[0]) <= 16000, 'missing or oversized source message')
            require(digest(row[0]) == message_sha, 'source message digest drift')
            piece = row[0][offset:offset + length]
            require(len(piece) == length, 'truncated source range')
            pieces.append(piece)
        data = b''.join(pieces)
        require(len(data) == specification['bytes'] and digest(data) == specification['sha256'], 'source file digest drift')
        files[name] = data
    return files


def source_files():
    ancestors(DB)
    parent = DB.parent.lstat()
    require((parent.st_uid, parent.st_gid, stat.S_IMODE(parent.st_mode)) == (1000, 1000, 0o700), 'private mailbox directory required')
    fd = os.open(DB, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and (info.st_uid, info.st_gid, stat.S_IMODE(info.st_mode), info.st_nlink)
                == (1000, 1000, 0o600, 1) and info.st_size <= 16777216, 'unsafe mailbox database')
        with contextlib.closing(sqlite3.connect('file:/proc/self/fd/' + str(fd) + '?mode=ro', uri=True, timeout=3)) as connection:
            return reconstruct(connection)
    finally:
        os.close(fd)


def private_directory(path):
    ancestors(path, root_only=True)
    try:
        path.mkdir(mode=0o700)
        path.chmod(0o700)
    except FileExistsError:
        pass
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o700, 'private root staging required')


def frozen_file(path, data):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        require(read_file(path, 0, 0, 0o600) == data, 'existing staged file drift; reconcile without overwriting')
        return
    try:
        os.fchmod(fd, 0o600)
        os.fchown(fd, 0, 0)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            require(stream.write(data) == len(data), 'short staged write')
            stream.flush()
            os.fsync(fd)
    finally:
        os.close(fd)


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=30, check=False, env={'PATH': '/usr/bin:/bin', 'LANG': 'C'})
    require(result.returncode == 0, 'fixed bootstrap subprocess failed: ' + args[0])
    require(len(result.stdout) <= 8192 and len(result.stderr) <= 8192, 'subprocess output limit')
    return result.stdout


def as_user(source, args=()):
    return run(['/usr/sbin/runuser', '-u', 'anulman', '--', '/usr/bin/python3', '-B', '-I', '-', *args], source)


def grant_state():
    try:
        ancestors(GRANT, root_only=True, exact_mode=0o755)
        value = digest(read_file(GRANT, 0, 0, 0o644))
    except FileNotFoundError:
        return 'absent'
    return {INACTIVE: 'inactive', ACTIVE: 'active'}.get(value, 'unexpected')


def verify_protected(active):
    for path, expected in PROTECTED.items():
        root_file(path, expected)
    root_file(GRANT, ACTIVE if active else INACTIVE)


def verify_ledger():
    ancestors(LEDGER)
    parent = LEDGER.parent.lstat()
    require(parent.st_uid == 1000 and parent.st_gid == 1000 and stat.S_IMODE(parent.st_mode) == 0o700, 'unsafe ledger parent')
    fd = os.open(LEDGER, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        fcntl.flock(fd, fcntl.LOCK_SH)
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == 1000 and info.st_gid == 1000
                and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600, 'unsafe ledger metadata')
        with os.fdopen(fd, 'rb', closefd=False) as stream:
            raw = stream.read(8388609)
        require(0 < len(raw) <= 8388608 and raw.endswith(b'\n'), 'missing, truncated or oversized ledger')
        rows = raw.splitlines()
        require(len(rows) == 1, 'unexpected prior authorization history')
        genesis = strict_json(rows[0])
        require(set(genesis) == {'kind', 'schemaVersion', 'principal', 'namespace', 'createdAt', 'nonce', 'device', 'inode'}, 'invalid genesis fields')
        require(genesis['kind'] == 'show-tools-authorization-genesis' and type(genesis['schemaVersion']) is int
                and genesis['schemaVersion'] == 1 and genesis['principal'] == 'show-tools-pi'
                and genesis['namespace'] == 'show-tools-deploy-v1' and type(genesis['createdAt']) is int
                and 0 <= genesis['createdAt'] <= 4102444800 and type(genesis['nonce']) is str
                and re.fullmatch('[0-9a-f]{32}', genesis['nonce']) and type(genesis['device']) is int
                and genesis['device'] == info.st_dev and type(genesis['inode']) is int
                and genesis['inode'] == info.st_ino, 'invalid ledger genesis or replaced inode')
    finally:
        os.close(fd)


PERSISTENCE = b'''import hashlib,json,os,pathlib,stat,sys
if os.getuid()!=1000 or os.geteuid()!=1000 or os.getgid()!=1000 or not sys.flags.isolated or sys.argv[1:] not in (['--check'],['--apply']): raise ValueError('UID1000 isolated helper required')
apply=sys.argv[1]=='--apply'
parent=pathlib.Path('/home/anulman/.config/systemd/user')
def present(path):
 try: path.lstat(); return True
 except FileNotFoundError: return False
for root in ['/etc/systemd/user','/run/systemd/user','/usr/local/lib/systemd/user','/usr/lib/systemd/user','/run/user/1000/systemd/user']:
 for name in ['show-tools-web.service','show-tools-web.service.d']:
  if present(pathlib.Path(root)/name): raise ValueError('foreign global or runtime web unit')
for p in reversed(parent.parents):
 s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or s.st_uid not in (0,1000) or s.st_mode&2: raise ValueError('unsafe user config ancestry')
for p,mode in [(parent.parent,0o775),(parent,0o775)]:
 s=p.lstat()
 if not stat.S_ISDIR(s.st_mode) or (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode))!=(1000,1000,mode): raise ValueError('user unit parent drift')
unit=parent/'show-tools-web.service'
if present(parent/'show-tools-web.service.d'): raise ValueError('foreign drop-ins')
exists=present(unit)
if exists:
 fd=os.open(unit,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  s=os.fstat(fd)
  if not stat.S_ISREG(s.st_mode) or (s.st_uid,s.st_gid,stat.S_IMODE(s.st_mode),s.st_nlink)!=(1000,1000,0o600,1): raise ValueError('foreign unit metadata')
  with os.fdopen(fd,'rb',closefd=False) as f: data=f.read(8193)
  if hashlib.sha256(data).hexdigest()!='cb2f968d0768a1cbf587c2a4b8e8644e9cd91a60a7035977b085c73901779ffc': raise ValueError('foreign unit bytes')
 finally: os.close(fd)
wants=parent/'default.target.wants'
if apply:
 try:
  wants.mkdir(mode=0o700)
  wants.chmod(0o700)
 except FileExistsError: pass
if present(wants):
 s=wants.lstat()
 if not stat.S_ISDIR(s.st_mode) or (s.st_uid,s.st_gid)!=(1000,1000) or s.st_mode&2: raise ValueError('foreign wants directory')
link=wants/'show-tools-web.service'
if apply:
 try: os.symlink('../show-tools-web.service',link)
 except FileExistsError: pass
linked=present(link)
if linked:
 s=link.lstat()
 if not stat.S_ISLNK(s.st_mode) or (s.st_uid,s.st_gid)!=(1000,1000) or os.readlink(link)!='../show-tools-web.service': raise ValueError('foreign enablement link')
print(json.dumps({'unitEnablement':('present' if exists else 'pending-unit-install') if linked else 'absent','webStarted':False}))
'''
INVENTORY = b'''import json,os,subprocess,sys
if (os.getuid(),os.geteuid(),os.getgid())!=(1000,1000,1000) or not sys.flags.isolated: raise ValueError('UID1000 required')
env={'PATH':'/usr/bin:/bin','LANG':'C','XDG_RUNTIME_DIR':'/run/user/1000','DBUS_SESSION_BUS_ADDRESS':'unix:path=/run/user/1000/bus'}
def query(args):
 r=subprocess.run(['/usr/bin/systemctl','--user',*args],stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=env,timeout=10,check=True)
 if len(r.stdout)>16384 or len(r.stderr)>8192: raise ValueError('unit inventory output limit')
 return r.stdout.decode()
service={line.split('=',1)[0]:line.split('=',1)[1] for line in query(['show','show-tools-web.service','--property=LoadState,FragmentPath,DropInPaths,ActiveState']).splitlines() if '=' in line}
if service.get('DropInPaths') or service.get('ActiveState') not in ['active','inactive']: raise ValueError('unexpected web service state or drop-ins')
if service.get('LoadState')=='not-found':
 if service.get('FragmentPath') or service.get('ActiveState')!='inactive': raise ValueError('foreign missing-unit state')
elif service.get('LoadState')=='loaded':
 if service.get('FragmentPath')!='/home/anulman/.config/systemd/user/show-tools-web.service': raise ValueError('foreign loaded web unit')
else: raise ValueError('unexpected web unit load state')
rows=[line.split()[:2] for line in query(['list-unit-files','--state=enabled,enabled-runtime,linked,linked-runtime','--no-pager','--no-legend']).splitlines() if line.strip()]
rows=sorted([row for row in rows if row!=['show-tools-web.service','enabled']])
graph={}
for name in ['default.target','basic.target','paths.target','timers.target','sockets.target']:
 props={line.split('=',1)[0]:line.split('=',1)[1].split() for line in query(['show',name,'--property=Wants,Requires']).splitlines() if '=' in line}
 graph[name]={key:sorted([item for item in props[key] if not(name=='default.target' and item=='show-tools-web.service')]) for key in ['Wants','Requires']}
print(json.dumps({'enabled':rows,'graph':graph},sort_keys=True,separators=(',',':')))
'''


def bootstrap():
    require(len(sys.argv) == 1 and os.getuid() == 0 and os.geteuid() == 0 and sys.flags.isolated == 1, 'operator isolated root terminal required')
    require(socket.gethostname().split('.')[0] == 'proxmox', 'assigned host required')
    account = pwd.getpwnam('anulman')
    require((account.pw_uid, account.pw_gid, account.pw_dir) == (1000, 1000, '/home/anulman'), 'assigned account drift')
    group = grp.getgrgid(1000)
    require(group.gr_name == 'anulman' and group.gr_mem == []
            and sorted(user.pw_name for user in pwd.getpwall() if user.pw_gid == 1000) == ['anulman'], 'group1000 membership drift')
    require(Path(__file__) == STAGE / 'operator-bootstrap.py', 'root-frozen wrapper path required')
    private_directory(STAGE)
    read_file(Path(__file__), 0, 0, 0o600)
    trusted_tools()
    boundary()
    as_user(PERSISTENCE, ['--check'])
    inventory = strict_json(as_user(INVENTORY))
    require(digest(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode()) == ENABLED_UNITS_SHA256, 'enabled user-unit inventory changed or not yet reviewed')
    files = source_files()
    bundle = STAGE / 'bundle'
    private_directory(bundle)
    require(set(bundle.iterdir()) <= {bundle / name for name in SOURCES}, 'unexpected staged bundle file')
    for name, data in files.items():
        frozen_file(bundle / name, data)
    state = grant_state()
    require(state in ('absent', 'inactive', 'active'), 'unexpected grant; no overwrite')
    installer = ['/usr/bin/python3', '-B', '-I', str(bundle / 'install.py')]
    if state != 'active':
        run([*installer, 'install', str(bundle), MANIFEST])
        verify_protected(False)
        if not LEDGER.exists() and not LEDGER.is_symlink():
            as_user(files['initialize-ledger.py'], ['--operator-approved-bootstrap', INACTIVE])
        verify_ledger()
        boundary()
        verify_protected(False)
        run([*installer, 'activate', INACTIVE, ACTIVE])
    verify_protected(True)
    verify_ledger()
    persistence = strict_json(as_user(PERSISTENCE, ['--apply']))
    run(['/usr/bin/loginctl', 'enable-linger', 'anulman'])
    require(run(['/usr/bin/loginctl', 'show-user', 'anulman', '--property=Linger', '--value']).strip() == b'yes', 'linger not verified')
    return {'grant': 'ACTIVE', 'grantSha256': ACTIVE, 'linger': True, **persistence,
            'piRecognition': 'still-required', 'nativeAudioStartRequested': False}


def main():
    try:
        print(json.dumps(bootstrap()))
        return 0
    except Exception as error:
        try:
            state = grant_state()
        except Exception:
            state = 'unknown'
        print(json.dumps({'error': str(error), 'actualGrantState': state,
                          'persistence': 'inspect-before-retry', 'piRecognition': 'still-required'}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
