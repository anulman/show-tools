import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSequenceEngine } from '../wasm-sequencer.ts';
import { SampleEngine, SampleRecorder } from '../../sampler/wasm-sampler.ts';
import { nativeApi, own } from './support/native-runtime.ts';

function engine(beatsPerBar = 4) {
  const sampler = own(new SampleEngine({ api: nativeApi, sampleRate: 8 }));
  sampler.load('kick', [Float32Array.from([1, 0])], 8);
  sampler.load('snare', [Float32Array.from([0.5, 0])], 8);
  const sequence = own(new AudioSequenceEngine({ sampler, beatsPerBar }));
  const hits = () => sampler.voices.filter(voice => voice.sample).sort((a, b) => a.serial - b.serial)
    .map(voice => [voice.sample.id, voice.frame, voice.gain]);
  sequence.define({ id: 'a', label: 'A', lengthBeats: 3, events: [
    { atBeat: 0, sampleId: 'kick' }, { atBeat: 2, sampleId: 'snare', gain: 0.5 } ] });
  sequence.define({ id: 'b', label: 'B', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'snare' }] });
  return { sequence, sampler, hits };
}

test('native whole-beat patterns use crossings once and copy validated definitions', () => {
  const { sequence: s, hits } = engine();
  s.queue('a', 'beat');
  s.onBeat(1, 100.25, 1);
  s.onBeat(1, 100.25, 1);
  assert.deepEqual(hits(), [['kick', 100.25, 1]]);
  s.onBeat(2, 400.75, 1);
  s.onBeat(3, 800.125, 1);
  assert.deepEqual(hits()[1], ['snare', 800.125, 0.5]);
  assert.equal(s.snapshot().playing.positionBeat, 2);
  s.onBeat(4, 900, 1);
  assert.equal(s.snapshot().status, 'ready');
  s.onBeat(5, 950, 1);
  assert.equal(hits().length, 2);
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
  assert.equal(hits().at(-1)[0], 'kick');
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
  assert.equal(hits().length, 0);
  s.queue('a', 'beat');
  s.onBeat(22, 200, 1);
  s.queue('b', 'bar');
  s.markOne();
  assert.equal(s.snapshot().queued.targetBeatId, 23);
  s.onBeat(23, 300, 1);
  assert.deepEqual(hits(), [['kick', 200, 1], ['snare', 300, 1]]);
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
  assert.equal(hits().at(-1)[0], 'snare');
  s.queue('b');
  s.onBeat(4, 400, 2);
  assert.equal(s.snapshot().playing, null);
  assert.equal(s.snapshot().queued, null);
  s.queue('a');
  s.reset(4);
  s.onBeat(5, 500, 3);
  assert.equal(hits().length, 2);
  s.queue('b', 'beat');
  s.stop();
  s.onBeat(6, 600, 3);
  assert.equal(hits().length, 2);
});

test('native recording arms commit before cues and recording channels skip playback', () => {
  const { sequence: s, sampler } = engine();
  const recorder = new SampleRecorder({ sampleRate: 8, sampler });
  recorder.prepare('kick');
  recorder.start('kick', 0);
  recorder.capture(Float32Array.from([0.25, 0.5]), 0, 2, 0);
  s.define({ id: 'p', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'kick', gain: .5 }] });
  s.onBeat(1, 100, 1);
  s.armRecording('kick', { action: 'stop', loop: false });
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
  assert.equal(recorder.isRecording('kick'), false);
  assert.equal(recorder.isRecording('snare'), true);
  assert.equal(recorder.slots.get('snare').startFrame, 201);
  assert.deepEqual(Array.from(sampler.sampleFor('kick').channels[0].subarray(0, 2)), [0.25, 0.5]);
  const voices = sampler.voices.filter(voice => voice.sample);
  assert.deepEqual(voices.map(voice => [voice.sample.id, voice.frame, voice.gain]), [['kick', 200.5, 1], ['kick', 200.5, .5]]);
  assert.equal(s.snapshot().metadata.skippedEvents, 1, 'recording sample is not played as overdub');
  assert.equal(s.snapshot().cues.length, 0);
  assert.equal(s.snapshot().recordArms.length, 0);
  const mixed = [new Float32Array(4)];
  sampler.render(mixed, 201, 0, 4);
  assert.deepEqual(Array.from(mixed[0]), [0.5625, 0.375, 0, 0], 'cue and pattern use the newly committed PCM at the same crossing');
  assert.throws(() => s.armRecording('snare', { action: 'start' }), /already recording/);
  assert.throws(() => s.cue('snare'), /Stop recording/);
  s.armRecording('snare', { action: 'stop', quantize: 'beat' });
  s.cue('kick', { quantize: 'beat' });
  s.cancelRecording('snare');
  s.cancelCue('kick');
  assert.equal(recorder.isRecording('snare'), true, 'cancel does not stop active recording');
  s.onBeat(3, 300, 1);
  assert.equal(s.snapshot().metadata.playedEvents, 2);
});

test('redefining a pattern keeps active and queued definitions immutable', () => {
  const { sequence: s, hits } = engine();
  s.queue('a', 'beat');
  s.define({ id: 'a', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'snare' }] });
  s.onBeat(1, 100, 1);
  assert.deepEqual(hits(), [['kick', 100, 1]], 'queued launch retains the definition it selected');
  s.onBeat(2, 200, 1);
  s.onBeat(3, 300, 1);
  assert.deepEqual(hits().at(-1), ['snare', 300, 0.5], 'active progression retains the original final event');
  s.queue('a', 'beat');
  s.onBeat(4, 400, 1);
  assert.deepEqual(hits().at(-1), ['snare', 400, 1], 'a later launch selects the replacement definition');
});

test('malformed replacement definitions leave the queued pattern intact', () => {
  const { sequence: s, hits } = engine();
  s.queue('a', 'beat');
  for (const replacement of [
    { id: 'a', label: null, lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'snare' }] },
    { id: 'a', lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'snare', gain: null }] },
    { id: 'a', lengthBeats: 1.25, events: [{ atBeat: 0, sampleId: 'snare' }] },
  ]) assert.throws(() => s.define(replacement));
  s.onBeat(1, 100, 1);
  assert.deepEqual(hits(), [['kick', 100, 1]]);
  assert.equal(s.snapshot().playing.label, 'A');
});
