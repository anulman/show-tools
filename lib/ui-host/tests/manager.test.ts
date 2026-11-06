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
import { importBuild, sourceInfo } from '../snapshot.js';
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
    const target = { kind: 'preview', worktree: f.repo, session: 'practice' } satisfies import('../model.js').Target;
    const served = await call(f.config, { command: 'serve', target, snapshot: first.id }); assert(served.ok, JSON.stringify(served));
    const row = served.statuses[0].registration; const origin = `http://127.0.0.1:${row.port}`;
    const initial = await fetch(origin + '/ui/practice/', { redirect: 'manual' });
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
    await invoke(['preview']);
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
