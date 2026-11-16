import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicalInputPolicy, currentMusicalInputPolicy } from '../musical-input-policy.js';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NativePerformance } from '../../../lib/performance/wasm-performance.js';
import { CONTROL_IDS } from '../../../lib/performance/model.js';
import { sourceForVM } from '../../../scripts/source-for-vm.js';

function storage(initial?: string) {
  let value = initial ?? null;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; } };
}

test('DOM musical input requires an explicit client selection and survives only that client session', () => {
  const local = storage(), remote = storage();
  let changes = 0;
  const policy = createMusicalInputPolicy({ storage: local, changed: () => changes++ });
  assert.equal(policy.selection(), 'unselected');
  assert.equal(policy.allowsDomInput(), false);
  policy.select('native-controls');
  assert.equal(policy.allowsDomInput(), false);
  assert.equal(currentMusicalInputPolicy(local), 'native-controls');
  assert.equal(currentMusicalInputPolicy(remote), 'unselected');
  policy.select('keyboard');
  assert.equal(policy.allowsDomInput(), true);
  assert.equal(createMusicalInputPolicy({ storage: local }).selection(), 'keyboard');
  policy.select('keyboard');
  assert.equal(changes, 2);
  assert.throws(() => policy.select('automatic'));
});

test('invalid or unavailable storage leaves touch controls available and shortcuts disabled', () => {
  assert.equal(currentMusicalInputPolicy(storage('native')), 'unselected');
  const unavailable = { getItem(): string | null { throw new Error('Storage disabled'); }, setItem() { throw new Error('Storage disabled'); } };
  const policy = createMusicalInputPolicy({ storage: unavailable });
  assert.equal(policy.allowsDomInput(), false);
  policy.select('keyboard');
  assert.equal(policy.allowsDomInput(), true);
});

test('the real worklet assigns role leases and rejects duplicate or stale ownership without stealing', async () => {
  const module = await WebAssembly.compile(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)));
  const sources = await Promise.all(['../runtime/beat-worklet.js', '../runtime/performance-worklet.js', '../practice-worklet.ts']
    .map(async path => (await sourceForVM(new URL(path, import.meta.url))).replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ')));
  const context = vm.createContext({ assert, NativePerformance, CONTROL_IDS, WebAssembly, module, sampleRate: 8000, currentFrame: 0,
    Float32Array, Float64Array, DataView, AudioWorkletProcessor: class { port = { postMessage() {} }; },
    registerProcessor() {} });
  vm.runInContext(sources.join('\n') + `
    const processor = new PracticeProcessor({ processorOptions: { module, clickGain: 0, practice: { barCount: 4, endBar: 4,
      program: { lengthBeats: 4, events: [], controls: { leadIn: Object.fromEntries(CONTROL_IDS.map(id => [id, { kind: 'none' }])),
        bars: Array.from({ length: 4 }, () => Object.fromEntries(CONTROL_IDS.map(id => [id, { kind: 'none' }]))) } } } } });
    const messages = [];
    processor.receive({ type: 'performance-connect', port: { start() {}, close() {}, postMessage: value => messages.push(value) } });
    let request = 0;
    function command(command, payload) {
      processor.command({ id: ++request, command, payload });
      const reply = messages.at(-1); assert.equal(reply.id, request); return reply;
    }
    const generation = processor.native.inputRouting().bindingGeneration;
    for (const kind of ['keyboard', 'pointer', 'physical']) {
      assert.equal(command('practice.input-attach', { kind, bindingGeneration: generation, releasedMask: 0, heldMask: 0 }).ok, true);
    }
    const first = processor.native.inputRouting();
    assert.equal(first.producers.length, 3);
    assert.equal(new Set(first.producers.map(value => value.producer)).size, 3);
    assert.equal(new Set(first.producers.map(value => value.session)).size, 3);
    const pointer = first.producers.find(value => value.kind === 'pointer');
    assert.equal(command('practice.input-attach', { kind: 'pointer', bindingGeneration: generation, releasedMask: 223, heldMask: 0 }).ok, false);
    assert.equal(processor.native.inputRouting().producers.find(value => value.kind === 'pointer').session, pointer.session);
    assert.equal(command('practice.input-event', { kind: 'keyboard', bindingGeneration: generation, sequence: 100, input: 0, value: 0 }).ok, true);
    assert.equal(command('practice.input-event', { kind: 'keyboard', bindingGeneration: generation, sequence: 99, input: 0, value: 1 }).ok, false);
    assert.equal(command('practice.input-event', { kind: 'keyboard', bindingGeneration: generation + 1, sequence: 101, input: 0, value: 1 }).ok, false);
    assert.equal(command('practice.input-revoke', { kind: 'keyboard' }).ok, true);
    assert.equal(processor.native.inputRouting().producers.length, 2);
    assert.equal(processor.native.inputRouting().producers.find(value => value.kind === 'pointer').session, pointer.session);
    assert.equal(command('practice.input-event', { kind: 'keyboard', bindingGeneration: generation, sequence: 102, input: 0, value: 1 }).ok, false);
    assert.equal(command('practice.input-attach', { kind: 'keyboard', bindingGeneration: generation, releasedMask: 0, heldMask: 0 }).ok, true);
    assert(processor.native.inputRouting().sessionHighWatermark > first.sessionHighWatermark);
    processor.native.dispose();
  `, context);
});

test('policy reattachment waits for old physical cleanup and holds on an unconfirmed revoke', async () => {
  const source = (await sourceForVM(new URL('../audio.ts', import.meta.url)))
    .replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ').replace(/export\s*\{[^}]*\};?/g, '');
  const calls: string[] = [];
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let connections = 0;
  const context = vm.createContext({
    oldStop: () => { calls.push('old-stop'); return blocked; },
    failStop: async () => { throw new Error('Revoke unconfirmed'); },
    connectBrowserPeripheral: () => {
      const index = ++connections; calls.push(`connect-${index}`);
      return { ready: Promise.resolve(), stop: async () => { calls.push(`stop-${index}`); } };
    },
  });
  vm.runInContext(source + `
    globalThis.audio = Object.assign(Object.create(PracticeAudio.prototype), {
      peripheralTransition: Promise.resolve(), disposed: false, peripheralClosing: false, detachPeripheral: oldStop, fail() {}
    });
    audio.attachPeripheral(); audio.attachPeripheral();
  `, context);
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['old-stop']);
  release();
  await vm.runInContext('audio.peripheralReady', context);
  assert.deepEqual(calls, ['old-stop', 'connect-1', 'stop-1', 'connect-2']);
  vm.runInContext(`globalThis.failed = Object.assign(Object.create(PracticeAudio.prototype), {
    peripheralTransition: Promise.resolve(), disposed: false, peripheralClosing: false, detachPeripheral: failStop, fail() {}
  }); failed.attachPeripheral();`, context);
  await assert.rejects(vm.runInContext('failed.peripheralReady', context), /unconfirmed/);
  vm.runInContext('failed.attachPeripheral()', context);
  await assert.rejects(vm.runInContext('failed.peripheralReady', context), /unconfirmed/);
  assert.equal(connections, 2);
});
