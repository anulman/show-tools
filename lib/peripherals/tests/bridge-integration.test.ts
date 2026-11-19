import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { decodePeripheralInputMap, peripheralHelperArgs, PeripheralRetry, runPeripheralBridge } from '../bridge.js';
import { PF as LIGHT } from '../../performance/light-abi.js';
import { PersistentDesk } from '../../remote-performance/controller.js';
import { createGateway } from '../../remote-performance/gateway.js';
import type { DeskController, DeskPublication } from '../../remote-performance/session-schema.js';
import { installedPackage, sessionProfile, until } from '../../remote-performance/tests/session-fixture.js';

const level = (image: readonly number[]) => {
  for (let index = 0; index < image[LIGHT.LIGHT_COUNT]; index++) {
    const offset = LIGHT.LIGHT_SAMPLES + index * LIGHT.LIGHT_SAMPLE_FIELDS;
    if (image[offset + LIGHT.LIGHT_SAMPLE_ID] === 257) return image[offset + LIGHT.LIGHT_SAMPLE_LEVEL];
  }
  return 0;
};
const inputMap = decodePeripheralInputMap({
  sources: [{ kind: 'linux', id: 'keys', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41], relativeAxes: [] },
    { kind: 'linux', id: 'motion', interfaceNumber: 3, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] }],
  switches: [{ controlId: 'blue', sourceId: 'keys', type: 1, code: 41 }],
  axis: { sourceId: 'motion', type: 2, code: 1 }, leds: [], confirmWiring: false,
});

const attachments: readonly { playing: boolean; disabled?: boolean; gap?: boolean; cleanupUnknown?: boolean; rejectRelease?: boolean }[] = [
  { playing: false }, { playing: true },
  { playing: true, disabled: true }, { playing: true, disabled: true, gap: true },
  { playing: true, disabled: true, cleanupUnknown: true },
  { playing: false, disabled: true, rejectRelease: true },
];
for (const { playing, disabled = false, gap = false, cleanupUnknown = false, rejectRelease = false } of attachments) test(`a real gateway attaches ${playing ? 'during playback' : 'while stopped'} with an explicit Blue map${disabled ? ' and musical knob disabled' : ''} and ${rejectRelease ? 'a rejected release allows retry after exact revocation' : cleanupUnknown ? 'unknown cleanup blocks automatic retry' : `${gap ? 'publication gap' : 'abort'} clears native held state and helper output`}`, { timeout: 20000 }, async () => {
  await stat(resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host'));
  const directory = await mkdtemp(join(tmpdir(), 'pb-'));
  const tokenFile = join(directory, 'token');
  const helper = join(directory, 'helper');
  const log = join(directory, 'helper-log');
  const release = join(directory, 'release');
  const token = '012345678901234567890123456789ab';
  await writeFile(tokenFile, token, { mode: 0o600 });
  await writeFile(helper, `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const log = ${JSON.stringify(log)};
const record = value => fs.appendFileSync(log, JSON.stringify(value) + String.fromCharCode(10));
const session = Number(process.argv[2]);
record({ type: 'ready', args: process.argv.slice(3) });
process.stdout.write(JSON.stringify({ type: 'ready', version: 2, session, switches: [{ controlId: 'blue', state: 'released' }] }) + String.fromCharCode(10));
process.stdout.write(JSON.stringify({ type: 'motion', session, sequence: 1, deltaY: 8 }) + String.fromCharCode(10));
process.stdout.write(JSON.stringify({ type: 'motion', session, sequence: 2, deltaY: -5 }) + String.fromCharCode(10));
process.stdout.write(JSON.stringify({ type: 'button', controlId: 'blue', session, sequence: 3, down: true }) + String.fromCharCode(10));
if (${rejectRelease}) {
  const timer = setInterval(() => {
    if (!fs.existsSync(${JSON.stringify(release)})) return;
    clearInterval(timer);
    process.stdout.write(JSON.stringify({ type: 'button', controlId: 'blue', session, sequence: 4, down: false }) + String.fromCharCode(10));
  }, 10);
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  record({ type: 'command', line });
  if (line === 'quit') process.exit(0);
});
process.on('exit', code => record({ type: 'exit', code }));
`);
  await chmod(helper, 0o700);
  const canonical = installedPackage().installed.song.compiled;
  assert.ok(canonical);
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage({ ...canonical,
    inputBindings: [{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['L1', 'L2', 'R1', 'R2'] } }] }).installed);
  const abort = new AbortController();
  const commands: unknown[] = [];
  let lifecycleChanges = 0;
  let rejectNextInput = false;
  let publish: ((publication: DeskPublication) => void) | undefined;
  const forwarded: DeskController = {
    snapshot: () => controller.snapshot(),
    subscribe: listener => { publish = listener; return controller.subscribe(listener); },
    command: (target, input) => {
      commands.push(input);
      if (rejectNextInput && input && typeof input === 'object' && 'command' in input && input.command === 'inputEvent') {
        rejectNextInput = false;
        return Promise.resolve({ outcome: 'rejected', error: 'Old native input generation' });
      }
      if (cleanupUnknown && input && typeof input === 'object' && 'command' in input && input.command === 'inputRevoke')
        return Promise.resolve({ outcome: 'unknown' });
      return controller.command(target, input);
    },
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
    running = runPeripheralBridge({ version: 2, origin: base, tokenFile, helperExecutable: helper,
      inputMap, bindingRevision: 1, jiggle: disabled ? null : { minimumTravel: 4, minimumReversal: 2 } }, abort.signal);
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
    const generation = initial.performance.state.inputRouting?.bindingGeneration;
    assert.ok(generation);
    const source = { producer: 0, session: 1, bindingGeneration: generation };
    const expected = [
      ...(!disabled ? [{ command: 'configureJiggle', args: { minimumTravel: 4, minimumReversal: 2 } }] : []),
      { command: 'inputAttach', args: { ...source, kind: 'physical', releasedMask: 1, heldMask: 0 } },
      { command: 'inputEvent', args: { ...source, sequence: 1, input: disabled ? 7 : 6, value: 8 } },
      { command: 'inputEvent', args: { ...source, sequence: 2, input: disabled ? 7 : 6, value: -5 } },
      { command: 'inputEvent', args: { ...source, sequence: 3, input: 0, value: 1 } },
    ];
    assert.deepEqual(commands, expected, 'physical identities retain ordered observations while the gateway assigns the lease');
    const firstRecord = (await records())[0];
    assert.equal(firstRecord.type, 'ready');
    assert.deepEqual(firstRecord.args, peripheralHelperArgs(1, inputMap).slice(1), 'the helper receives only explicit installation facts');
    if (rejectRelease) {
      rejectNextInput = true;
      await writeFile(release, '');
    } else if (gap || cleanupUnknown) {
      for (let count = 0; count < 100 && (await records()).filter(entry => entry.line?.startsWith('light ')).length < 2; count++) await new Promise(resolve => setTimeout(resolve, 10));
      assert.ok((await records()).filter(entry => entry.line?.startsWith('light ')).length >= 2, 'event stream attached before gap');
      if (cleanupUnknown) publish?.({ type: 'desk', view: { ...controller.snapshot(), audio: { kind: 'off' } } });
      else publish?.({ type: 'gap' });
    } else abort.abort();
    const result = await settled;
    if (cleanupUnknown) {
      assert.equal(result.ok, false);
      assert.ok(bridgeFailure instanceof Error && !(bridgeFailure instanceof PeripheralRetry), 'unconfirmed native revocation must prevent automatic same-engine retry');
      assert.match(bridgeFailure.message, /revocation.*unconfirmed/i);
    } else if (gap || rejectRelease) {
      assert.equal(result.ok, false);
      assert.ok(bridgeFailure instanceof PeripheralRetry);
      assert.match(bridgeFailure.message, rejectRelease ? /button release rejected/ : /publication gap/);
    }
    else assert.deepEqual(result, { ok: true });
    const final = controller.snapshot().audio;
    assert.equal(final.kind, 'ready');
    if (final.kind !== 'ready') throw new Error('Bridge interrupted native audio');
    assert.equal(final.attempt, initial.attempt);
    assert.equal(final.performance.state.runId, beforeBridge.performance.state.runId);
    assert.equal(final.performance.state.phase, playing ? 'playing' : 'idle');
    if (cleanupUnknown) {
      assert.equal(level(final.performance.lights), 1, 'an unknown revoke never fabricates native retirement');
      assert.equal(final.performance.state.inputRouting?.producers.length, 1);
    } else {
      assert.ok(level(final.performance.lights) < 1, 'source revocation removes held brightness without stopping the transport');
      assert.equal(final.performance.state.inputRouting?.producers.length, 0);
    }
    assert.equal(lifecycleChanges, 0, 'attaching and aborting never change the audio lifecycle');
    if (rejectRelease) assert.deepEqual(commands.at(-2), {
      command: 'inputEvent', args: { ...source, sequence: 4, input: 0, value: 0 },
    });
    assert.equal(commands.length, expected.length + (rejectRelease ? 2 : 1));
    assert.deepEqual(commands.at(-1), { command: 'inputRevoke', args: { producer: 0, session: 1 } });
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
