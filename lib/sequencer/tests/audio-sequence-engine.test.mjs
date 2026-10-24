import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSequenceEngine } from '../audio-sequence-engine.js';
import { AudioSequencer } from '../audio-sequencer.js';

function engine(beatsPerBar = 4) {
  const hits = [];
  const sequence = new AudioSequenceEngine({ beatsPerBar,
    hasSample: id => ['kick', 'snare'].includes(id), play: (...hit) => hits.push(hit) });
  sequence.define({ id: 'a', label: 'A', lengthBeats: 3, events: [
    { atBeat: 0, sampleId: 'kick' }, { atBeat: 2, sampleId: 'snare', gain: 0.5 } ] });
  sequence.define({ id: 'b', label: 'B', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'snare' }] });
  return { sequence, hits };
}

test('whole-beat patterns use real crossings, finish once, and copy validated input', () => {
  const { sequence: s, hits } = engine();
  s.queue('a', 'beat');
  s.onBeat(1, 100.25, 1);
  s.onBeat(1, 100.25, 1);
  assert.deepEqual(hits, [['kick', 100.25, 1]]);
  s.onBeat(2, 400.75, 1);
  s.onBeat(3, 800.125, 1);
  assert.deepEqual(hits[1], ['snare', 800.125, 0.5]);
  assert.equal(s.snapshot().playing.positionBeat, 2);
  s.onBeat(4, 900, 1);
  assert.equal(s.snapshot().status, 'ready');
  s.onBeat(5, 950, 1);
  assert.equal(hits.length, 2);
  for (const pattern of [
    { id: 'bad', lengthBeats: 0, events: [] },
    { id: 'bad', lengthBeats: 2, events: [{ atBeat: 0.5, sampleId: 'kick' }] },
    { id: 'bad', lengthBeats: 2, events: [{ atBeat: 2, sampleId: 'kick' }] },
    { id: 'bad', lengthBeats: 2, events: [{ atBeat: 0, sampleId: 'missing' }] },
    { id: 'bad', lengthBeats: 2, events: [{ atBeat: 0, sampleId: 'kick', gain: -1 }] },
  ]) assert.throws(() => s.define(pattern));
  const input = { id: 'copy', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'kick' }] };
  s.define(input);
  input.events[0].sampleId = 'missing';
  s.queue('copy', 'beat');
  s.onBeat(6, 1000, 1);
  assert.equal(hits.at(-1)[0], 'kick');
});

test('one pending launch replaces, cancels, and reanchors to marked next bar', () => {
  const { sequence: s, hits } = engine();
  s.onBeat(20, 0, 1);
  assert.equal(s.snapshot().beat, 1);
  s.queue('a', 'bar');
  assert.equal(s.snapshot().queued.targetBeatId, 24);
  s.queue('b', 'bar');
  assert.equal(s.snapshot().queued.id, 'b');
  s.cancelQueue();
  s.onBeat(21, 100, 1);
  assert.equal(hits.length, 0);
  s.queue('a', 'beat');
  s.onBeat(22, 200, 1);
  s.queue('b', 'bar');
  s.markOne();
  assert.equal(s.snapshot().queued.targetBeatId, 23);
  s.onBeat(23, 300, 1);
  assert.deepEqual(hits, [['kick', 200, 1], ['snare', 300, 1]]);
  assert.equal(s.snapshot().beat, 1);
  assert.equal(s.snapshot().bar, 1);
  s.queue('a', 'bar');
  assert.equal(s.snapshot().queued.targetBeatId, 27);
});

test('marking bar origin keeps active pattern progression and resets invalidate both states', () => {
  const { sequence: s, hits } = engine();
  s.queue('a');
  s.onBeat(1, 100, 1);
  s.markOne();
  s.onBeat(2, 200, 1);
  assert.equal(s.snapshot().playing.positionBeat, 1);
  assert.equal(s.snapshot().beat, 1);
  s.onBeat(3, 300, 1);
  assert.equal(hits.at(-1)[0], 'snare');
  s.queue('b');
  s.onBeat(4, 400, 2);
  assert.equal(s.snapshot().playing, null);
  assert.equal(s.snapshot().queued, null);
  s.queue('a');
  s.reset(4);
  s.onBeat(5, 500, 3);
  assert.equal(hits.length, 2);
  s.queue('b', 'beat');
  s.stop();
  s.onBeat(6, 600, 3);
  assert.equal(hits.length, 2);
});

test('attached wrapper acknowledges endpoint commands and detaches without owning endpoint', async () => {
  const sent = [];
  const listeners = new Set();
  let disposed = false;
  const endpoint = { request: async (...args) => { sent.push(args); return 'ack'; },
    snapshot: () => ({ sampler: {}, sequencer: { status: 'ready' } }),
    subscribe: fn => { listeners.add(fn); fn(endpoint.snapshot()); return () => listeners.delete(fn); },
    dispose: () => { disposed = true; } };
  const s = new AudioSequencer({ endpoint });
  let state;
  s.subscribe(value => { state = value; });
  assert.equal(state.status, 'ready');
  assert.equal(await s.define({ id: 'p' }), 'ack');
  await s.queue('p');
  await s.cancelQueue();
  await s.markOne();
  await s.stopAll();
  assert.deepEqual(sent.map(item => item[0]), ['sequence.define', 'sequence.queue', 'sequence.cancel', 'sequence.markOne', 'performance.stopAll']);
  assert.deepEqual(sent[1][1], { patternId: 'p', quantize: 'bar' });
  assert.equal(s.snapshot().status, 'ready');
  s.dispose();
  assert.equal(disposed, false);
  assert.equal(listeners.size, 0);
  await assert.rejects(s.queue('p'), /disposed/);
});

test('per-slot recording arms and cues share bar origin and run before pattern hits', () => {
  const calls = [];
  const recording = new Set(['kick']);
  const s = new AudioSequenceEngine({
    hasSample: id => ['kick', 'snare'].includes(id),
    play: (...args) => calls.push(['play', ...args]),
    prepareRecording: id => calls.push(['prepare', id]),
    startRecording: (id, frame) => { recording.add(id); calls.push(['start', id, frame]); },
    stopRecording: (id, frame) => { recording.delete(id); calls.push(['stop', id, frame]); },
    isRecording: id => recording.has(id),
  });
  s.define({ id: 'p', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'kick', gain: .5 }] });
  s.onBeat(1, 100, 1);
  s.armRecording('kick', { action: 'stop' });
  s.armRecording('snare', { action: 'start' });
  s.cue('kick');
  s.cue('snare');
  s.cue('snare', { gain: .25 });
  assert.equal(s.snapshot().cues.length, 2, 'replacing one cue leaves other slots queued');
  assert.equal(s.snapshot().recordArms.length, 2);
  s.queue('p');
  assert.equal(s.snapshot().queued.targetBeatId, 5);
  s.markOne();
  assert(s.snapshot().recordArms.every(arm => arm.targetBeatId === 2));
  assert(s.snapshot().cues.every(cue => cue.targetBeatId === 2));
  assert.equal(s.snapshot().queued.targetBeatId, 2);
  s.onBeat(2, 200.5, 1);
  assert.deepEqual(calls, [['prepare', 'snare'], ['stop', 'kick', 200.5], ['start', 'snare', 200.5],
    ['play', 'kick', 200.5, 1], ['play', 'kick', 200.5, .5]]);
  assert.equal(s.snapshot().metadata.skippedEvents, 1, 'recording sample is not played as overdub');
  assert.equal(s.snapshot().cues.length, 0);
  assert.equal(s.snapshot().recordArms.length, 0);
  assert.throws(() => s.armRecording('snare', { action: 'start' }), /already recording/);
  assert.throws(() => s.cue('snare'), /Stop recording/);
  s.armRecording('snare', { action: 'stop', quantize: 'beat' });
  s.cue('kick', { quantize: 'beat' });
  s.cancelRecording('snare');
  s.cancelCue('kick');
  assert.equal(recording.has('snare'), true, 'cancel does not stop active recording');
  s.onBeat(3, 300, 1);
  assert.equal(calls.length, 5);
});

test('attached wrapper sends per-slot recording and playback commands', async () => {
  const sent = [];
  const endpoint = { request: async (...args) => sent.push(args), subscribe: () => () => {} };
  const s = new AudioSequencer({ endpoint });
  await s.armRecording('a', { action: 'start' });
  await s.cancelRecording('a');
  await s.cue('b', { quantize: 'beat', gain: .5 });
  await s.cancelCue('b');
  await s.stopSample('b', { quantize: 'beat' });
  assert.deepEqual(sent, [
    ['sequence.record', { sampleId: 'a', action: 'start', quantize: 'bar', maxSeconds: 30, loop: true }],
    ['sequence.recordCancel', { sampleId: 'a' }],
    ['sequence.cue', { sampleId: 'b', quantize: 'beat', gain: .5 }],
    ['sequence.cueCancel', { sampleId: 'b' }],
    ['sequence.sampleStop', { sampleId: 'b', quantize: 'beat' }],
  ]);
  s.dispose();
});
