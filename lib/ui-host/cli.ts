import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, realpath, rm, symlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { call, configuration, ensureManager, savedStatus } from './client.js';
import { identity } from './broker.js';
import { git, importBuild, worktreeKey } from './snapshot.js';
import { decode, TargetSchema, type Config, type Status } from './model.js';

const execute = promisify(execFile);
const HELP = `Usage: show-tools ui preview [--session NAME] [--build]
       show-tools ui live [--publish REVISION]
       show-tools ui status [--json]
       show-tools ui stop [--session NAME | --live | --id ID]
       show-tools ui shutdown
       show-tools ui gc

Preview origins belong permanently to a worktree and session (default: worktree).
Live stays at http://127.0.0.1:8084/. Publishing builds a clean merged revision
in isolation. Existing pages keep their pinned build; reopen the stable URL to
use the published build. Stop/shutdown only affect this manager's static servers.
`;
async function run(command: string, args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`${command} failed (${signal ?? code})`)));
  });
}
async function publish(config: Config, worktree: string, revision: string) {
  const resolved = await git(worktree, 'rev-parse', '--verify', `${revision}^{commit}`);
  await git(worktree, 'merge-base', '--is-ancestor', resolved, 'refs/remotes/origin/main');
  const temporary = join(config.stateRoot, 'builds', randomUUID());
  await mkdir(dirname(temporary), { recursive: true, mode: 0o700 });
  await execute('git', ['-C', worktree, 'worktree', 'add', '--detach', temporary, resolved]);
  try {
    if (!Buffer.from(await readFile(join(worktree, 'package-lock.json'))).equals(await readFile(join(temporary, 'package-lock.json')))) {
      throw new Error('Publication dependencies differ from this checkout. Run the manager from the target revision after installing its dependencies.');
    }
    await symlink(await realpath(join(worktree, 'node_modules')), join(temporary, 'node_modules'), 'dir');
    await run('npm', ['run', 'build'], temporary);
    return await importBuild(join(temporary, 'dist'), config.stateRoot);
  } finally {
    await execute('git', ['-C', worktree, 'worktree', 'remove', '--force', temporary]);
  }
}
function print(statuses: readonly Status[]) {
  for (const { registration: row, runtime } of statuses) {
    const label = row.target.kind === 'live' ? 'live' : `${row.target.worktree} [${row.target.session}]`;
    console.log(`${runtime.kind.padEnd(7)} http://127.0.0.1:${row.port}/  ${label}`);
    console.log(`  id ${row.id}`);
    if (runtime.kind === 'serving') console.log(`  revision ${runtime.build.source.revision}${runtime.build.source.dirty ? ' (dirty)' : ''}  cache ${runtime.build.cacheId}\n  snapshot ${runtime.build.id}`);
    if (runtime.kind === 'blocked') console.log(`  ${runtime.error}`);
  }
  if (!statuses.length) console.log('No managed UI origins have been reserved.');
}
export async function runUiCli(args: readonly string[], directory = process.cwd()) {
  if (!args.length || args.includes('--help') || args.includes('-h')) { console.log(HELP); return; }
  const [command, ...options] = args;
  const values = new Map<string, string>(); const flags = new Set<string>();
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (['--session', '--id', '--publish'].includes(option)) {
      const value = options[++index];
      if (!value || value.startsWith('--') || values.has(option)) throw new Error(`Expected one value for ${option}`);
      values.set(option, value);
    } else if (['--build', '--live', '--json'].includes(option) && !flags.has(option)) flags.add(option);
    else throw new Error(`Unknown or duplicate UI option: ${option}`);
  }
  const allowed: Record<string, readonly string[]> = { preview: ['--session', '--build'], live: ['--publish'], status: ['--json'], stop: ['--session', '--live', '--id'], shutdown: [], gc: [] };
  if (!Object.hasOwn(allowed, command) || [...values.keys(), ...flags].some(option => !allowed[command].includes(option))) throw new Error('Invalid UI command options. Run show-tools ui --help.');
  const worktree = await realpath(await git(directory, 'rev-parse', '--show-toplevel'));
  const config = await configuration(worktree);
  if (command === 'status') {
    const result = await savedStatus(config);
    if (!result.ok) throw new Error(result.error);
    if (flags.has('--json')) console.log(JSON.stringify(result, null, 2)); else print(result.statuses);
    return;
  }
  if (command === 'gc') {
    // Origins and immutable releases retain browser-storage ownership and pinned tabs.
    const result = await savedStatus(config);
    if (!result.ok) throw new Error(result.error);
    console.log('No origins or releases deleted. Stopped origins remain reserved; pinned releases remain available.');
    return;
  }
  await ensureManager(config);
  let request;
  if (command === 'preview') {
    const target = decode(TargetSchema, { kind: 'preview', worktree, worktreeKey: await worktreeKey(worktree), session: values.get('--session') ?? 'worktree' });
    if (flags.has('--build')) await run('npm', ['run', 'build:ui'], worktree);
    const snapshot = await importBuild(join(worktree, 'dist'), config.stateRoot).catch(error => {
      throw new Error(`No verified preview build available. Run npm run build, or use --build when WASM is already built. ${error instanceof Error ? error.message : error}`);
    });
    request = { command: 'serve', target, snapshot: snapshot.id } satisfies import('./model.js').Request;
  } else if (command === 'live') {
    const revision = values.get('--publish');
    if (revision) {
      const snapshot = await publish(config, worktree, revision);
      request = { command: 'serve', target: { kind: 'live' }, snapshot: snapshot.id } satisfies import('./model.js').Request;
    } else {
      const result = await call(config, { command: 'status' });
      if (!result.ok) throw new Error(result.error);
      const live = result.statuses.find(item => item.registration.target.kind === 'live');
      if (!live?.registration.current) throw new Error('No live build published. After merge run show-tools ui live --publish origin/main.');
      request = { command: 'serve', target: { kind: 'live' }, snapshot: live.registration.current } satisfies import('./model.js').Request;
    }
  } else if (command === 'stop') {
    if ([values.has('--id'), values.has('--session'), flags.has('--live')].filter(Boolean).length > 1) throw new Error('Choose one UI to stop.');
    const target = flags.has('--live') ? decode(TargetSchema, { kind: 'live' }) : decode(TargetSchema, { kind: 'preview', worktree, worktreeKey: await worktreeKey(worktree), session: values.get('--session') ?? 'worktree' });
    request = { command: 'stop', id: values.get('--id') ?? identity(target) } satisfies import('./model.js').Request;
  } else request = { command: 'shutdown' } satisfies import('./model.js').Request;
  const result = await call(config, request);
  if (!result.ok) throw new Error(result.error);
  if (command === 'shutdown') console.log('Managed static UI servers stopped. Origin reservations and builds retained.');
  else print(result.statuses);
}
