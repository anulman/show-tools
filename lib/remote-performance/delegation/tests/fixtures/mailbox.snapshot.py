#!/usr/bin/python3
"""Single-peer message mailbox. SSH can access only submit/get/ping/client."""
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys
import time

ROOT = Path('/home/anulman/.local/state/show-tools-mailbox')
TARGET = '01a1a8d3-1397-725f-801a-ed531eb64b77'
ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_-]{0,79}\Z')


def valid_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        raise ValueError('id must be 1-80 ASCII letters/digits/underscore/hyphen')
    return value


def dispatch(db, req, local=False):
    op = req.get('op')
    now = time.time()
    if op == 'ping':
        row = db.execute('select seen from heartbeat where id=1').fetchone()
        return {'ok': True, 'peer': 'personal-mbp/show-tools-pi',
                'session': TARGET, 'receiver_online': bool(row and now-row[0] < 10)}
    if op == 'client':
        return {'ok': True, 'filename': 'show-tools-pi.py',
                'source': Path(__file__).with_name('client.py').read_text()}
    if op == 'submit':
        rid = valid_id(req.get('id'))
        content = req.get('content')
        if not isinstance(content, str) or not content.strip() or len(content.encode()) > 16000:
            raise ValueError('content must contain 1-16000 UTF-8 bytes')
        with db:
            db.execute('begin immediate')
            old = db.execute('select content,status from messages where id=?', (rid,)).fetchone()
            if old:
                if old[0] != content:
                    raise ValueError('id already used for different content')
                return {'ok': True, 'id': rid, 'status': old[1], 'duplicate': True}
            if db.execute('select count(*) from messages').fetchone()[0] >= 1000:
                raise ValueError('mailbox retention limit reached; ask operator to archive')
            if db.execute("select count(*) from messages where reply is null").fetchone()[0] >= 20:
                raise ValueError('pending queue full')
            if db.execute('select count(*) from messages where created>?', (now-60,)).fetchone()[0] >= 10:
                raise ValueError('submit rate limit: 10/minute')
            db.execute("insert into messages values (?,?,?,'queued',null)", (rid,content,now))
        return {'ok': True, 'id': rid, 'status': 'queued'}
    if op == 'get':
        rid = valid_id(req.get('id'))
        row = db.execute('select status,reply from messages where id=?', (rid,)).fetchone()
        if not row:
            raise ValueError('unknown id')
        return {'ok': True, 'id': rid, 'status': row[0],
                'reply': json.loads(row[1]) if row[1] else None}
    if local and op == 'next':
        with db:
            db.execute('insert or replace into heartbeat values (1,?)', (now,))
        row = db.execute('select id,content,status from messages where reply is null order by created,id limit 1').fetchone()
        return {'ok': True, 'message': dict(zip(('id','content','status'),row)) if row else None}
    if local and op == 'delivered':
        with db:
            db.execute("update messages set status='delivered' where id=? and reply is null", (valid_id(req['id']),))
        return {'ok': True}
    if local and op == 'reply':
        rid = valid_id(req.get('id'))
        text = req.get('content')
        status = req.get('status')
        if status not in ('completed','blocked') or not isinstance(text,str) or not 0 < len(text.encode()) <= 24000:
            raise ValueError('reply requires completed/blocked and 1-24000 bytes')
        reply = json.dumps({'content':text,'status':status,'at':now})
        with db:
            row = db.execute('select reply from messages where id=?',(rid,)).fetchone()
            if not row or row[0]:
                raise ValueError('unknown or already answered id')
            db.execute('update messages set status=?,reply=? where id=?',(status,reply,rid))
        return {'ok': True, 'id':rid, 'status':status}
    raise ValueError('operation not allowed')


def connect():
    os.umask(0o077)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    db = sqlite3.connect(ROOT/'mailbox.sqlite3', timeout=3)
    db.execute('create table if not exists messages (id text primary key, content text not null, created real not null, status text not null, reply text)')
    db.execute('create table if not exists heartbeat (id integer primary key, seen real)')
    return db


def main():
    local = sys.argv[1:] == ['local']
    if not local:
        if os.environ.get('SSH_ORIGINAL_COMMAND') != 'show-tools-mailbox':
            raise ValueError('Only the show-tools-mailbox command is allowed')
        if os.environ.get('SSH_CONNECTION','').split(' ')[0] != '100.91.87.3':
            raise ValueError('Source must be personal-mbp on Tailscale IPv4')
    signal.signal(signal.SIGALRM, lambda *_: sys.exit(124))
    signal.alarm(15)
    raw = sys.stdin.buffer.read(32769)
    if len(raw) > 32768:
        raise ValueError('request too large')
    req = json.loads(raw)
    if not isinstance(req,dict):
        raise ValueError('expected JSON object')
    with connect() as db:
        result = dispatch(db,req,local)
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'ok':False,'error':str(exc)}))
        sys.exit(1)
