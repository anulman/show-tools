import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { runPeripheralBridge } from '../bridge.js';
import { PF as LIGHT } from '../../performance/light-abi.js';
import { PersistentDesk } from '../../remote-performance/controller.js';
import { createGateway } from '../../remote-performance/gateway.js';
import type { DeskController, DeskPublication } from '../../remote-performance/session-schema.js';
import { installedPackage, sessionProfile, until } from '../../remote-performance/tests/session-fixture.js';

const level = (image: readonly number[]) => image[LIGHT.LIGHT_SAMPLES + LIGHT.LIGHT_SAMPLE_LEVEL];

const attachments: readonly { playing: boolean; buttonKey?: 'tab' | 'escape'; disabled?: boolean; gap?: boolean }[] = [
  { playing: false }, { playing: false, buttonKey: 'tab' }, { playing: true, buttonKey: 'escape' },
  { playing: true, buttonKey: 'escape', disabled: true }, { playing: true, buttonKey: 'escape', disabled: true, gap: true },
];
for (const { playing, buttonKey, disabled = false, gap = false } of attachments) test(`a real gateway attaches ${playing ? 'during playback' : 'while stopped'} with ${buttonKey ?? 'default'} key${disabled ? ' and musical knob disabled' : ''} and ${gap ? 'publication gap' : 'abort'} clears native held state and helper output`, { timeout: 20000 }, async () => {
  await stat(resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host'));
  const directory = await mkdtemp(join(tmpdir(), 'pb-'));
  const tokenFile = join(directory, 'token');
  const helper = join(directory, 'helper');
  const log = join(directory, 'helper-log');
  const token = '012345678901234567890123456789ab';
  await writeFile(tokenFile, token, { mode: 0o600 });
  await writeFile(helper, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const log = ${JSON.stringify(log)};
const record = value => fs.appendFileSync(log, JSON.stringify(value) + String.fromCharCode(10));
const session = Number(process.argv[2]);
record({ type: 'ready', args: process.argv.slice(3) });
process.stdout.write(JSON.stringify({ type: 'ready', version: 1, session, released: true }) + String.fromCharCode(10));
process.stdout.write(JSON.stringify({ type: 'motion', session, sequence: 1, deltaY: 8 }) + String.fromCharCode(10));
process.stdout.write(JSON.stringify({ type: 'motion', session, sequence: 2, deltaY: -5 }) + String.fromCharCode(10));
process.stdout.write(JSON.stringify({ type: 'button', session, sequence: 3, down: true }) + String.fromCharCode(10));
readline.createInterface({ input: process.stdin }).on('line', line => {
  record({ type: 'command', line });
  if (line === 'quit') process.exit(0);
});
process.on('exit', code => record({ type: 'exit', code }));
`);
  await chmod(helper, 0o700);
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage().installed);
  const abort = new AbortController();
  const commands: unknown[] = [];
  let lifecycleChanges = 0;
  let publish: ((publication: DeskPublication) => void) | undefined;
  const forwarded: DeskController = {
    snapshot: () => controller.snapshot(),
    subscribe: listener => { publish = listener; return controller.subscribe(listener); },
    command: (target, input) => { commands.push(input); return controller.command(target, input); },
    setAudio: goal => { lifecycleChanges++; return controller.setAudio(goal); },
    close: () => controller.close(),
  };
  let server: ReturnType<typeof createGateway> | undefined;
  let running: Promise<void> | undefined;
  const records = async (): Promise<{ type: string; line?: string; code?: number; args?: string[] }[]> =>
    (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  try {
    controller.setAudio('on');
    const initial = await until(() => {
      const audio = controller.snapshot().audio;
      if (audio.kind === 'fault') throw new Error(audio.error);
      return audio.kind === 'ready' ? audio : undefined;
    });
    if (playing) {
      const outcome = await controller.command({ attempt: initial.attempt, hostEpoch: initial.performance.hostEpoch },
        { command: 'start', args: { bpm: 120, countInBars: 0, startBar: 1, endBar: 4, loop: true } });
      assert.equal(outcome.outcome, 'applied');
    }
    const beforeBridge = controller.snapshot().audio;
    assert.equal(beforeBridge.kind, 'ready');
    if (beforeBridge.kind !== 'ready') throw new Error('Missing native session');
    const gatewayConfig = { host: '127.0.0.1', port: 0, origin: 'http://127.0.0.1', token: Buffer.from(token), staticRoot: directory };
    server = createGateway(gatewayConfig, forwarded);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    gatewayConfig.origin = base;
    running = runPeripheralBridge({ version: 1, origin: base, tokenFile, helperExecutable: helper,
      sdkChannel: 0, bindingRevision: 1, ...(buttonKey ? { buttonKey } : {}), jiggle: disabled ? null : { minimumTravel: 4, minimumReversal: 2 } }, abort.signal);
    let bridgeFailure: unknown;
    const settled = running.then(() => ({ ok: true }), error => { bridgeFailure = error; return { ok: false, error }; });
    await until(() => {
      if (bridgeFailure) throw bridgeFailure;
      const audio = controller.snapshot().audio;
      return audio.kind === 'ready' && level(audio.performance.lights) === 1 ? true : undefined;
    }, 'helper press did not reach the native held LED state');
    let helperSawFull = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      helperSawFull = (await records()).some(entry => entry.line?.startsWith('light ')
        && level(entry.line.split(' ').slice(5).map(Number)) === 1);
      if (helperSawFull) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(helperSawFull, true, 'the helper receives the engine-authored full brightness image');
    const expected = [
      ...(!disabled ? [{ command: 'configureJiggle', args: { minimumTravel: 4, minimumReversal: 2 } }] : []),
      { command: 'control', args: { control: { id: 'cueButton', value: 0 } } },
      ...(!disabled ? [{ command: 'control', args: { control: { id: 'knob', value: 8 } } }, { command: 'control', args: { control: { id: 'knob', value: -5 } } }] : []),
      { command: 'control', args: { control: { id: 'cueButton', value: 1 } } },
    ];
    assert.deepEqual(commands, expected, 'disabled motion sends neither jiggle configuration nor knob commands; object configuration retains ordered motion');
    const firstRecord = (await records())[0];
    assert.equal(firstRecord.type, 'ready');
    assert.deepEqual(firstRecord.args, ['0', '--confirm-wiring', ...(buttonKey ? ['--button-key', buttonKey] : [])], 'omitted key preserves helper argv; explicit key uses the reviewed trailing flag');
    if (gap) {
      for (let count = 0; count < 100 && (await records()).filter(entry => entry.line?.startsWith('light ')).length < 2; count++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok((await records()).filter(entry => entry.line?.startsWith('light ')).length >= 2, 'event stream attached before gap');
      publish?.({ type: 'gap' });
    } else abort.abort();
    const result = await settled;
    if (gap) { assert.equal(result.ok, false); if ('error' in result) assert.match(String(result.error), /publication gap/); }
    else assert.deepEqual(result, { ok: true });
    const final = controller.snapshot().audio;
    assert.equal(final.kind, 'ready');
    if (final.kind !== 'ready') throw new Error('Bridge interrupted native audio');
    assert.equal(final.attempt, initial.attempt);
    assert.equal(final.performance.state.runId, beforeBridge.performance.state.runId);
    assert.equal(final.performance.state.phase, playing ? 'playing' : 'idle');
    assert.equal(level(final.performance.lights), 0, 'fresh cleanup request releases native held state after the main signal aborts');
    assert.equal(lifecycleChanges, 0, 'attaching and aborting never change the audio lifecycle');
    assert.equal(commands.length, expected.length + 1);
    assert.deepEqual(commands.at(-1), { command: 'control', args: { control: { id: 'cueButton', value: 0 } } });
    const history = await records();
    assert.ok(history.some(entry => entry.line === 'clear'));
    assert.ok(history.some(entry => entry.line === 'quit'));
    assert.deepEqual(history.at(-1), { type: 'exit', code: 0 });
  } finally {
    abort.abort();
    await running?.catch(() => {});
    server?.closeAllConnections();
    if (server?.listening) await new Promise<void>(resolve => server?.close(() => resolve()));
    await controller.close();
    await rm(directory, { recursive: true, force: true });
  }
});
