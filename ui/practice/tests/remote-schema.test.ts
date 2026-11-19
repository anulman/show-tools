import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeNativeEvent } from '../../../lib/performance/native-observation.js';
import { PF } from '../../../lib/performance/wasm-abi.js';
import { decodeDeskPublication } from '../remote-schema.js';

function beat(frame: number) {
  const data = new Float64Array(PF.EVENT_FIELDS);
  data[PF.EVENT_TYPE] = PF.BEAT;
  data[PF.EVENT_FRAME] = frame;
  data[PF.EVENT_RATE] = 8000;
  data[PF.EVENT_CUE] = -1;
  data[PF.EVENT_NEXT_BEAT_ID] = 2;
  data[PF.EVENT_NEXT_BEAT_FRAME] = frame + 4000;
  data[PF.EVENT_CLOCK_EPOCH] = 1;
  data[PF.EVENT_CLOCK_REVISION] = 3;
  return decodeNativeEvent(data, 'run', () => 'error');
}

test('remote publications preserve native fractional frame coordinates', () => {
  const event = beat(8000 * 60 / 134);
  const decoded = decodeDeskPublication({ type: 'event', attempt: 'attempt', event });
  assert.equal(decoded.type, 'event');
  if (decoded.type !== 'event') throw new Error('Expected an event');
  assert.equal(decoded.event.frame, event.frame);
  assert.deepEqual(decoded.event.timing, { clockEpoch: 1, clockRevision: 3,
    nextBeat: { id: 2, frame: 8000 * 60 / 134 + 4000 } });
  event.state.tempoHits = { count: 1, latest: { frame: 123.5, bpm: 134, beatHint: 1, source: 'chart', estimated: false } };
  const withTempo = decodeDeskPublication({ type: 'event', attempt: 'attempt', event });
  assert.equal(withTempo.type, 'event');
  if (withTempo.type !== 'event') throw new Error('Expected an event');
  assert.equal(withTempo.event.state.tempoHits?.latest?.frame, 123.5);
});

test('remote publications reject invalid coordinates and fractional sample counts', () => {
  for (const frame of [-1, NaN, Infinity]) {
    assert.throws(() => decodeDeskPublication({ type: 'event', attempt: 'attempt', event: { ...beat(1), frame } }));
    const event = beat(1);
    event.state.tempoHits = { count: 1, latest: { frame, bpm: 134, beatHint: 1, source: 'chart', estimated: false } };
    assert.throws(() => decodeDeskPublication({ type: 'event', attempt: 'attempt', event }));
  }
  const event = beat(1);
  const take = { index: 0, ready: true, frames: 20, period: 40, playback: 'playing' as const, sourceEndFrames: 15, selectionIndex: 7 };
  event.state.compiledTakes = [take];
  const readback = decodeDeskPublication({ type: 'event', attempt: 'attempt', event });
  assert.equal(readback.type, 'event');
  if (readback.type !== 'event') throw new Error('Expected native event');
  assert.equal(readback.event.state.compiledTakes?.[0].selectionIndex, 7);
  for (const field of ['frames', 'period', 'sourceEndFrames', 'selectionIndex'] as const) {
    assert.throws(() => decodeDeskPublication({ type: 'event', attempt: 'attempt', event: { ...event, state: { ...event.state,
      compiledTakes: [{ ...take, [field]: 1.5 }] } } }));
  }
});

test('remote publications require event-specific cue and identified input fields', () => {
  const state = beat(1).state;
  const data = new Float64Array(PF.EVENT_FIELDS);
  data[PF.EVENT_TYPE] = PF.IDENTIFIED_INPUT;
  data[PF.EVENT_FRAME] = 300.25;
  data[PF.EVENT_RATE] = 8000;
  data[PF.EVENT_CUE] = -1;
  data[PF.EVENT_INPUT_SLOT] = 3;
  data[PF.EVENT_INPUT_SESSION] = 700;
  data[PF.EVENT_INPUT_GENERATION] = 9;
  data[PF.EVENT_INPUT_SEQUENCE] = 4;
  data[PF.EVENT_INPUT_EDGE] = 3;
  data[PF.EVENT_CONTROL] = 7;
  data[PF.EVENT_VALUE] = -2;
  const rotation = decodeNativeEvent(data, 'run', () => 'error');
  assert.deepEqual(rotation.identifiedInput, { producer: 3, session: 700, bindingGeneration: 9,
    sequence: 4, kind: 'physical', inputIndex: 7, controlId: 'knob', edge: 'rotate', value: -2 });
  assert.doesNotThrow(() => decodeDeskPublication({ type: 'event', attempt: 'attempt', event: rotation }));
  for (const type of ['beat-prediction', 'cue', 'identified-input']) assert.throws(() => decodeDeskPublication({
    type: 'event', attempt: 'attempt', event: { type, state, v: 1, runId: 'run', seq: 1 },
  }));
});
