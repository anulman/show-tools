import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeInputAttach, decodeInputBindings, decodeInputEvent, inputBindingRows,
  physicalControlLightId } from '../input-bindings.js';

test('physical bindings stay unbound by default and lower only explicitly selected rows', () => {
  assert.deepEqual(inputBindingRows(decodeInputBindings([])), []);
  const bindings = decodeInputBindings([
    { controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1', 'L1'] } },
    { controlId: 'yellow', target: { kind: 'tempo' } },
  ]);
  assert.deepEqual(inputBindingRows(bindings), [[0, 0, 5], [1, 1, 0]]);
  assert.equal(physicalControlLightId('blue'), 257);
  assert.equal(physicalControlLightId('yellow'), 258);
});

test('duplicate IDs, row aliases and host facts cannot become canonical musical bindings', () => {
  const one = { controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1'] } };
  for (const bindings of [
    [one, one], [one, { ...one, controlId: 'yellow' }],
    [{ ...one, target: { kind: 'cue-rows', rows: [] } }],
    [{ ...one, target: { kind: 'cue-rows', rows: ['R1', 'R1'] } }],
    [{ ...one, keyCode: 1 }], [{ ...one, sdkChannel: 0 }],
    [{ ...one, target: { kind: 'panic', rows: ['R1'] } }],
  ]) assert.throws(() => decodeInputBindings(bindings));
});

test('initial masks reject contradictory state and axis bits while sequence numbers may jump', () => {
  const attach = { producer: 0, session: 1, bindingGeneration: 1, kind: 'physical', releasedMask: 3, heldMask: 0 };
  assert.equal(decodeInputAttach(attach).releasedMask, 3);
  assert.throws(() => decodeInputAttach({ ...attach, heldMask: 1 }));
  assert.throws(() => decodeInputAttach({ ...attach, releasedMask: 64 }));
  assert.throws(() => decodeInputAttach({ ...attach, kind: 'keyboard', releasedMask: 32 }));
  for (const sequence of [1, 100]) assert.equal(decodeInputEvent({ producer: 0, session: 1,
    bindingGeneration: 1, sequence, input: 0, value: 1 }).sequence, sequence);
  assert.throws(() => decodeInputEvent({ producer: 0, session: 1, bindingGeneration: 1, sequence: 0, input: 0, value: 1 }));
});
