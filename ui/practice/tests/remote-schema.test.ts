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
  return decodeNativeEvent(data, 'run', () => 'error');
}

test('remote publications preserve native fractional frame coordinates', () => {
  const event = beat(8000 * 60 / 134);
  const decoded = decodeDeskPublication({ type: 'event', attempt: 'attempt', event });
  assert.equal(decoded.type, 'event');
  if (decoded.type !== 'event') throw new Error('Expected an event');
  assert.equal(decoded.event.frame, event.frame);
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
  const take = { index: 0, ready: true, frames: 20, period: 40, playback: 'playing' as const, sourceEndFrames: 15 };
  event.state.compiledTakes = [take];
  assert.doesNotThrow(() => decodeDeskPublication({ type: 'event', attempt: 'attempt', event }));
  for (const field of ['frames', 'period', 'sourceEndFrames'] as const) {
    assert.throws(() => decodeDeskPublication({ type: 'event', attempt: 'attempt', event: { ...event, state: { ...event.state,
      compiledTakes: [{ ...take, [field]: 1.5 }] } } }));
  }
});
