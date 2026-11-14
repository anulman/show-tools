import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { configuration, ensureManager, call } from '../client.js';
import { importBuild, sourceInfo, worktreeKey } from '../snapshot.js';
import { identity } from '../broker.js';

const execute = promisify(execFile);
async function freePort() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const port = address.port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ui-manager-test-')));
  const repo = join(root, 'repo'); await mkdir(repo);
  await execute('git', ['init', repo]);
  await execute('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'fixture']);
  const port = await freePort();
  const config = await configuration(repo, { SHOW_TOOLS_UI_STATE: join(root, 'state'), SHOW_TOOLS_UI_LIVE_PORT: String(await freePort()), SHOW_TOOLS_UI_PREVIEW_FIRST: String(port), SHOW_TOOLS_UI_PREVIEW_LAST: String(port + 3) });
  async function build(text: string) {
    const dist = join(root, 'dist-' + text); await mkdir(join(dist, 'ui/practice'), { recursive: true });
    const path = '/ui/practice/index.html';
    const cacheId = createHash('sha256').update(path).update('\0').update(text).update('\0').digest('hex');
    await writeFile(join(dist, 'ui/practice/index.html'), text);
    await writeFile(join(dist, 'ui/practice/sw.js'), cacheId);
    await writeFile(join(dist, 'ui/practice/offline-manifest.json'), JSON.stringify({ cacheId, files: [path] }));
    await writeFile(join(dist, 'build-info.json'), JSON.stringify({ version: 1, source: await sourceInfo(repo) }));
    return importBuild(dist, config.stateRoot);
  }
  return { root, repo, config, build, async cleanup() {
    try { await call(config, { command: 'shutdown' }); } catch {}
    // Wait for the exact managed process to release its private socket before deleting state.
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await call(config, { command: 'status' }); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    await rm(root, { recursive: true, force: true }); await rm(config.controlDirectory, { recursive: true, force: true });
  } };
}

test('real manager reuses ownership, pins builds, retains reservations, and refuses foreign listeners', async () => {
  const f = await fixture();
  const foreign = createServer((_request, response) => response.end('foreign'));
  try {
    const owners = await Promise.all([ensureManager(f.config), ensureManager(f.config)]);
    assert.equal(owners[0].owner.pid, owners[1].owner.pid);
    const first = await f.build('one'); const second = await f.build('two');
    const target = { kind: 'preview', worktree: f.repo, worktreeKey: await worktreeKey(f.repo), session: 'practice' } satisfies import('../model.js').Target;
    const served = await call(f.config, { command: 'serve', target, snapshot: first.id }); assert(served.ok, JSON.stringify(served));
    const row = served.statuses[0].registration; const origin = `http://127.0.0.1:${row.port}`;
    const initial = await fetch(origin + '/', { redirect: 'manual' });
    assert.equal(initial.status, 302); assert.equal(await (await fetch(origin + initial.headers.get('location'))).text(), 'one');
    const promoted = await call(f.config, { command: 'serve', target, snapshot: second.id }); assert(promoted.ok);
    assert.equal(await (await fetch(origin + `/__build/${first.id}/ui/practice/index.html`)).text(), 'one');
    assert.equal(await (await fetch(origin + `/ui/practice/index.html?__show_tools_build=${first.cacheId}`)).text(), 'one');
    const corrupt = join(f.config.stateRoot, 'snapshots', second.id, 'files/ui/practice/index.html'); await writeFile(corrupt, 'corrupted');
    const rejected = await call(f.config, { command: 'serve', target, snapshot: second.id }); assert(!rejected.ok);
    assert.equal(await (await fetch(origin + `/__build/${first.id}/ui/practice/index.html`)).text(), 'one');
    await call(f.config, { command: 'stop', id: row.id });
    await new Promise<void>(resolve => foreign.listen(row.port, '127.0.0.1', resolve));
    const collision = await call(f.config, { command: 'serve', target, snapshot: first.id }); assert(!collision.ok);
    assert.match(collision.error, /existing owner was left untouched/);
    assert.equal(await (await fetch(origin)).text(), 'foreign');
    const unknown = await call(f.config, { command: 'stop', id: 'f'.repeat(64) }); assert(!unknown.ok);
    assert.equal(await (await fetch(origin)).text(), 'foreign');
    const other = await call(f.config, { command: 'serve', target: { ...target, session: 'other' }, snapshot: first.id }); assert(other.ok);
    assert.notEqual(other.statuses.find(item => item.registration.id === identity({ ...target, session: 'other' }))?.registration.port, row.port);
    assert.equal(JSON.parse(await readFile(join(f.config.stateRoot, 'registry.json'), 'utf8')).registrations.length, 2);
  } finally { foreign.closeAllConnections(); if (foreign.listening) await new Promise<void>(resolve => foreign.close(() => resolve())); await f.cleanup(); }
});


test('CLI starts/reuses/stops the assigned origin and reservations survive manager restart', async () => {
  const f = await fixture();
  try {
    await f.build('cli'); await cp(join(f.root, 'dist-cli'), join(f.repo, 'dist'), { recursive: true });
    const cli = new URL('../cli.ts', import.meta.url).href;
    const invoke = (args: string[]) => execute(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `const {runUiCli}=await import(${JSON.stringify(cli)}); await runUiCli(JSON.parse(process.argv[1]),process.argv[2]);`, JSON.stringify(args), f.repo], {
      cwd: process.cwd(), env: { ...process.env, SHOW_TOOLS_UI_STATE: join(f.root, 'state'), SHOW_TOOLS_UI_LIVE_PORT: String(f.config.livePort), SHOW_TOOLS_UI_PREVIEW_FIRST: String(f.config.previewFirst), SHOW_TOOLS_UI_PREVIEW_LAST: String(f.config.previewLast) },
    });
    const printed = await invoke(['preview']);
    assert.match(printed.stdout, /http:\/\/127\.0\.0\.1:\d+\/  /);
    const initial = await call(f.config, { command: 'status' }); assert(initial.ok);
    await invoke(['preview']);
    const reused = await call(f.config, { command: 'status' }); assert(reused.ok);
    assert.equal(initial.owner.pid, reused.owner.pid); assert.equal(reused.statuses.length, 1);
    const port = initial.statuses[0].registration.port;
    await invoke(['stop']);
    await invoke(['shutdown']);
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await call(f.config, { command: 'status' }); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    const stopped = JSON.parse((await invoke(['status', '--json'])).stdout);
    assert.equal(stopped.statuses[0].runtime.kind, 'stopped');
    await invoke(['preview']);
    const restarted = await call(f.config, { command: 'status' }); assert(restarted.ok);
    assert.equal(restarted.statuses[0].registration.port, port);
    assert.notEqual(restarted.owner.pid, initial.owner.pid);
  } finally { await f.cleanup(); }
});

test('an unavailable socket with a live recorded owner fails closed without signalling it', async () => {
  const f = await fixture();
  try {
    await mkdir(f.config.controlDirectory, { recursive: true, mode: 0o700 });
    await writeFile(join(f.config.controlDirectory, 'owner.json'), JSON.stringify({ version: 1, nonce: 'foreign', pid: process.pid }));
    await assert.rejects(ensureManager(f.config), /live UI manager owns an unavailable socket/);
    process.kill(process.pid, 0);
  } finally { await f.cleanup(); }
});

test('a mismatched private ownership record fails closed without stopping the responding manager', async () => {
  const f = await fixture();
  try {
    const ready = await ensureManager(f.config);
    const ownerPath = join(f.config.controlDirectory, 'owner.json');
    const original = await readFile(ownerPath, 'utf8');
    try {
      await writeFile(ownerPath, JSON.stringify({ ...ready.owner, nonce: 'different-owner' }));
      await assert.rejects(ensureManager(f.config), /record PID \d+, response PID \d+, nonce differs/);
      const responding = await call(f.config, { command: 'status' });
      assert(responding.ok);
      assert.deepEqual(responding.owner, ready.owner);
      process.kill(ready.owner.pid, 0);
    } finally { await writeFile(ownerPath, original); }
  } finally { await f.cleanup(); }
});

test('a different worktree recreated at the same path cannot inherit the prior origin', async () => {
  const f = await fixture(); const path = join(f.root, 'preview');
  try {
    await execute('git', ['-C', f.repo, 'worktree', 'add', '--detach', path, 'HEAD']);
    await ensureManager(f.config); const build = await f.build('recreated');
    const first = { kind: 'preview', worktree: path, worktreeKey: await worktreeKey(path), session: 'worktree' } satisfies import('../model.js').Target;
    const served = await call(f.config, { command: 'serve', target: first, snapshot: build.id }); assert(served.ok);
    const port = served.statuses[0].registration.port;
    await call(f.config, { command: 'stop', id: identity(first) });
    await execute('git', ['-C', f.repo, 'worktree', 'remove', path]);
    await execute('git', ['-C', f.repo, 'worktree', 'add', '--detach', path, 'HEAD']);
    const replacement = { ...first, worktreeKey: await worktreeKey(path) }; assert.notEqual(replacement.worktreeKey, first.worktreeKey);
    const stale = await call(f.config, { command: 'serve', target: first, snapshot: build.id }); assert(!stale.ok);
    const next = await call(f.config, { command: 'serve', target: replacement, snapshot: build.id }); assert(next.ok);
    assert.notEqual(next.statuses.find(item => item.registration.id === identity(replacement))?.registration.port, port);
  } finally { await f.cleanup(); }
});


test('snapshot receipt fields cannot relabel a verified artifact', async () => {
  const f = await fixture();
  try {
    const build = await f.build('receipt');
    const path = join(f.config.stateRoot, 'snapshots', build.id, 'snapshot.json');
    await writeFile(path, JSON.stringify({ ...build, cacheId: 'f'.repeat(64) }));
    const { loadSnapshot } = await import('../snapshot.js');
    await assert.rejects(loadSnapshot(f.config.stateRoot, build.id), /receipt does not match/);
    await writeFile(path, JSON.stringify({ ...build, source: { ...build.source, revision: 'f'.repeat(40) } }));
    await assert.rejects(loadSnapshot(f.config.stateRoot, build.id), /receipt does not match/);
  } finally { await f.cleanup(); }
});


test('concurrent stale-lock recovery cannot remove a newly acquired startup lock', async () => {
  for (let round = 0; round < 5; round++) {
  const f = await fixture();
  try {
    await mkdir(join(f.config.controlDirectory, 'starting'), { recursive: true, mode: 0o700 });
    await writeFile(join(f.config.controlDirectory, 'starting/owner.json'), JSON.stringify({ version: 1, nonce: 'abandoned-start', pid: 99999999 }));
    const owners = await Promise.all(Array.from({ length: 8 }, () => ensureManager(f.config)));
    assert.equal(new Set(owners.map(owner => owner.owner.pid)).size, 1);
  } finally { await f.cleanup(); }
  }
});

test('concurrent startup preserves one complete configuration and rejects conflicting origins', async () => {
  const f = await fixture();
  const conflicting = { ...f.config, livePort: f.config.livePort === 65535 ? 65534 : f.config.livePort + 1 };
  try {
    const candidates = Array.from({ length: 16 }, (_, index) => index % 2 ? conflicting : f.config);
    const results = await Promise.allSettled(candidates.map(config => ensureManager(config)));
    const saved = JSON.parse(await readFile(join(f.config.stateRoot, 'manager-config.json'), 'utf8'));
    const owners = new Set<number>();
    for (const [index, result] of results.entries()) {
      if (JSON.stringify(candidates[index]) === JSON.stringify(saved)) {
        assert.equal(result.status, 'fulfilled');
        if (result.status === 'fulfilled') owners.add(result.value.owner.pid);
      } else {
        assert.equal(result.status, 'rejected');
        if (result.status === 'rejected') assert.match(String(result.reason), /configuration (?:changed|conflicts)/);
      }
    }
    assert.equal(owners.size, 1);
    assert.deepEqual(saved, saved.livePort === f.config.livePort ? f.config : conflicting);
  } finally { await f.cleanup(); }
});

test('an incomplete startup owner remains fail-closed and is left intact', async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.config.controlDirectory, 'starting'), { recursive: true, mode: 0o700 });
    await assert.rejects(ensureManager(f.config), /startup ownership is incomplete/);
    const { stat } = await import('node:fs/promises');
    assert((await stat(join(f.config.controlDirectory, 'starting'))).isDirectory());
  } finally { await f.cleanup(); }
});

test('live publication accepts a clean merged build and preserves it after dirty-build refusal', async () => {
  const f = await fixture();
  try {
    await execute('git', ['-C', f.repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD']);
    const clean = await f.build('live-clean'); await ensureManager(f.config);
    const live = await call(f.config, { command: 'serve', target: { kind: 'live' }, snapshot: clean.id }); assert(live.ok);
    const row = live.statuses[0].registration; assert.equal(row.port, f.config.livePort);
    await writeFile(join(f.repo, 'untracked-source.ts'), 'export const changed = true;');
    const dirty = await f.build('live-dirty'); assert(dirty.source.dirty);
    const rejected = await call(f.config, { command: 'serve', target: { kind: 'live' }, snapshot: dirty.id }); assert(!rejected.ok);
    assert.match(rejected.error, /clean committed build/);
    assert.equal(await (await fetch(`http://127.0.0.1:${row.port}/`)).text(), 'live-clean');
  } finally { await f.cleanup(); }
});
