import test from 'node:test';
import assert from 'node:assert/strict';
import { createPeripheralInput, peripheralCommandId, type NormalizedPeripheralInput, type PeripheralButtonId } from '../peripheral-input.js';

const mapping = new Map<string, PeripheralButtonId>([['KeyQ', 'L1'], ['KeyW', 'R1'], ['KeyA', 'L2'], ['KeyS', 'R2'], ['Escape', 'mushroom']]);
function keyboard(code: string, edge: 'press' | 'release', options: { sessionId?: string; repeat?: boolean; sourceTimeMs?: number } = {}) {
  return { kind: 'key', code, edge, sessionId: options.sessionId ?? 'initial', repeat: options.repeat ?? false, sourceTimeMs: options.sourceTimeMs ?? 0 };
}
function connected() {
  const input = createPeripheralInput({ producerId: 'browser-fixture', mapping });
  input.connect({ sessionId: 'initial', releasedCodes: [...mapping.keys()] });
  return input;
}

test('first explicitly released browser key forwards once, and release is not a stop', () => {
  const input = connected();
  const forwarded: NormalizedPeripheralInput[] = [];
  const observe = (value: unknown) => {
    const event = input.inject(value);
    if (event?.kind === 'button' && event.edge === 'press') forwarded.push(event);
    return event;
  };
  const first = observe(keyboard('KeyQ', 'press', { sourceTimeMs: 12.5 }));
  assert.deepEqual(first, { kind: 'button', buttonId: 'L1', edge: 'press', rawCode: 'KeyQ', producerId: 'browser-fixture', sessionId: 'initial', sequence: 0, sourceTimeMs: 12.5 });
  assert.equal(observe(keyboard('KeyQ', 'press', { repeat: true })), null);
  assert.equal(observe(keyboard('KeyQ', 'press')), null);
  const released = observe(keyboard('KeyQ', 'release'));
  assert.ok(released?.kind === 'button');
  assert.equal(released.edge, 'release');
  assert.equal(released?.sequence, 3);
  assert.equal(forwarded.length, 1);
  observe(keyboard('KeyQ', 'press'));
  assert.equal(forwarded.length, 2);
});

test('unknown reconnect requires release and rejects stale-session observations', () => {
  const input = connected();
  input.inject(keyboard('KeyW', 'press'));
  input.connect({ sessionId: 'reconnected', releasedCodes: [] });
  assert.equal(input.inject(keyboard('KeyW', 'press')), null);
  assert.equal(input.inject(keyboard('KeyW', 'press', { sessionId: 'reconnected' })), null);
  assert.equal(input.inject(keyboard('KeyW', 'release', { sessionId: 'reconnected' })), null);
  const next = input.inject(keyboard('KeyW', 'press', { sessionId: 'reconnected' }));
  assert.equal(next?.sequence, 2);
  assert.equal(next?.sessionId, 'reconnected');
  assert.ok(next?.kind === 'button');
  assert.equal(next.buttonId, 'R1');
});

test('an initial repeat cannot create a fresh press or a semantic release', () => {
  const input = connected();
  assert.equal(input.inject(keyboard('KeyA', 'press', { repeat: true })), null);
  assert.equal(input.inject(keyboard('KeyA', 'press')), null);
  assert.equal(input.inject(keyboard('KeyA', 'release')), null);
  assert.equal(input.inject(keyboard('KeyA', 'press'))?.kind, 'button');
});

test('explicit mapping is copied and has no implicit keyboard or voice defaults', () => {
  const local = new Map<string, PeripheralButtonId>([['KeyP', 'L2']]);
  const input = createPeripheralInput({ producerId: 'custom-map', mapping: local });
  local.set('KeyP', 'R2');
  input.connect({ sessionId: 'custom-session', releasedCodes: ['KeyP'] });
  assert.equal(input.inject(keyboard('KeyQ', 'press', { sessionId: 'custom-session' })), null);
  const event = input.inject(keyboard('KeyP', 'press', { sessionId: 'custom-session' }));
  assert.equal(event?.sequence, 0);
  assert.ok(event?.kind === 'button');
  assert.equal(event.buttonId, 'L2');
  assert.ok(!JSON.stringify(event).includes('voice'));
  assert.ok(!JSON.stringify(event).includes('gain'));
});

test('rotation retains signed distance, source units, arrival order and timestamp provenance', () => {
  const input = connected();
  const first = input.inject({ kind: 'rotation', distance: 7.5, units: 'fixture-counts', sessionId: 'initial', sourceTimeMs: 40 });
  input.inject(keyboard('KeyS', 'press', { sourceTimeMs: 20 }));
  const next = input.inject({ kind: 'rotation', distance: -3, units: 'fixture-counts', sessionId: 'initial', sourceTimeMs: 10 });
  assert.deepEqual(first, { kind: 'rotation', distance: 7.5, units: 'fixture-counts', producerId: 'browser-fixture', sessionId: 'initial', sequence: 0, sourceTimeMs: 40 });
  assert.deepEqual(next, { kind: 'rotation', distance: -3, units: 'fixture-counts', producerId: 'browser-fixture', sessionId: 'initial', sequence: 2, sourceTimeMs: 10 });
  assert.equal(input.inject({ kind: 'rotation', distance: 0, units: 'fixture-counts', sessionId: 'initial', sourceTimeMs: 50 }), null);
  assert.equal(input.inject(keyboard('KeyS', 'release'))?.sequence, 4);
});

test('disconnect emits no synthetic control and disarms old-session input', () => {
  const input = connected();
  input.inject(keyboard('Escape', 'press'));
  input.disconnect();
  assert.equal(input.inject(keyboard('Escape', 'release')), null);
  input.connect({ sessionId: 'after-blur', releasedCodes: [] });
  assert.equal(input.inject(keyboard('Escape', 'press', { sessionId: 'after-blur' })), null);
  assert.equal(input.inject(keyboard('Escape', 'release', { sessionId: 'after-blur' })), null);
  const event = input.inject(keyboard('Escape', 'press', { sessionId: 'after-blur' }));
  if (event?.kind === 'button') assert.equal(event.buttonId, 'mushroom');
  else assert.fail('fresh press after release must be delivered');
});

test('invalid observations and invalid reconnect leave current state and sequence intact', () => {
  const input = connected();
  assert.throws(() => input.inject({ ...keyboard('KeyQ', 'press'), sourceTimeMs: NaN }));
  assert.throws(() => input.inject({ ...keyboard('KeyQ', 'release'), repeat: true }));
  assert.throws(() => input.inject({ kind: 'rotation', sessionId: 'initial', sourceTimeMs: 0, distance: Infinity, units: 'counts' }));
  assert.throws(() => input.connect({ sessionId: 'bad', releasedCodes: ['UnknownCode'] }), /Unknown released/);
  const first = input.inject(keyboard('KeyQ', 'press'));
  assert.equal(first?.sequence, 0);
  assert.throws(() => input.connect({ sessionId: 'initial', releasedCodes: [] }), /cannot be reused/);
  const released = input.inject(keyboard('KeyQ', 'release'));
  assert.equal(released?.sequence, 1);
});

test('canonical command IDs preserve producer/session identity and native UTF-16 bounds', () => {
  assert.notEqual(peripheralCommandId({ producerId: 'a:b', sessionId: 'c', sequence: 0 }), peripheralCommandId({ producerId: 'a', sessionId: 'b:c', sequence: 0 }));
  const input = connected();
  const first = input.inject(keyboard('KeyQ', 'press'));
  assert.ok(first);
  assert.ok(peripheralCommandId(first).length <= 200);
  input.connect({ sessionId: 'second', releasedCodes: ['KeyQ'] });
  const next = input.inject(keyboard('KeyQ', 'press', { sessionId: 'second' }));
  assert.ok(next);
  assert.notEqual(peripheralCommandId(first), peripheralCommandId(next));
  const long = createPeripheralInput({ producerId: '\ud800'.repeat(40), mapping });
  assert.throws(() => long.connect({ sessionId: 'session', releasedCodes: [] }), /UTF-16/);
  assert.throws(() => createPeripheralInput({ producerId: '', mapping }));
});
