import { spawn } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chartSettings } from './chart-settings.js';

export function chromiumCommand(env: NodeJS.ProcessEnv = process.env) {
  const settings = chartSettings(env);
  if (!settings.chromiumApp) throw new Error('No Chromium browser found. Set SHOW_TOOLS_CHROMIUM_APP in .envrc, then run direnv allow.');
  const app = settings.chromiumApp.replace(/\/+$/, '');
  const executable = app.endsWith('.app') ? join(app, 'Contents', 'MacOS', basename(app, '.app')) : app;
  const profile = resolve(settings.profile);
  return { executable, profile, args: [`--remote-debugging-port=${settings.cdpPort}`, '--remote-debugging-address=127.0.0.1',
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check'] };
}

export async function spawnCDP(env: NodeJS.ProcessEnv = process.env) {
  const command = chromiumCommand(env);
  await mkdir(command.profile, { recursive: true });
  const child = spawn(command.executable, command.args, { stdio: 'inherit' });
  const exited = new Promise<Error>(done => {
    child.once('error', done);
    child.once('exit', (code, signal) => done(new Error(`Chromium exited with ${signal || code}.`)));
  });
  return { child, exited };
}

export async function startCDP(env: NodeJS.ProcessEnv = process.env) {
  const { child, exited } = await spawnCDP(env);
  const interrupt = () => { child.kill('SIGINT'); };
  const terminate = () => { child.kill('SIGTERM'); };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const error = await exited;
    if (child.exitCode !== 0 && child.signalCode !== 'SIGINT' && child.signalCode !== 'SIGTERM') throw error;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await startCDP(); }
  catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
}
