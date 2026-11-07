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
import type { Control } from '../../../lib/performance/model.js';

async function until(predicate: () => boolean) {
  for (let count = 0; count < 100; count++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Transport observation did not arrive');
}

test('browser client forwards actual publications and ordered physical controls over authenticated real HTTP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'browser-ipac-client-'));
  await mkdir(join(root, 'ui/practice'), { recursive: true });
  await writeFile(join(root, 'ui/practice/index.html'), '<main></main>');
  const input = new PassThrough({ objectMode: true });
  const writes: string[] = [], commands: string[] = [], controls: Control[] = [];
  const server = await startBrowserPeripheralServer({ staticRoot: root,
    transport: { session: 51, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
  input.write({ type: 'ready', version: 1, session: 51, released: true }); await setImmediate();
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
  const audio = { disposed: false, async control(control: Control) { controls.push(control); },
    endpoint: { port, async request(command: string) { commands.push(command); } } };
  let client: ReturnType<typeof connectBrowserPeripheral> | undefined;
  try {
    client = connectBrowserPeripheral(audio, token);
    await client.ready;
    assert.deepEqual(controls, [{ id: 'cueButton', value: 0 }]);
    assert.deepEqual(commands, ['practice.jiggle', 'practice.peripheral-lights']);
    const values = Array<number>(PF.LIGHT_FIELDS).fill(0);
    values[PF.LIGHT_FORMAT] = 1; values[PF.LIGHT_GENERATION] = 1; values[PF.LIGHT_EPOCH] = 1;
    values[PF.LIGHT_SEQUENCE] = 1; values[PF.LIGHT_RATE] = 48000; values[PF.LIGHT_COUNT] = 1;
    values[PF.LIGHT_SAMPLES] = 1; values[PF.LIGHT_SAMPLES + 1] = .375;
    port.dispatchEvent(new MessageEvent('message', { data: { lights: values } }));
    await until(() => writes.some(line => line.startsWith('light ')));
    assert.deepEqual(writes.find(line => line.startsWith('light '))?.split(' ').slice(5).map(Number), values);
    input.write({ type: 'button', session: 51, sequence: 1, down: true });
    input.write({ type: 'motion', session: 51, sequence: 2, deltaY: -9 });
    input.write({ type: 'button', session: 51, sequence: 3, down: false });
    await until(() => controls.length === 4);
    assert.deepEqual(controls.slice(1), [{ id: 'cueButton', value: 1 }, { id: 'knob', value: -9 }, { id: 'cueButton', value: 0 }]);
    values[PF.LIGHT_SEQUENCE] = 2;
    port.dispatchEvent(new MessageEvent('message', { data: { lights: values } }));
    windowEvents.dispatchEvent(new Event('pagehide'));
    client.stop();
    await until(() => writes.at(-1) === 'clear' && controls.length === 5);
    const count = writes.length;
    port.dispatchEvent(new MessageEvent('message', { data: { lights: values } }));
    await setImmediate(); assert.equal(writes.length, count);
    assert.deepEqual(controls.at(-1), { id: 'cueButton', value: 0 });
    assert.deepEqual(errors, []);
  } finally {
    client?.stop(); await server.close();
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
    await rm(root, { recursive: true, force: true });
  }
});

test('stopping during every pairing stage leaves the final publication disabled', async t => {
  for (const stage of ['cue', 'jiggle', 'lights']) for (const exit of ['stop', 'pagehide']) {
    await t.test(`${exit} while awaiting ${stage}`, async () => {
      const directory = await mkdtemp(join(tmpdir(), 'browser-ipac-pairing-'));
      await mkdir(join(directory, 'ui/practice'), { recursive: true });
      await writeFile(join(directory, 'ui/practice/index.html'), '<main></main>');
      const input = new PassThrough({ objectMode: true }), writes: string[] = [];
      const server = await startBrowserPeripheralServer({ staticRoot: directory,
        transport: { session: 75, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
      input.write({ type: 'ready', version: 1, session: 75, released: true }); await setImmediate();
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
      let entered = false, unblock: () => void = () => {}, cueCalls = 0;
      const blocked = new Promise<void>(resolve => { unblock = resolve; });
      const lights: boolean[] = [], controls: Control[] = [], commands: string[] = [];
      const audio = { disposed: false, async control(control: Control) {
        controls.push(control);
        if (cueCalls++ === 0 && stage === 'cue') { entered = true; await blocked; }
      }, endpoint: { port, async request(command: string, payload?: object) {
        commands.push(command);
        const enabled = payload && 'enabled' in payload && payload.enabled === true;
        if (command === 'practice.peripheral-lights') lights.push(Boolean(enabled));
        if ((stage === 'jiggle' && command === 'practice.jiggle') || (stage === 'lights' && command === 'practice.peripheral-lights' && enabled)) {
          entered = true; await blocked;
        }
      } } };
      const client = connectBrowserPeripheral(audio, token);
      const ready = client.ready.then(() => true, () => false);
      try {
        await until(() => entered);
        if (exit === 'stop') client.stop(); else windowEvents.dispatchEvent(new Event('pagehide'));
        assert.equal(await ready, false);
        unblock();
        await until(() => lights.at(-1) === false && controls.length === 2);
        await new Promise(resolve => setTimeout(resolve, 525));
        assert.deepEqual(lights, stage === 'lights' ? [true, false] : [false]);
        assert.deepEqual(controls.at(-1), { id: 'cueButton', value: 0 });
        assert.equal(commands.at(-1), 'practice.peripheral-lights');
        assert.equal(paths.filter(path => path.endsWith('/heartbeat')).length, 0);
        assert.deepEqual(errors, []);
        assert.match(status.textContent, /disconnected/);
        assert.equal(writes.at(-1), 'clear');
      } finally {
        unblock(); client.stop(); await server.close(); globalThis.fetch = originalFetch;
        for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

test('shutdown releases a held button when disabling light publications times out', async t => {
  for (const exit of ['stop', 'pagehide']) await t.test(exit, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'browser-ipac-release-'));
    await mkdir(join(directory, 'ui/practice'), { recursive: true });
    await writeFile(join(directory, 'ui/practice/index.html'), '<main></main>');
    const input = new PassThrough({ objectMode: true }), writes: string[] = [];
    const server = await startBrowserPeripheralServer({ staticRoot: directory,
      transport: { session: 76, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
    input.write({ type: 'ready', version: 1, session: 76, released: true }); await setImmediate();
    const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get('peripheral'); assert.ok(token);
    const originalFetch = globalThis.fetch;
    const saved = new Map(['document', 'window', 'reportError'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    const status = { textContent: '', id: '', setAttribute() {} }, windowEvents = new EventTarget();
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => status, createElement: () => status, querySelector: () => ({ prepend() {} }) } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: windowEvents });
    const errors: unknown[] = [], controls: Control[] = [];
    Object.defineProperty(globalThis, 'reportError', { configurable: true, value: (error: unknown) => { errors.push(error); } });
    globalThis.fetch = (url, init) => {
      const headers = new Headers(init?.headers); headers.set('origin', server.origin);
      return originalFetch(new URL(String(url), server.origin), { ...init, headers });
    };
    let held = false, disableAttempted = false;
    const audio = { disposed: false, async control(control: Control) {
      controls.push(control);
      if (control.id === 'cueButton') held = control.value === 1;
    }, endpoint: { port: new EventTarget(), async request(command: string, payload?: object) {
      if (command === 'practice.peripheral-lights' && payload && 'enabled' in payload && payload.enabled === false) {
        disableAttempted = true;
        throw new Error('Synthetic AudioEndpoint acknowledgement timeout');
      }
    } } };
    const client = connectBrowserPeripheral(audio, token);
    try {
      await client.ready;
      input.write({ type: 'button', session: 76, sequence: 1, down: true });
      await until(() => held);
      if (exit === 'stop') client.stop(); else windowEvents.dispatchEvent(new Event('pagehide'));
      await until(() => disableAttempted);
      await setImmediate();
      assert.deepEqual(controls.at(-1), { id: 'cueButton', value: 0 }, 'release must be attempted even if light disable acknowledgement fails');
      assert.equal(held, false);
      await until(() => writes.at(-1) === 'clear');
      assert.deepEqual(errors, []);
    } finally {
      client.stop(); await server.close(); globalThis.fetch = originalFetch;
      for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
      await rm(directory, { recursive: true, force: true });
    }
  });
});
