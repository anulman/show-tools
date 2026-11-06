import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, stat, writeFile, realpath } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { extname, join, resolve, sep } from 'node:path';
import { decode, RegistrySchema, RequestSchema, type Config, type Owner, type Registration, type Registry, type Request, type Snapshot, type Status } from './model.js';
import { git, loadSnapshot, repository, worktreeKey } from './snapshot.js';

const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.md': 'text/plain' };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 3000);
export const identity = (target: Registration['target']) => createHash('sha256').update(JSON.stringify(target)).digest('hex');
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); response.end(JSON.stringify(body));
}
async function listen(server: Server, address: number | string) {
  await new Promise<void>((resolve, reject) => {
    const error = (cause: Error) => { server.off('listening', ready); reject(cause); };
    const ready = () => { server.off('error', error); resolve(); };
    server.once('error', error); server.once('listening', ready);
    if (typeof address === 'number') server.listen(address, '127.0.0.1'); else server.listen(address);
  });
}
async function close(server: Server) {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
}
export async function createUiBroker(config: Config, owner: Owner) {
  await mkdir(config.stateRoot, { recursive: true, mode: 0o700 });
  let registry: Registry;
  try { registry = decode(RegistrySchema, JSON.parse(await readFile(join(config.stateRoot, 'registry.json'), 'utf8'))); }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    registry = { version: 1, repository: config.repository, registrations: [] };
  }
  if (registry.repository !== config.repository) throw new Error('UI registry belongs to another repository');
  if (new Set(registry.registrations.map(row => row.id)).size !== registry.registrations.length
    || new Set(registry.registrations.map(row => row.port)).size !== registry.registrations.length
    || registry.registrations.some(row => row.id !== identity(row.target))) throw new Error('UI registry has conflicting identities or ports');
  const running = new Map<string, { server: Server; build: Snapshot }>();
  const blocked = new Map<string, string>();
  const snapshots = new Map<string, Snapshot>();
  const snapshot = async (id: string) => {
    const loaded = snapshots.get(id) ?? await loadSnapshot(config.stateRoot, id);
    snapshots.set(id, loaded); return loaded;
  };
  const rows = (): Status[] => registry.registrations.map(registration => {
    const current = running.get(registration.id), error = blocked.get(registration.id);
    return { registration, runtime: current ? { kind: 'serving', build: current.build } : error ? { kind: 'blocked', error } : { kind: 'stopped' } };
  });
  async function persist(next: Registry) {
    const temporary = join(config.stateRoot, '.registry-' + randomUUID());
    await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
    await rename(temporary, join(config.stateRoot, 'registry.json')); registry = next;
  }
  const registration = (id: string) => registry.registrations.find(row => row.id === id);
  const save = (row: Registration) => persist({ ...registry, registrations: [...registry.registrations.filter(old => old.id !== row.id), row] });
  async function requestAsset(id: string, request: IncomingMessage, response: ServerResponse) {
    const row = registration(id), active = running.get(id);
    if (!row || !active) return json(response, 503, { error: 'Preview stopped' });
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(response, 405, { error: 'Read-only static UI' });
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${row.port}`);
    if (url.pathname === '/__show_tools/ui') return json(response, 200, { registration: row, build: active.build, managerPid: owner.pid });
    let path = decodeURIComponent(url.pathname);
    if (path.includes('\\') || path.includes('\0') || path.split('/').includes('..')) return json(response, 400, { error: 'Invalid asset path' });
    let build = active.build;
    const pinned = /^\/__build\/([a-f0-9]{64})(\/.*)$/.exec(path);
    if (pinned) {
      if (!row.history.includes(pinned[1])) return json(response, 404, { error: 'Build does not belong to this preview' });
      build = await snapshot(pinned[1]); path = pinned[2];
    }
    const requestedCache = url.searchParams.get('__show_tools_build');
    if (requestedCache) {
      if (!/^[a-f0-9]{64}$/.test(requestedCache)) return json(response, 400, { error: 'Invalid build identity' });
      if (pinned && build.cacheId !== requestedCache) return json(response, 409, { error: 'Build identities conflict' });
      if (!pinned) {
        let matching: Snapshot | undefined;
        for (const candidate of row.history) { const saved = await snapshot(candidate); if (saved.cacheId === requestedCache) { matching = saved; break; } }
        if (!matching) return json(response, 404, { error: 'Requested build is unavailable' });
        build = matching;
      }
    }
    if (!pinned && !requestedCache && ['/', '/ui/practice', '/ui/practice/', '/ui/practice/index.html'].includes(path)) {
      response.writeHead(302, { location: `/__build/${build.id}/ui/practice/${url.search}`, 'cache-control': 'no-store' }); response.end(); return;
    }
    if (path.endsWith('/')) path += 'index.html';
    const root = join(config.stateRoot, 'snapshots', build.id, 'files');
    let file: string;
    try {
      file = await realpath(resolve(root, '.' + path));
      if (!file.startsWith(await realpath(root) + sep) || !(await stat(file)).isFile()) throw new Error('Not an asset');
    } catch { return json(response, 404, { error: 'Asset not found' }); }
    response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream',
      'cache-control': pinned ? 'public, max-age=31536000, immutable' : 'no-store',
      ...(path.endsWith('/sw.js') ? { 'service-worker-allowed': pinned ? `/__build/${build.id}/ui/practice/` : '/ui/practice/' } : {}) });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).on('error', () => response.destroy()).pipe(response);
  }
  async function open(row: Registration, build: Snapshot) {
    const server = createServer((request, response) => { void requestAsset(row.id, request, response).catch(error => {
      if (response.headersSent) response.destroy(); else json(response, 500, { error: message(error) });
    }); });
    try { await listen(server, row.port); }
    catch (error) { await close(server); throw new Error(`UI port ${row.port} cannot be claimed. Its existing owner was left untouched. ${message(error)}`); }
    running.set(row.id, { server, build }); blocked.delete(row.id);
  }
  async function serve(request: Extract<Request, { command: 'serve' }>) {
    const target = request.target;
    if (target.kind === 'preview') {
      if (await realpath(target.worktree) !== target.worktree || await repository(target.worktree) !== config.repository || await worktreeKey(target.worktree) !== target.worktreeKey) throw new Error('Preview must identify a real worktree in this repository');
    }
    const build = await loadSnapshot(config.stateRoot, request.snapshot);
    snapshots.set(build.id, build);
    if (target.kind === 'live') {
      if (build.source.dirty) throw new Error('Live publication requires a clean committed build');
      await git(config.repository, 'merge-base', '--is-ancestor', build.source.revision, 'refs/remotes/origin/main');
    }
    const id = identity(target);
    let row = registration(id);
    if (!row) {
      const used = new Set(registry.registrations.map(item => item.port));
      let port = config.livePort;
      if (target.kind === 'preview') {
        const length = config.previewLast - config.previewFirst + 1;
        const start = parseInt(id.slice(0, 8), 16) % length;
        port = 0;
        for (let offset = 0; offset < length; ++offset) {
          const candidate = config.previewFirst + (start + offset) % length;
          if (candidate !== config.livePort && !used.has(candidate)) { port = candidate; break; }
        }
        if (!port) throw new Error('All preview origins are reserved; no existing origin was recycled');
      }
      if (used.has(port)) throw new Error('Live origin conflicts with a saved preview reservation');
      row = { id, target, port, current: null, history: [], enabled: false };
      await save(row);
    }
    const next: Registration = { ...row, current: build.id, history: [...new Set([...row.history, build.id])], enabled: true };
    const active = running.get(id);
    if (!active) {
      try { await open(next, build); }
      catch (error) { blocked.set(id, message(error)); throw error; }
    }
    try { await save(next); }
    catch (error) { if (!active) { const opened = running.get(id); running.delete(id); if (opened) await close(opened.server); } throw error; }
    const listener = running.get(id);
    if (!listener) throw new Error('UI listener disappeared');
    running.set(id, { server: listener.server, build });
    blocked.delete(id);
  }
  let tail: Promise<unknown> = Promise.resolve();
  let shuttingDown = false;
  const control = createServer((request, response) => {
    const action = async () => {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length; if (bytes > 16384) throw new Error('UI command is oversized'); chunks.push(Buffer.from(chunk));
      }
      const input = decode(RequestSchema, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (input.command === 'serve') await serve(input);
      if (input.command === 'stop') {
        const row = registration(input.id);
        if (!row) throw new Error('No registered UI with this identity');
        const active = running.get(row.id); if (active) await close(active.server);
        running.delete(row.id); blocked.delete(row.id); await save({ ...row, enabled: false });
      }
      json(response, 200, { ok: true, owner, statuses: rows() });
      if (input.command === 'shutdown') { shuttingDown = true; setImmediate(() => { void dispose(); }); }
    };
    if (shuttingDown) { json(response, 503, { ok: false, error: 'UI manager is stopping' }); return; }
    const result = tail.then(action, action);
    tail = result.catch(() => {});
    void result.catch(error => {
      if (response.headersSent || response.destroyed) response.destroy();
      else json(response, 400, { ok: false, error: message(error) });
    });
  });
  async function dispose() {
    for (const { server } of running.values()) await close(server);
    running.clear(); await close(control);
  }
  await listen(control, join(config.controlDirectory, 'control.sock'));
  await chmod(join(config.controlDirectory, 'control.sock'), 0o600);
  for (const row of registry.registrations) if (row.enabled && row.current) {
    try { await open(row, await snapshot(row.current)); }
    catch (error) { blocked.set(row.id, message(error)); }
  }
  return { statuses: rows, dispose, control };
}
