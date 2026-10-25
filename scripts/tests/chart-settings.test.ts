import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { chartSettings } from '../chart-settings.js';
import { chromiumCommand, startCDP } from '../start-cdp.js';

test('the Chromium launcher and Sheets helper share the configured CDP port', () => {
  const env = { SHOW_TOOLS_CHROMIUM_APP: '/Applications/Chromium.app', SHOW_TOOLS_CDP_PORT: '9333', SHOW_TOOLS_CDP_PROFILE: '/tmp/chart profile', SHOW_TOOLS_PRACTICE_ORIGIN: 'https://practice.example/' };
  const command = chromiumCommand(env);
  assert.equal(command.executable, '/Applications/Chromium.app/Contents/MacOS/Chromium');
  assert(command.args.includes('--remote-debugging-port=9333'));
  assert(command.args.includes('--remote-debugging-address=127.0.0.1'));
  assert(command.args.includes('--user-data-dir=/tmp/chart profile'));
  assert.equal(chartSettings(env).cdp, 'http://127.0.0.1:9333');
  assert.equal(chartSettings(env).practiceOrigin, 'https://practice.example');
  assert.equal(chromiumCommand({ SHOW_TOOLS_CHROMIUM_APP: '/usr/bin/chromium' }).executable, '/usr/bin/chromium');
});

test('invalid launcher settings fail before a browser is started', () => {
  assert.throws(() => chromiumCommand({}), /SHOW_TOOLS_CHROMIUM_APP/);
  for (const port of ['0', '65536', '9222.5', '9222junk', '']) assert.throws(() => chartSettings({ SHOW_TOOLS_CDP_PORT: port }));
  for (const origin of ['file:///tmp/app', 'https://example.test/path', 'https://user:password@example.test', 'https://example.test?token=x']) {
    assert.throws(() => chartSettings({ SHOW_TOOLS_PRACTICE_ORIGIN: origin }));
  }
  assert.equal(chartSettings({}).cdp, 'http://127.0.0.1:9222');
});

test('the launcher passes literal arguments to an executable and releases signal handlers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-launcher-'));
  const executable = join(directory, 'fake chromium.mjs'), output = join(directory, 'arguments.json');
  const interrupts = process.listenerCount('SIGINT'), terminations = process.listenerCount('SIGTERM');
  try {
    await writeFile(executable, `#!${process.execPath}\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
    await promisify(execFile)('/bin/bash', ['scripts/start-cdp.sh'], { env: { ...process.env, SHOW_TOOLS_CHROMIUM_APP: executable, SHOW_TOOLS_CDP_PORT: '9334', SHOW_TOOLS_CDP_PROFILE: join(directory, 'profile with spaces') } });
    const args: unknown = JSON.parse(await readFile(output, 'utf8'));
    assert.deepEqual(args, ['--remote-debugging-port=9334', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${join(directory, 'profile with spaces')}`, '--no-first-run', '--no-default-browser-check']);
    await writeFile(executable, `#!${process.execPath}\nprocess.exit(7);\n`, { mode: 0o755 });
    await assert.rejects(startCDP({ SHOW_TOOLS_CHROMIUM_APP: executable, SHOW_TOOLS_CDP_PROFILE: join(directory, 'profile') }), /exited with 7/);
    assert.equal(process.listenerCount('SIGINT'), interrupts);
    assert.equal(process.listenerCount('SIGTERM'), terminations);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
