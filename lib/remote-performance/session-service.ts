import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { NodeServices } from '@effect/platform-node';
import { Effect, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import type { SessionProfile } from './session-profile.js';

export interface ProcessResult { readonly code: number; readonly stdout: string }
export type Execute = (executable: string, args: readonly string[]) => Promise<ProcessResult>;

export const execute: Execute = async (executable, args) => Effect.runPromise(Effect.gen(function*() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(executable, [...args], { stderr: 'ignore' }));
  const stdout = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
  const code = yield* child.exitCode;
  return { code, stdout };
}).pipe(Effect.scoped, Effect.timeout('20 seconds'), Effect.provide(NodeServices.layer)));

function unitArgument(value: string) {
  if (!value.startsWith('/') || /[\x00-\x1f\x7f]/.test(value)) throw new Error('Service paths must be absolute and contain no control characters.');
  return '"' + value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%').replaceAll('$', () => '$$') + '"';
}

export function renderSessionUnit(profile: SessionProfile, profilePath: string) {
  const retryLimit = profile.restartPolicy === 'on-failure' ? 'StartLimitIntervalSec=0\n' : '';
  const retryDelay = profile.restartPolicy === 'on-failure' ? 'RestartSec=3s\n' : '';
  return `# Managed by show-tools session install. Do not edit this unit.\n[Unit]\nDescription=Show Tools performance desk\n${retryLimit}\n[Service]\nType=exec\nExecStart=${unitArgument(profile.server.nodeExecutable)} ${unitArgument(profile.server.entrypoint)} --profile ${unitArgument(resolve(profilePath))}\nRestart=${profile.restartPolicy}\n${retryDelay}KillMode=control-group\nTimeoutStopSec=15s\nSendSIGKILL=yes\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`;
}

export function sessionConfigDirectory(env: NodeJS.ProcessEnv = process.env) {
  return env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME) ? env.XDG_CONFIG_HOME : join(homedir(), '.config');
}

export function createSessionService(profile: SessionProfile, profilePath: string, {
  run = execute, configDirectory = sessionConfigDirectory(),
}: { run?: Execute; configDirectory?: string } = {}) {
  const unitPath = join(configDirectory, 'systemd', 'user', profile.serviceName);
  const expected = renderSessionUnit(profile, profilePath);
  const systemctl = async (...args: string[]) => run('systemctl', ['--user', ...args]);
  async function checked(...args: string[]) {
    const result = await systemctl(...args);
    if (result.code !== 0) throw new Error(`systemctl --user ${args[0]} failed for ${profile.serviceName}. Check the user manager and journalctl --user -u ${profile.serviceName}.`);
    return result.stdout;
  }
  async function properties() {
    const output = await checked('show', profile.serviceName, '--property=LoadState,ActiveState,SubState,MainPID,FragmentPath,DropInPaths,TasksCurrent');
    return new Map(output.trim().split('\n').map(line => {
      const split = line.indexOf('=');
      return [line.slice(0, split), line.slice(split + 1)];
    }));
  }
  async function verifyInstalled() {
    let actual: string;
    try { actual = await readFile(unitPath, 'utf8'); }
    catch { throw new Error(`No managed user unit at ${unitPath}. Run show-tools session install --profile ${profilePath}.`); }
    if (actual !== expected) throw new Error('Installed user unit differs from this profile. Review its content and profile paths before a separate explicit upgrade.');
    const state = await properties();
    if (state.get('FragmentPath') !== unitPath || state.get('DropInPaths')) throw new Error('The loaded service has a foreign unit path or drop-ins. Review it before session control.');
    return state;
  }
  return {
    install: async (enable: boolean) => {
      await mkdir(dirname(unitPath), { recursive: true, mode: 0o700 });
      try { await writeFile(unitPath, expected, { flag: 'wx', mode: 0o600 }); }
      catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error;
        if (await readFile(unitPath, 'utf8') !== expected) throw new Error('Refusing to overwrite an existing different user unit. Review it before an explicit upgrade.');
      }
      await checked('daemon-reload');
      await verifyInstalled();
      if (enable) await checked('enable', profile.serviceName);
      return unitPath;
    },
    state: properties,
    start: async (signal?: AbortSignal) => {
      signal?.throwIfAborted();
      await verifyInstalled();
      signal?.throwIfAborted();
      await checked('start', profile.serviceName);
      signal?.throwIfAborted();
    },
    stop: async () => {
      await verifyInstalled();
      await checked('stop', profile.serviceName);
      const state = await properties();
      if (state.get('ActiveState') !== 'inactive' || state.get('MainPID') !== '0' || !['0', '[not set]', ''].includes(state.get('TasksCurrent') ?? '')) {
        throw new Error('Service stop did not verify an inactive, empty process group. Check the named user service before restarting.');
      }
    },
    linger: async () => {
      try {
        const result = await run('loginctl', ['show-user', String(process.getuid?.() ?? ''), '--property=Linger', '--value']);
        return result.code === 0 && ['yes', 'no'].includes(result.stdout.trim()) ? result.stdout.trim() : 'unknown';
      } catch { return 'unknown'; }
    },
  };
}
