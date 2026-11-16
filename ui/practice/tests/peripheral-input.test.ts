import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicalInputProducer, type MusicalInputEndpoint } from '../peripheral-input.js';
import type { PracticeState } from '../../../lib/performance/model.js';
import type { InputAttachArgs, InputEventArgs, InputRevokeArgs } from '../musical-input-policy.js';

function fixture() {
  const calls: ({ command: 'attach'; args: InputAttachArgs } | { command: 'event'; args: InputEventArgs } | { command: 'revoke'; args: InputRevokeArgs })[] = [];
  const state: PracticeState = { phase: 'idle', bar: null, beat: null, countInRemaining: 0, bpm: 120, startBar: 1, endBar: 4,
    loop: true, automatic: false, click: false, selectedChannel: 'L1', runId: 'test', seq: 0, channels: [], looping: [], recording: null,
    microphone: false, error: null, inputRouting: { bindingGeneration: 1, sessionHighWatermark: 0, panicMask: 0, producers: [] } };
  let attach: (() => Promise<void>) | undefined;
  const endpoint: MusicalInputEndpoint = {
    inputScope: 'fixture-engine',
    snapshot: () => state,
    async inputAttach(args) { calls.push({ command: 'attach', args }); await attach?.(); return state; },
    async inputEvent(args) { calls.push({ command: 'event', args }); return state; },
    async inputRevoke(args) { calls.push({ command: 'revoke', args }); return state; },
  };
  return { calls, state, endpoint, blockAttach: (value: () => Promise<void>) => { attach = value; } };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('keyboard release barriers reach native without an admitted press and use increasing source sequences', async () => {
  const f = fixture();
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => f.endpoint, releasedMask: 0 });
  await keyboard.event(0, 0); await keyboard.event(0, 1); await keyboard.event(0, 0);
  assert.deepEqual(f.calls, [
    { command: 'attach', args: { kind: 'keyboard', bindingGeneration: 1, releasedMask: 0, heldMask: 0 } },
    ...[0, 1, 0].map((value, index) => ({ command: 'event', args: { kind: 'keyboard', bindingGeneration: 1, sequence: index + 1, input: 0, value } })),
  ]);
  await keyboard.reset(); await keyboard.event(0, 0);
  assert.deepEqual(f.calls.slice(-3), [
    { command: 'revoke', args: { kind: 'keyboard' } },
    { command: 'attach', args: { kind: 'keyboard', bindingGeneration: 1, releasedMask: 0, heldMask: 0 } },
    { command: 'event', args: { kind: 'keyboard', bindingGeneration: 1, sequence: 1, input: 0, value: 0 } },
  ]);
});

test('blur cleanup belongs only to keyboard while pointer holds keep their own lease', async () => {
  const f = fixture();
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => f.endpoint, releasedMask: 0 });
  const pointer = createMusicalInputProducer({ kind: 'pointer', endpoint: async () => f.endpoint, releasedMask: 223 });
  await pointer.event(1, 1); await keyboard.event(0, 0); await keyboard.event(0, 1);
  await keyboard.reset(); await pointer.event(1, 0);
  assert.deepEqual(f.calls.filter(value => value.command === 'revoke'), [{ command: 'revoke', args: { kind: 'keyboard' } }]);
  assert.deepEqual(f.calls.at(-1), { command: 'event', args: { kind: 'pointer', bindingGeneration: 1, sequence: 2, input: 1, value: 0 } });
});

test('reset cancels preparation and an in-flight attach before admitting any old press', async () => {
  const f = fixture();
  let release: () => void = () => {};
  const blocked = new Promise<void>(resolve => { release = resolve; });
  f.blockAttach(() => blocked);
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => f.endpoint, releasedMask: 0 });
  const press = keyboard.event(0, 1);
  await tick();
  const reset = keyboard.reset();
  release(); await press; await reset;
  assert.deepEqual(f.calls.map(value => value.command), ['attach', 'revoke']);
  await keyboard.event(0, 0);
  assert.deepEqual(f.calls.at(-1), { command: 'event', args: { kind: 'keyboard', bindingGeneration: 1, sequence: 1, input: 0, value: 0 } });
});

test('queued old events cannot cross a reset or a new binding generation', async () => {
  const f = fixture();
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => f.endpoint, releasedMask: 0 });
  const old = keyboard.event(0, 1); const reset = keyboard.reset();
  await old; await reset;
  assert.equal(f.calls.length, 0);
  await keyboard.event(0, 0);
  if (!f.state.inputRouting) throw new Error('Missing fixture routing state');
  f.state.inputRouting = { ...f.state.inputRouting, bindingGeneration: 2 };
  await keyboard.event(0, 0);
  assert.deepEqual(f.calls.slice(-3), [
    { command: 'revoke', args: { kind: 'keyboard' } },
    { command: 'attach', args: { kind: 'keyboard', bindingGeneration: 2, releasedMask: 0, heldMask: 0 } },
    { command: 'event', args: { kind: 'keyboard', bindingGeneration: 2, sequence: 1, input: 0, value: 0 } },
  ]);
});

test('a failed own-role revoke holds readmission until cleanup is confirmed', async () => {
  const f = fixture();
  let failing = true;
  const original = f.endpoint.inputRevoke;
  f.endpoint.inputRevoke = async args => {
    await original(args);
    if (failing) throw new Error('Revoke unconfirmed');
    return f.state;
  };
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => f.endpoint, releasedMask: 0 });
  await keyboard.event(0, 0);
  await assert.rejects(keyboard.reset(), /unconfirmed/);
  await assert.rejects(keyboard.event(0, 1), /unconfirmed/);
  assert.equal(f.calls.filter(value => value.command === 'attach').length, 1);
  failing = false;
  await keyboard.event(0, 0);
  assert.deepEqual(f.calls.slice(-3).map(value => value.command), ['revoke', 'attach', 'event']);
});

test('a replaced engine retires the old source without sending stale cleanup to its successor', async () => {
  const previous = fixture(), next = fixture();
  let selected = previous.endpoint;
  previous.endpoint.inputRevoke = async () => { throw new Error('Old engine retired'); };
  const successor = { ...next.endpoint, inputScope: 'successor-engine' };
  const keyboard = createMusicalInputProducer({ kind: 'keyboard', endpoint: async () => selected, releasedMask: 0 });
  await keyboard.event(0, 0);
  await assert.rejects(keyboard.reset(), /retired/);
  selected = successor;
  await keyboard.event(0, 0);
  assert.deepEqual(next.calls.map(value => value.command), ['attach', 'event']);
  assert.deepEqual(next.calls[0], { command: 'attach', args: { kind: 'keyboard', bindingGeneration: 1, releasedMask: 0, heldMask: 0 } });
});
