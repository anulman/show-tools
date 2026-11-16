import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { connectBrowserPeripheral } from '../browser-peripheral.js';
import { startBrowserPeripheralServer } from '../../../lib/peripherals/browser-server.js';
import { PF } from '../../../lib/performance/light-abi.js';
import { decodePeripheralInputMap } from '../../../lib/peripherals/bridge.js';
import { createMusicalInputPolicy } from '../musical-input-policy.js';
import type { InputAttachArgs, InputEventArgs, InputRevokeArgs } from '../musical-input-policy.js';
type PhysicalCall = { kind: 'attach'; args: InputAttachArgs } | { kind: 'event'; args: InputEventArgs } | { kind: 'revoke'; args: InputRevokeArgs };
const inputMap = decodePeripheralInputMap({
  sources: [{ kind: 'hid', id: 'keys', interfaceNumber: 2, usagePage: 1, usage: 6 },
    { kind: 'hid', id: 'motion', interfaceNumber: 3, usagePage: 1, usage: 2 }],
  switches: [{ controlId: 'blue', sourceId: 'keys', type: 7, code: 41 }],
  axis: { sourceId: 'motion', type: 1, code: 49 }, leds: [], confirmWiring: false,
});
const snapshot = () => ({ inputRouting: { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] } });
createMusicalInputPolicy().select('native-controls');

async function until(predicate: () => boolean) {
  for (let count = 0; count < 100; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Transport observation did not arrive');
}

test('browser client forwards actual publications and ordered physical controls over authenticated real HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'browser-ipac-client-'));
  await mkdir(join(root, 'ui/practice'), { recursive: true });
  await writeFile(join(root, 'ui/practice/index.html'), '<main></main>');
  const input = new PassThrough({ objectMode: true });
  const writes: string[] = [], commands: string[] = [], controls: PhysicalCall[] = [];
  const server = await startBrowserPeripheralServer({ staticRoot: root, inputMap,
    transport: { session: 51, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
  input.write({ type: 'ready', version: 2, session: 51, switches: [{ controlId: 'blue', state: 'released' }] }); await setImmediate();
  const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get('peripheral');
  assert.ok(token);
  const originalFetch = globalThis.fetch;
  const saved = new Map(['document', 'window', 'reportError'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const status = { textContent: '', id: '', setAttribute() {} };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => status, createElement: () => status, querySelector: () => ({ prepend() {} }) } });
  const windowEvents = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents });
  const errors: unknown[] = [];
  Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => { errors.push(error); } });
  globalThis.fetch = (url, init) => {
    const headers = new Headers(init?.headers); headers.set('origin', server.origin);
    return originalFetch(new URL(String(url), server.origin), { ...init, headers });
  };
  const port = new EventTarget();
  const audio = { disposed: false, snapshot,
    async inputAttach(args: InputAttachArgs) { controls.push({ kind: 'attach', args }); },
    async inputEvent(args: InputEventArgs) { controls.push({ kind: 'event', args }); },
    async inputRevoke(args: InputRevokeArgs) { controls.push({ kind: 'revoke', args }); },
    endpoint: { port, async request(command: string) { commands.push(command); } } };
  let client: ReturnType<typeof connectBrowserPeripheral> | undefined;
  try {
    client = connectBrowserPeripheral(audio, token);
    await client.ready;
    assert.deepEqual(controls, [{ kind: 'attach', args: { kind: 'physical', bindingGeneration: 1, releasedMask: 1, heldMask: 0 } }]);
    assert.deepEqual(commands, ['practice.jiggle', 'practice.peripheral-lights']);
    const values = Array<number>(PF.LIGHT_FIELDS).fill(0);
    values[PF.LIGHT_FORMAT] = 1; values[PF.LIGHT_GENERATION] = 1; values[PF.LIGHT_EPOCH] = 1;
    values[PF.LIGHT_SEQUENCE] = 1; values[PF.LIGHT_RATE] = 48000; values[PF.LIGHT_COUNT] = 1;
    values[PF.LIGHT_SAMPLES] = 257; values[PF.LIGHT_SAMPLES + 1] = .375;
    port.dispatchEvent(new MessageEvent('message', { data: { lights: values } }));
    await until(() => writes.some(line => line.startsWith('light ')));
    assert.deepEqual(writes.find(line => line.startsWith('light '))?.split(' ').slice(5).map(Number), values);
    input.write({ type: 'button', controlId: 'blue', session: 51, sequence: 1, down: true });
    input.write({ type: 'motion', session: 51, sequence: 2, deltaY: -9 });
    input.write({ type: 'button', controlId: 'blue', session: 51, sequence: 3, down: false });
    await until(() => controls.length === 4);
    assert.deepEqual(controls.slice(1), [
      { kind: 'event', args: { kind: 'physical', bindingGeneration: 1, sequence: 1, input: 0, value: 1 } },
      { kind: 'event', args: { kind: 'physical', bindingGeneration: 1, sequence: 2, input: 6, value: -9 } },
      { kind: 'event', args: { kind: 'physical', bindingGeneration: 1, sequence: 3, input: 0, value: 0 } }]);
    values[PF.LIGHT_SEQUENCE] = 2;
    port.dispatchEvent(new MessageEvent('message', { data: { lights: values } }));
    windowEvents.dispatchEvent(new Event('pagehide'));
    client.stop();
    await until(() => writes.at(-1) === 'clear' && controls.length === 5);
    const count = writes.length;
    port.dispatchEvent(new MessageEvent('message', { data: { lights: values } }));
    await setImmediate(); assert.equal(writes.length, count);
    assert.deepEqual(controls.at(-1), { kind: 'revoke', args: { kind: 'physical' } });
    assert.deepEqual(errors, []);
  } finally {
    await client?.stop(); await server.close();
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(root, { recursive: true, force: true });
  }
});

test('stopping during every pairing stage leaves the final publication disabled', async t => {
  for (const stage of ['attach', 'jiggle', 'lights']) for (const exit of ['stop', 'pagehide', 'policy']) {
    await t.test(`${exit} while awaiting ${stage}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'browser-ipac-pairing-'));
      await mkdir(join(directory, 'ui/practice'), { recursive: true });
      await writeFile(join(directory, 'ui/practice/index.html'), '<main></main>');
      const input = new PassThrough({ objectMode: true }), writes: string[] = [];
      const server = await startBrowserPeripheralServer({ staticRoot: directory, inputMap,
        transport: { session: 75, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
      input.write({ type: 'ready', version: 2, session: 75, switches: [{ controlId: 'blue', state: 'released' }] }); await setImmediate();
      const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get('peripheral'); assert.ok(token);
      const originalFetch = globalThis.fetch;
      const saved = new Map(['document', 'window', 'reportError'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
      const status = { textContent: '', id: '', setAttribute() {} }, windowEvents = new EventTarget(), port = new EventTarget();
      Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => status, createElement: () => status, querySelector: () => ({ prepend() {} }) } });
      Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents });
      const errors: unknown[] = [], paths: string[] = [];
      Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => { errors.push(error); } });
      globalThis.fetch = (url, init) => {
        paths.push(String(url));
        const headers = new Headers(init?.headers); headers.set('origin', server.origin);
        return originalFetch(new URL(String(url), server.origin), { ...init, headers });
      };
      let entered = false, unblock: () => void = () => {}, attachCalls = 0;
      const blocked = new Promise<void>(resolve => { unblock = resolve; });
      const lights: boolean[] = [], controls: PhysicalCall[] = [], commands: string[] = [];
      const audio = { disposed: false, snapshot, async inputAttach(args: InputAttachArgs) {
        controls.push({ kind: 'attach', args });
        if (attachCalls++ === 0 && stage === 'attach') { entered = true; await blocked; }
      }, async inputEvent(args: InputEventArgs) { controls.push({ kind: 'event', args }); },
      async inputRevoke(args: InputRevokeArgs) { controls.push({ kind: 'revoke', args }); }, endpoint: { port, async request(command: string, payload?: object) {
        commands.push(command);
        const enabled = payload && 'enabled' in payload && payload.enabled === true;
        if (command === 'practice.peripheral-lights') lights.push(Boolean(enabled));
        if ((stage === 'jiggle' && command === 'practice.jiggle') || (stage === 'lights' && command === 'practice.peripheral-lights' && enabled)) {
          entered = true; await blocked;
        }
      } } };
      createMusicalInputPolicy().select('native-controls');
      const client = connectBrowserPeripheral(audio, token);
      const ready = client.ready.then(() => true, () => false);
      try {
        await until(() => entered);
        if (exit === 'stop') void client.stop();
        else if (exit === 'policy') createMusicalInputPolicy().select('keyboard');
        else windowEvents.dispatchEvent(new Event('pagehide'));
        assert.equal(await ready, false);
        unblock();
        await until(() => lights.at(-1) === false && controls.length === 2);
        await new Promise(resolve => setTimeout(resolve, 525));
        assert.deepEqual(lights, stage === 'lights' ? [true, false] : [false]);
        assert.deepEqual(controls.at(-1), { kind: 'revoke', args: { kind: 'physical' } });
        assert.equal(commands.at(-1), 'practice.peripheral-lights');
        assert.equal(paths.filter(path => path.endsWith('/heartbeat')).length, 0);
        assert.deepEqual(errors, []);
        assert.match(status.textContent, /disconnected/);
        assert.equal(writes.at(-1), 'clear');
      } finally {
        unblock(); await client.stop(); await server.close(); globalThis.fetch = originalFetch;
        for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

test('shutdown releases a held button when disabling light publications times out', async t => {
  for (const exit of ['stop', 'pagehide', 'policy']) await t.test(exit, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-ipac-release-'));
    await mkdir(join(directory, 'ui/practice'), { recursive: true });
    await writeFile(join(directory, 'ui/practice/index.html'), '<main></main>');
    const input = new PassThrough({ objectMode: true }), writes: string[] = [];
    const server = await startBrowserPeripheralServer({ staticRoot: directory, inputMap,
      transport: { session: 76, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
    input.write({ type: 'ready', version: 2, session: 76, switches: [{ controlId: 'blue', state: 'released' }] }); await setImmediate();
    const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get('peripheral'); assert.ok(token);
    const originalFetch = globalThis.fetch;
    const saved = new Map(['document', 'window', 'reportError'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const status = { textContent: '', id: '', setAttribute() {} }, windowEvents = new EventTarget();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => status, createElement: () => status, querySelector: () => ({ prepend() {} }) } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents });
    const errors: unknown[] = [], controls: PhysicalCall[] = [];
    Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => { errors.push(error); } });
    globalThis.fetch = (url, init) => {
      const headers = new Headers(init?.headers); headers.set('origin', server.origin);
      return originalFetch(new URL(String(url), server.origin), { ...init, headers });
    };
    let held = false, disableAttempted = false;
    const audio = { disposed: false, snapshot,
      async inputAttach(args: InputAttachArgs) { controls.push({ kind: 'attach', args }); },
      async inputEvent(args: InputEventArgs) { controls.push({ kind: 'event', args }); if (args.input === 0) held = args.value === 1; },
      async inputRevoke(args: InputRevokeArgs) { controls.push({ kind: 'revoke', args }); held = false; }, endpoint: { port: new EventTarget(), async request(command: string, payload?: object) {
      if (command === 'practice.peripheral-lights' && payload && 'enabled' in payload && payload.enabled === false) {
        disableAttempted = true;
        throw new Error('Synthetic AudioEndpoint acknowledgement timeout');
      }
    } } };
    createMusicalInputPolicy().select('native-controls');
      const client = connectBrowserPeripheral(audio, token);
    try {
      await client.ready;
      input.write({ type: 'button', controlId: 'blue', session: 76, sequence: 1, down: true });
      await until(() => held);
      if (exit === 'stop') void client.stop();
        else if (exit === 'policy') createMusicalInputPolicy().select('keyboard');
        else windowEvents.dispatchEvent(new Event('pagehide'));
      await until(() => disableAttempted);
      await setImmediate();
      assert.deepEqual(controls.at(-1), { kind: 'revoke', args: { kind: 'physical' } }, 'release must be attempted even if light disable acknowledgement fails');
      assert.equal(held, false);
      await until(() => writes.at(-1) === 'clear');
      assert.deepEqual(errors, []);
    } finally {
      await client.stop(); await server.close(); globalThis.fetch = originalFetch;
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
