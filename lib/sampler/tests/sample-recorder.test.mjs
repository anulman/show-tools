import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleEngine } from '../sample-engine.js';
import { SampleRecorder } from '../sample-recorder.js';

function runtime(options = {}) {
  const engine = new SampleEngine({ sampleRate: 8 });
  const recorder = new SampleRecorder({ sampleRate: 8, sampler: engine, ...options });
  return { engine, recorder };
}

function play(engine, id, frame, length) {
  const output = [new Float32Array(length)];
  engine.trigger(id, frame);
  engine.render(output, frame, 0, length);
  return Array.from(output[0]);
}

test('capture selects input ramp frames at ceil start and exclusive ceil stop boundaries', () => {
  const { engine, recorder } = runtime();
  const input = Float32Array.from({ length: 12 }, (_, index) => index + 100);
  recorder.prepare('a');
  recorder.start('a', 2.25);
  recorder.capture(input, 0, 3, 0);
  recorder.capture(input, 3, 5, 3);
  recorder.stop('a', 7.25);
  assert.deepEqual(recorder.snapshot(), [{ id: 'a', recording: false, frames: 5,
    duration: 5 / 8, maxSeconds: 30, peak: 107, reason: 'stopped' }]);
  assert.deepEqual(play(engine, 'a', 8, 7), [103, 104, 105, 106, 107, 0, 0]);
});

test('a completed take installs without validated-load scans and stops at its duration limit', () => {
  const { engine, recorder } = runtime();
  recorder.prepare('a', { maxSeconds: 0.5 });
  recorder.start('a', 0);
  engine.load = () => { throw new Error('Captured input must use trusted installation'); };
  recorder.capture(new Float32Array([1, 2, 3, 4, 5, 6]), 0, 6, 0);
  assert.equal(recorder.isRecording('a'), false);
  assert.equal(recorder.snapshot()[0].reason, 'limit');
  assert.equal(engine.snapshot().samples[0].length, 4);
  assert.deepEqual(play(engine, 'a', 6, 6), [1, 2, 3, 4, 0, 0]);
});

test('previous sample survives preparation, recording, and an empty take', () => {
  const { engine, recorder } = runtime();
  engine.load('a', [new Float32Array([0.75, 0.25])], 8);
  recorder.prepare('a');
  assert.deepEqual(play(engine, 'a', 0, 2), [0.75, 0.25]);
  recorder.start('a', 2);
  recorder.stop('a', 2);
  assert.deepEqual(play(engine, 'a', 2, 2), [0.75, 0.25]);
  recorder.prepare('a');
  recorder.start('a', 4);
  assert.deepEqual(play(engine, 'a', 4, 2), [0.75, 0.25]);
  recorder.capture(new Float32Array([-0.5]), 0, 1, 4);
  recorder.stop('a', 5);
  assert.deepEqual(play(engine, 'a', 6, 2), [-0.5, 0]);
});

test('Stop All commits every active slot and empty slots remain unplayable', () => {
  const { engine, recorder } = runtime();
  recorder.prepare('a');
  recorder.prepare('b');
  recorder.prepare('empty');
  assert.equal(engine.has('empty'), false);
  assert.equal(engine.snapshot().samples.length, 0);
  recorder.start('a', 0);
  recorder.start('b', 1);
  recorder.start('empty', 10);
  recorder.capture(new Float32Array([0.25, 0.5, 0.75]), 0, 3, 0);
  recorder.stopAll('panic');
  assert.equal(recorder.snapshot().every(slot => !slot.recording), true);
  assert.equal(engine.has('empty'), false);
  assert.deepEqual(play(engine, 'a', 3, 4), [0.25, 0.5, 0.75, 0]);
  assert.deepEqual(play(engine, 'b', 7, 3), [0.5, 0.75, 0]);
  assert.equal(recorder.snapshot()[0].reason, 'panic');
});

test('capture sanitizes nonfinite input once and missing input becomes finite silence', () => {
  const { engine, recorder } = runtime();
  recorder.prepare('a');
  recorder.start('a', -2);
  recorder.capture(new Float32Array([NaN, Infinity, -Infinity, -0.5]), 0, 4, 0);
  recorder.capture(null, 0, 2, 4);
  recorder.stop('a', 6);
  assert.deepEqual(play(engine, 'a', 6, 8), [0, 0, 0, -0.5, 0, 0, 0, 0]);
  assert.equal(recorder.snapshot()[0].peak, 0.5);
});

test('recording control validates bounds, duplicate starts and slot capacity', () => {
  const { engine, recorder } = runtime({ maxSlots: 1 });
  assert.throws(() => recorder.prepare('a', { maxSeconds: 31 }), /Recording limit/);
  assert.throws(() => recorder.prepare('a', { maxSeconds: -1 }), /Recording limit/);
  assert.throws(() => recorder.start('missing', 0), /not prepared/);
  recorder.prepare('a');
  assert.throws(() => recorder.prepare('b'), /slot limit/);
  recorder.start('a', 0);
  assert.throws(() => recorder.start('a', 0), /already recording/);
  assert.throws(() => recorder.prepare('a'), /already recording/);
  assert.throws(() => recorder.stop('a', NaN), /stop frame/);
  recorder.stop('missing', 0);
  assert.equal(engine.has('a'), false);
});

test('commit-and-arm preserves the playing take while its preallocated replacement captures input', () => {
  const { engine, recorder } = runtime({ maxSlots: 1 });
  recorder.prepare('a', { maxSeconds: 1 });
  recorder.start('a', 0);
  recorder.capture(Float32Array.from([0.25, 0.5]), 0, 2, 0);
  const first = recorder.slots.get('a');
  recorder.prepareNext('a', { maxSeconds: 0.5 });
  const replacement = recorder.nextSlots.get('a');
  assert.equal(recorder.slots.get('a'), first);
  assert.equal(recorder.isRecording('a'), true);
  assert.notEqual(replacement.buffer, first.buffer);
  assert.throws(() => recorder.startNext('a', 2), /Commit recording/);
  recorder.capture(Float32Array.from([0.75, 1]), 0, 2, 2);
  assert.equal(recorder.stop('a', 4), true);
  engine.trigger('a', 4, 1, { loop: true });
  const NativeFloat32Array = globalThis.Float32Array;
  globalThis.Float32Array = new Proxy(NativeFloat32Array, {
    construct() { throw new Error('The musical boundary cannot allocate a recording buffer'); },
  });
  try { recorder.startNext('a', 4); }
  finally { globalThis.Float32Array = NativeFloat32Array; }
  assert.equal(recorder.slots.get('a'), replacement);
  assert.equal(recorder.slots.size, 1);
  assert.equal(recorder.nextSlots.size, 0);
  recorder.capture(Float32Array.from([-0.25, -0.5]), 0, 2, 4);
  const playing = [new Float32Array(2)];
  engine.render(playing, 4, 0, 2);
  assert.deepEqual(Array.from(playing[0]), [0.25, 0.5]);
  assert.deepEqual(Array.from(first.buffer.subarray(0, 4)), [0.25, 0.5, 0.75, 1]);
  assert.equal(recorder.stop('a', 6), true);
  engine.trigger('a', 6, 1, { loop: true });
  const replaced = [new Float32Array(4)];
  engine.render(replaced, 6, 0, 4);
  assert.deepEqual(Array.from(replaced[0]), [-0.25, -0.5, -0.25, -0.5]);
  assert.equal(engine.snapshot().activeVoices, 1);
});

test('canceling a next take or stopping all captures prevents it from starting later', () => {
  for (const cancel of ['cancelNext', 'stopAll']) {
    const { recorder } = runtime();
    recorder.prepare('a');
    recorder.start('a', 0);
    recorder.capture(new Float32Array([0.25]), 0, 1, 0);
    recorder.prepareNext('a');
    recorder[cancel]('a');
    recorder.stop('a', 1);
    assert.throws(() => recorder.startNext('a', 1), /Next recording slot is not prepared/);
    assert.equal(recorder.isRecording('a'), false);
    assert.equal(recorder.nextSlots.size, 0);
  }
});

test('replacement buffers validate duration and require an existing slot', () => {
  const { recorder } = runtime({ maxSlots: 1 });
  assert.throws(() => recorder.prepareNext('missing'), /not prepared/);
  recorder.prepare('a');
  recorder.prepareNext('a', { maxSeconds: 1 });
  const replacement = recorder.nextSlots.get('a');
  for (const maxSeconds of [0, NaN, 31, 0.01]) {
    assert.throws(() => recorder.prepareNext('a', { maxSeconds }), /Recording limit/);
    assert.equal(recorder.nextSlots.get('a'), replacement);
  }
  assert.throws(() => recorder.startNext('a', NaN), /start frame/);
  assert.equal(recorder.nextSlots.get('a'), replacement);
  recorder.prepare('a');
  assert.throws(() => recorder.startNext('a', 0), /Next recording slot is not prepared/);
});

test('captured late hits trim to the first audible frame without changing loop timing', () => {
  const { engine, recorder } = runtime();
  recorder.prepare('cowbell');
  recorder.start('cowbell', 2);
  recorder.capture(Float32Array.from([1, 1, 0, 0.004, 0]), 0, 5, 0);
  recorder.capture(Float32Array.from([-0.75, 0.25, 0]), 0, 3, 5);
  recorder.stop('cowbell', 8);
  assert.equal(recorder.slots.get('cowbell').sample.onsetFrame, 3);
  engine.trigger('cowbell', 8, 1, { loop: true });
  const loop = [new Float32Array(12)];
  engine.render(loop, 8, 0, 12);
  const cycle = [0, Math.fround(0.004), 0, -0.75, 0.25, 0];
  assert.deepEqual(Array.from(loop[0]), [...cycle, ...cycle]);
  engine.stopAll();
  engine.trigger('cowbell', 20, 1, { trimStart: true });
  const hit = [new Float32Array(5)];
  engine.render(hit, 20, 0, 5);
  assert.deepEqual(Array.from(hit[0]), [-0.75, 0.25, 0, 0, 0]);
});

test('replacement takes own their onset metadata and silence defaults to frame zero', () => {
  const { engine, recorder } = runtime();
  recorder.prepare('a');
  recorder.start('a', 0);
  recorder.capture(Float32Array.from([0, 0, 0.75]), 0, 3, 0);
  recorder.prepareNext('a');
  recorder.stop('a', 3);
  const first = recorder.slots.get('a').sample;
  engine.trigger('a', 3, 1, { trimStart: true });
  recorder.startNext('a', 3);
  recorder.capture(Float32Array.from([0, -0.5, 0]), 0, 3, 3);
  recorder.stop('a', 6);
  const replacement = recorder.slots.get('a').sample;
  assert.equal(first.onsetFrame, 2);
  assert.equal(replacement.onsetFrame, 1);
  assert.equal(engine.voices[0].sample, first);
  assert.equal(engine.voices[0].sourceOffset, 2);
  recorder.prepareNext('a');
  recorder.startNext('a', 6);
  recorder.capture(null, 0, 3, 6);
  recorder.stop('a', 9);
  assert.equal(recorder.slots.get('a').sample.onsetFrame, 0);
  engine.stopAll();
  engine.trigger('a', 9, 1, { trimStart: true });
  const silence = [new Float32Array(4)];
  engine.render(silence, 9, 0, 4);
  assert.deepEqual(Array.from(silence[0]), [0, 0, 0, 0]);
  assert.equal(engine.snapshot().activeVoices, 0);
});

test('truncating a take before its audible onset leaves a playable silent take', () => {
  const { engine, recorder } = runtime();
  recorder.prepare('a');
  recorder.start('a', 0);
  recorder.capture(Float32Array.from([0, 0, 1]), 0, 3, 0);
  recorder.stop('a', 2);
  assert.equal(recorder.slots.get('a').sample.onsetFrame, 0);
  engine.trigger('a', 3, 1, { trimStart: true });
  const output = [new Float32Array(3)];
  engine.render(output, 3, 0, 3);
  assert.deepEqual(Array.from(output[0]), [0, 0, 0]);
});

test('hinted capture selects two late hits despite quiet noise and quantizes sparse loop playback', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  const pcm = new Float32Array(16000).fill(0.001);
  pcm[2000] = 0.9;
  for (const [start, amplitude] of [[14010, 0.6], [14990, 0.3]]) {
    for (let frame = 0; frame < 600; frame++) pcm[start + frame] += amplitude * Math.exp(-frame / 200) * Math.cos(frame * 0.7);
  }
  recorder.prepare('bell', { maxSeconds: 2, transients: { expectedFrames: [14000, 15000], radiusFrames: 600 } });
  recorder.start('bell', 0);
  for (let frame = 0; frame < pcm.length; frame += 128) recorder.capture(pcm, frame, Math.min(128, pcm.length - frame), frame);
  assert.equal(engine.hasSlice('bell', 0), true);
  assert.equal(engine.hasSlice('bell', 1), true);
  const recorded = engine.samples.get('bell');
  assert.deepEqual(recorded.slices.map(slice => [slice.startFrame, slice.targetFrame]), [[14010, 14000], [14990, 15000]]);
  assert(recorded.slices[0].endFrame <= 14610);
  assert(recorded.slices[1].endFrame <= 15590);
  assert.deepEqual(recorded.channels[0], pcm);
  const output = [new Float32Array(1200)];
  engine.trigger('bell', 16000, 1, { slice: 0 });
  engine.render(output, 16000, 0, 1200);
  assert.equal(output[0][0], pcm[14010]);
  assert(output[0].subarray(980).every(value => value === 0), 'first hit cannot include the second attack');
  output[0].fill(0);
  engine.trigger('bell', 17200, 1, { slice: 1 });
  engine.render(output, 17200, 0, 1200);
  assert.equal(output[0][0], pcm[14990]);
  output[0].fill(0);
  engine.trigger('bell', 18400, 1, { loop: true });
  engine.render(output, 18400, 0, 1200);
  assert(output[0].every(value => value === 0), 'sparse loop excludes background noise');
  const loop = [new Float32Array(14801)];
  engine.render(loop, 19600, 0, loop[0].length);
  assert.equal(loop[0][14000 - 1200], pcm[14010], 'first hit snaps to expected grid position');
  assert.equal(loop[0][15000 - 1200], pcm[14990], 'second hit snaps independently');
  assert.equal(loop[0][2000 - 1200], 0, 'earlier unrelated hit is excluded');
});

test('missing hinted hits retain their ordinal and never substitute a neighbouring tail', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 2, transients: { expectedFrames: [14000, 15000], radiusFrames: 600 } });
  recorder.start('bell', 0);
  const pcm = new Float32Array(16000).fill(0.002);
  pcm[15010] = 0.5;
  recorder.capture(pcm, 0, pcm.length, 0);
  assert.equal(engine.hasSlice('bell', 0), false);
  assert.equal(engine.hasSlice('bell', 1), true);
  assert.throws(() => engine.trigger('bell', 16000, 1, { slice: 0 }), /hit 1 is missing/);
  assert.throws(() => engine.trigger('bell', 16000, 1, { slice: 1, loop: true }), /cannot loop/);
  assert.equal(engine.triggeredVoices, 0);
});

test('a ringing first hit does not become a second hinted attack', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 2, transients: { expectedFrames: [14000, 15000], radiusFrames: 600 } });
  recorder.start('bell', 0);
  const pcm = new Float32Array(16000);
  for (let frame = 14000; frame < 16000; frame++) pcm[frame] = 0.5 * Math.exp(-(frame - 14000) / 1500) * Math.cos((frame - 14000) * 0.7);
  recorder.capture(pcm, 0, pcm.length, 0);
  assert.equal(engine.hasSlice('bell', 0), true);
  assert.equal(engine.hasSlice('bell', 1), false);
  assert.equal(engine.samples.get('bell').slices[0].endFrame, 14500);
});

test('replacement captures receive their own hint metadata and reject malformed hints', () => {
  const { engine, recorder } = runtime();
  for (const transients of [{ expectedFrames: [], radiusFrames: 1 }, { expectedFrames: [2, 1], radiusFrames: 1 },
    { expectedFrames: [1], radiusFrames: 0 }, { expectedFrames: [NaN], radiusFrames: 1 }]) {
    assert.throws(() => recorder.prepare('a', { transients }), /[Tt]ransient/);
  }
  recorder.prepare('a');
  recorder.start('a', 0);
  recorder.prepareNext('a', { transients: { expectedFrames: [2], radiusFrames: 1 } });
  recorder.capture(Float32Array.from([0.5, 0.5]), 0, 2, 0);
  recorder.stop('a', 2);
  recorder.startNext('a', 2);
  recorder.capture(Float32Array.from([0, 0, 0.4, 0]), 0, 4, 2);
  recorder.stop('a', 6);
  assert.equal(engine.hasSlice('a', 0), true);
  assert.equal(engine.samples.get('a').slices[0].startFrame, 2);
});


test('single-hit sparse capture excludes early and late bleed and loops its quantized sound only', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('single', { maxSeconds: 0.2, transients: { expectedFrames: [500], radiusFrames: 100 } });
  recorder.start('single', 0);
  const pcm = new Float32Array(1600).fill(0.001);
  pcm[20] = 0.8;
  pcm.fill(0.4, 510, 530);
  pcm[1000] = 0.9;
  recorder.capture(pcm, 0, pcm.length, 0);
  assert.equal(engine.sliceSlots('single'), 1);
  assert.deepEqual(engine.samples.get('single').slices, [{ startFrame: 510, endFrame: 530, targetFrame: 500 }]);
  const output = [new Float32Array(3200)];
  engine.trigger('single', 1600, 1, { loop: true });
  engine.render(output, 1600, 0, 3200);
  const expected = new Float32Array(3200);
  expected.fill(0.4, 500, 520);
  expected.fill(0.4, 2100, 2120);
  assert.deepEqual(output[0], expected);
});

test('single sparse hits stop when their decay returns to steady room noise', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 1, transients: { expectedFrames: [100], radiusFrames: 20 } });
  recorder.start('bell', 0);
  const pcm = new Float32Array(8000).fill(0.02);
  pcm.fill(0.5, 100, 108);
  recorder.capture(pcm, 0, pcm.length, 0);
  engine.trigger('bell', 8000, 1, { slice: 0 });
  const hit = [new Float32Array(8000)];
  engine.render(hit, 8000, 0, 8000);
  assert(hit[0].subarray(0, 8).every(value => value === 0.5));
  assert(hit[0].subarray(8).every(value => value === 0), 'room noise after the hit is not part of the extracted clip');
  engine.trigger('bell', 16000, 1, { loop: true });
  const loop = [new Float32Array(16000)];
  engine.render(loop, 16000, 0, loop[0].length);
  const expected = new Float32Array(16000);
  expected.fill(0.5, 100, 108);
  expected.fill(0.5, 8100, 8108);
  assert.deepEqual(loop[0], expected);
});

test('sparse pairs use the background near each hit and keep their audible decays', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 1, transients: { expectedFrames: [1000, 4000], radiusFrames: 100 } });
  recorder.start('bell', 0);
  const pcm = Float32Array.from({ length: 8000 }, (_, frame) => (frame < 3000 ? 0.02 : 0.03) + 0.004 * Math.sin(frame * 0.7));
  for (const [start, amplitude] of [[1000, 0.6], [4000, 0.3]]) {
    for (let frame = 0; frame < 700; frame++) pcm[start + frame] += amplitude * Math.exp(-frame / 100) * Math.cos(frame * 0.7);
  }
  for (let frame = 0; frame < pcm.length; frame += 127) recorder.capture(pcm, frame, Math.min(127, pcm.length - frame), frame);
  for (const [index, start] of [[0, 1000], [1, 4000]]) {
    assert.equal(engine.hasSlice('bell', index), true);
    engine.trigger('bell', 8000 + index * 1000, 1, { slice: index });
    const hit = [new Float32Array(1000)];
    engine.render(hit, 8000 + index * 1000, 0, hit[0].length);
    assert.equal(hit[0][0], pcm[start]);
    assert.equal(hit[0][50], pcm[start + 50], 'the audible ringing decay is retained');
    assert(hit[0].subarray(700).every(value => value === 0), 'neither extracted hit includes the following background');
  }
});

test('ordinary room-noise variation alone does not fill missing sparse hit slots', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 1, transients: { expectedFrames: [1000, 4000], radiusFrames: 100 } });
  recorder.start('bell', 0);
  const pcm = Float32Array.from({ length: 8000 }, (_, frame) => 0.02 + 0.004 * Math.sin(frame * 0.7));
  recorder.capture(pcm, 0, pcm.length, 0);
  assert.equal(engine.hasSlice('bell', 0), false);
  assert.equal(engine.hasSlice('bell', 1), false);
  engine.trigger('bell', 8000, 1, { loop: true });
  const loop = [new Float32Array(8000)];
  engine.render(loop, 8000, 0, loop[0].length);
  assert(loop[0].every(value => value === 0));
});

test('a replacement single keeps a retained pair available for later taps on the same mixer channel', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 0.2, transients: { key: 'pair', expectedFrames: [500, 1000], radiusFrames: 50 } });
  recorder.start('bell', 0);
  recorder.prepareNext('bell', { maxSeconds: 0.2, transients: { key: 'single', expectedFrames: [500], radiusFrames: 50 } });
  const pair = new Float32Array(1600);
  pair.fill(0.5, 510, 530);
  pair.fill(0.25, 990, 1010);
  recorder.capture(pair, 0, pair.length, 0);
  recorder.stop('bell', 1600);
  recorder.startNext('bell', 1600);
  const single = new Float32Array(1600);
  single.fill(0.75, 505, 525);
  recorder.capture(single, 0, single.length, 1600);
  recorder.stop('bell', 3200);
  assert.equal(engine.sliceSlots('bell'), 1);
  assert.equal(engine.sliceSlots('bell', 'pair'), 2);
  assert.equal(engine.hasVariant('bell', 'single'), true);
  assert.equal(engine.hasSlice('bell', 1, 'single'), false);
  const output = [new Float32Array(1600)];
  engine.trigger('bell', 3200, 1, { loop: true });
  engine.render(output, 3200, 0, 1600);
  assert.equal(output[0][500], 0.75);
  assert.equal(output[0][1000], 0);
  engine.stopAll();
  engine.setChannel('bell', { gain: 0.5 });
  const hit = [new Float32Array(1)];
  engine.trigger('bell', 4800, 1, { variant: 'pair', slice: 0 });
  engine.render(hit, 4800, 0, 1);
  assert.equal(hit[0][0], 0.25);
  hit[0].fill(0);
  engine.trigger('bell', 4801, 1, { variant: 'pair', slice: 1 });
  engine.render(hit, 4801, 0, 1);
  assert.equal(hit[0][0], 0.375, 'both overlapping retained hits use the same channel gain');
  engine.setChannel('bell', { muted: true });
  hit[0].fill(0);
  engine.render(hit, 4802, 0, 1);
  assert.equal(hit[0][0], 0);
  engine.load('bell', [Float32Array.from([0.2])], sampleRate);
  assert.equal(engine.hasVariant('bell', 'pair'), false);
  assert.equal(engine.hasVariant('bell', 'single'), false);
  assert.equal(engine.sliceSlots('bell', 'pair'), 0);
  assert.throws(() => engine.trigger('bell', 4803, 1, { variant: 'pair', slice: 1 }), /Unknown sample/);
});

test('retained capture variant reservations are bounded and malformed keys leave captures unprepared', () => {
  const { engine, recorder } = runtime();
  for (let index = 0; index < 16; index++) engine.prepareCapture('bell', `variant-${index}`);
  assert.throws(() => engine.prepareCapture('bell', 'overflow'), /variant limit/);
  engine.prepareCapture('bell', 'variant-0');
  for (const key of ['', ' ', 123, 'x'.repeat(129)]) {
    assert.throws(() => recorder.prepare('invalid', { transients: { key, expectedFrames: [1], radiusFrames: 1 } }), /variant key/);
    assert.equal(recorder.slots.has('invalid'), false);
  }
});

test('a missing hit in a retained variant stays silent and never falls back to the current take', () => {
  const sampleRate = 8000;
  const engine = new SampleEngine({ sampleRate });
  const recorder = new SampleRecorder({ sampleRate, sampler: engine });
  recorder.prepare('bell', { maxSeconds: 0.2, transients: { key: 'pair', expectedFrames: [500, 1000], radiusFrames: 50 } });
  recorder.start('bell', 0);
  const pcm = new Float32Array(1600);
  pcm[1000] = 0.5;
  recorder.capture(pcm, 0, pcm.length, 0);
  assert.equal(engine.hasVariant('bell', 'pair'), true);
  assert.equal(engine.hasSlice('bell', 0, 'pair'), false);
  assert.equal(engine.hasSlice('bell', 1, 'pair'), true);
  assert.throws(() => engine.trigger('bell', 1600, 1, { variant: 'pair', slice: 0 }), /hit 1 is missing/);
  const output = [new Float32Array(1600)];
  engine.trigger('bell', 1600, 1, { variant: 'pair', loop: true });
  engine.render(output, 1600, 0, output[0].length);
  assert.equal(output[0][500], 0);
  assert.equal(output[0][1000], 0.5);
});

test('quiet whole-bar pair and single takes retain all PCM and loop without extraction', () => {
  const { engine, recorder } = runtime();
  const pair = new Float32Array(16);
  pair[14] = 0.001;
  pair[15] = 0.002;
  const single = new Float32Array(16);
  single[14] = 0.003;
  recorder.prepare('bell', { maxSeconds: 3, variantKey: 'pair' });
  recorder.start('bell', 0);
  recorder.prepareNext('bell', { maxSeconds: 3, variantKey: 'single' });
  recorder.capture(pair, 0, pair.length, 0);
  recorder.stop('bell', 16);
  recorder.startNext('bell', 16);
  recorder.capture(single, 0, single.length, 16);
  recorder.stop('bell', 32);
  assert.equal(engine.hasVariant('bell', 'pair'), true);
  assert.equal(engine.hasVariant('bell', 'single'), true);
  assert.equal(engine.sliceSlots('bell', 'pair'), 0);
  assert.equal(engine.sliceSlots('bell', 'single'), 0);
  assert.equal(recorder.slots.get('bell').windows.length, 0);

  const replay = [new Float32Array(32)];
  engine.trigger('bell', 32, 1, { variant: 'pair', loop: true });
  engine.render(replay, 32, 0, replay[0].length);
  assert.deepEqual(replay[0].subarray(0, 16), pair);
  assert.deepEqual(replay[0].subarray(16), pair);
  engine.stopAll();
  replay[0].fill(0);
  engine.trigger('bell', 64, 1, { loop: true });
  engine.render(replay, 64, 0, replay[0].length);
  assert.deepEqual(replay[0].subarray(0, 16), single);
  assert.deepEqual(replay[0].subarray(16), single);
});

test('whole-bar variant keys validate before replacing prepared slots', () => {
  const { recorder } = runtime();
  recorder.prepare('bell', { variantKey: 'pair' });
  const prepared = recorder.slots.get('bell');
  const conflicting = { variantKey: 'single', transients: { key: 'pair', expectedFrames: [1], radiusFrames: 1 } };
  assert.throws(() => recorder.prepare('bell', conflicting), /keys must match/);
  assert.equal(recorder.slots.get('bell'), prepared);
  assert.throws(() => recorder.prepareNext('bell', conflicting), /keys must match/);
  assert.equal(recorder.nextSlots.has('bell'), false);
  for (const variantKey of ['', ' ', 123, 'x'.repeat(129)]) {
    assert.throws(() => recorder.prepare('invalid', { variantKey }), /variant key/);
    assert.equal(recorder.slots.has('invalid'), false);
  }
});
