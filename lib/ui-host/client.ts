import { build } from 'esbuild';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { link, mkdir, open, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode, ConfigSchema, OwnerSchema, RegistrySchema, ResponseSchema, type Config, type Request, type Response } from './model.js';
import { repository } from './snapshot.js';

export async function configuration(worktree: string, env = process.env): Promise<Config> {
  const common = await repository(worktree);
  const key = createHash('sha256').update(common).digest('hex').slice(0, 16);
  const stateBase = env.SHOW_TOOLS_UI_STATE ?? join(env.XDG_STATE_HOME && isAbsolute(env.XDG_STATE_HOME) ? env.XDG_STATE_HOME : join(homedir(), '.local/state'), 'show-tools/ui');
  if (!isAbsolute(stateBase)) throw new Error('SHOW_TOOLS_UI_STATE must be an absolute directory');
  const stateRoot = join(stateBase, key);
  const controlKey = createHash('sha256').update(stateRoot).digest('hex').slice(0, 16);
  return decode(ConfigSchema, { version: 1, repository: common, stateRoot,
    controlDirectory: `/tmp/show-tools-ui-${process.getuid?.() ?? 'user'}-${controlKey}`,
    livePort: Number(env.SHOW_TOOLS_UI_LIVE_PORT ?? 8084), previewFirst: Number(env.SHOW_TOOLS_UI_PREVIEW_FIRST ?? 20000),
    previewLast: Number(env.SHOW_TOOLS_UI_PREVIEW_LAST ?? 29999) });
}
async function privateDirectory(path: string) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await stat(path);
  if (!info.isDirectory() || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error(`UI state directory must be caller-owned and private: ${path}`);
}
export function call(config: Config, input: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(input);
    const req = request({ socketPath: join(config.controlDirectory, 'control.sock'), path: '/', method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } }, response => {
      const chunks: Buffer[] = []; let bytes = 0;
      response.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 2 * 1024 * 1024) response.destroy(new Error('UI manager response is oversized'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve(decode(ResponseSchema, JSON.parse(Buffer.concat(chunks).toString('utf8')))); }
        catch (error) { reject(error); }
      });
    });
    const timeout = setTimeout(() => req.destroy(new Error('UI manager response timed out')), 15000);
    req.once('close', () => clearTimeout(timeout)); req.on('error', reject); req.end(data);
  });
}
function absent(error: unknown) {
  return error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ECONNREFUSED');
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ESRCH') return false; throw error; }
}
export async function ensureManager(config: Config) {
  await privateDirectory(config.stateRoot); await privateDirectory(config.controlDirectory);
  if (config.previewFirst > config.previewLast) throw new Error('Preview port range is reversed');
  const configPath = join(config.stateRoot, 'manager-config.json');
  try {
    const old = decode(ConfigSchema, JSON.parse(await readFile(configPath, 'utf8')));
    if (JSON.stringify(old) !== JSON.stringify(config)) throw new Error('UI manager configuration changed; preserve its saved origin assignments and use the existing configuration');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const temporary = configPath + '.' + randomUUID();
    try {
      await writeFile(temporary, JSON.stringify(config), { flag: 'wx', mode: 0o600 });
      try { await link(temporary, configPath); }
      catch (cause) { if (!(cause instanceof Error && 'code' in cause && cause.code === 'EEXIST')) throw cause; }
      if (JSON.stringify(decode(ConfigSchema, JSON.parse(await readFile(configPath, 'utf8')))) !== JSON.stringify(config)) throw new Error('Concurrent UI configuration conflicts');
    } finally { await rm(temporary, { force: true }); }
  }
  const ownerPath = join(config.controlDirectory, 'owner.json');
  const check = async () => {
    const result = await call(config, { command: 'status' });
    if (!result.ok) throw new Error(result.error);
    const owner = decode(OwnerSchema, JSON.parse(await readFile(ownerPath, 'utf8')));
    if (owner.nonce !== result.owner.nonce || owner.pid !== result.owner.pid) throw new Error(`UI manager ownership does not match its private record (record PID ${owner.pid}, response PID ${result.owner.pid}, nonce ${owner.nonce === result.owner.nonce ? 'matches' : 'differs'})`);
    return result;
  };
  try { return await check(); } catch (error) { if (!absent(error)) throw error; }
  const lock = join(config.controlDirectory, 'starting');
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      await writeFile(join(lock, 'owner.json'), JSON.stringify({ version: 1, nonce: randomUUID(), pid: process.pid }), { mode: 0o600 });
      break;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
      try { return await check(); } catch (cause) { if (!absent(cause)) throw cause; }
      let locked;
      try { locked = decode(OwnerSchema, JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'))); }
      catch {
        if (Date.now() >= deadline) throw new Error('UI startup ownership is incomplete; its lock was left untouched.');
        await new Promise(resolve => setTimeout(resolve, 50)); continue;
      }
      if (!alive(locked.pid)) {
        const retired = join(config.controlDirectory, 'retired-start-' + createHash('sha256').update(JSON.stringify(locked)).digest('hex'));
        try { await rename(lock, retired); }
        catch (cause) {
          if (!(cause instanceof Error && 'code' in cause && ['ENOENT', 'EEXIST', 'ENOTEMPTY'].includes(String(cause.code)))) throw cause;
        }
        continue;
      }
      if (Date.now() >= deadline) throw new Error('The existing UI manager owner has not become ready; it was left untouched');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  const owner = { version: 1, nonce: randomUUID(), pid: process.pid };
  let child: ReturnType<typeof spawn> | undefined;
  try {
    try { return await check(); } catch (error) { if (!absent(error)) throw error; }
    try {
      const previous = decode(OwnerSchema, JSON.parse(await readFile(ownerPath, 'utf8')));
      if (alive(previous.pid)) throw new Error('A live UI manager owns an unavailable socket; it was left untouched');
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    await rm(join(config.controlDirectory, 'control.sock'), { force: true });
    const bundle = await build({ entryPoints: [fileURLToPath(new URL('./daemon.ts', import.meta.url))], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false,
      banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' } });
    if (bundle.outputFiles.length !== 1) throw new Error('UI manager bundle has unexpected outputs');
    const code = bundle.outputFiles[0].contents;
    const daemon = join(config.stateRoot, `manager-${createHash('sha256').update(code).digest('hex')}.mjs`);
    try { await writeFile(daemon, code, { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
    const log = await open(join(config.stateRoot, 'manager.log'), 'a', 0o600);
    try { child = spawn(process.execPath, [daemon, configPath, owner.nonce], { detached: true, stdio: ['ignore', log.fd, log.fd] }); }
    finally { await log.close(); }
    if (!child.pid) throw new Error('UI manager did not start');
    child.on('error', () => {}); child.unref();
    owner.pid = child.pid;
    const ownerTemporary = ownerPath + '.' + randomUUID();
    await writeFile(ownerTemporary, JSON.stringify(owner), { mode: 0o600 });
    await rename(ownerTemporary, ownerPath);
    await writeFile(join(lock, 'owner.json'), JSON.stringify(owner), { mode: 0o600 });
    const readyDeadline = Date.now() + 20000;
    for (;;) {
      try { return await check(); } catch (error) { if (!absent(error)) throw error; }
      if (child.exitCode !== null || !alive(owner.pid)) throw new Error('UI manager exited before readiness; inspect its manager.log');
      if (Date.now() >= readyDeadline) throw new Error('UI manager readiness timed out; its owned process was left recorded for inspection');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  } catch (error) {
    if (child?.pid && child.exitCode === null) child.kill('SIGTERM');
    throw error;
  } finally { await rm(lock, { recursive: true, force: true }); }
}
export async function savedStatus(config: Config): Promise<import('./model.js').Response | { ok: true; owner: null; statuses: readonly import('./model.js').Status[] }> {
  try { return await call(config, { command: 'status' }); }
  catch (error) {
    if (!absent(error)) throw error;
    try {
      const owner = decode(OwnerSchema, JSON.parse(await readFile(join(config.controlDirectory, 'owner.json'), 'utf8')));
      if (alive(owner.pid)) throw new Error('Recorded UI manager is alive but unavailable; its listeners were left untouched.');
    } catch (cause) { if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause; }
    try {
      const registry = decode(RegistrySchema, JSON.parse(await readFile(join(config.stateRoot, 'registry.json'), 'utf8')));
      return { ok: true, owner: null, statuses: registry.registrations.map(registration => ({ registration, runtime: { kind: 'stopped' } })) };
    } catch (cause) { if (!(cause instanceof Error && 'code' in cause && cause.code === 'ENOENT')) throw cause; return { ok: true, owner: null, statuses: [] }; }
  }
}
