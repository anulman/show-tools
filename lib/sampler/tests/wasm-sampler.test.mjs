import test from 'node:test';
import assert from 'node:assert/strict';
import { SampleEngine, SampleRecorder, samplerMemory } from './support/wasm-runtime.ts';

test('failed capture preparation and loads do not consume channel or variant names', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  const recorder = new SampleRecorder({ sampleRate: 8, sampler });
  for (let index = 0; index < 40; index++) {
    assert.throws(() => sampler.load(`invalid-${index}`, [Float32Array.from([NaN])], 8), /finite/);
    assert.throws(() => recorder.prepare(`invalid-${index}`, { transients: { key: 'invalid', expectedFrames: [999], radiusFrames: 1 } }), /ordered/);
  }
  for (let index = 0; index < 20; index++) {
    assert.throws(() => recorder.prepare('bell', { transients: { key: `bad-${index}`, expectedFrames: [999], radiusFrames: 1 } }), /ordered/);
  }
  recorder.prepare('bell', { variantKey: 'valid' });
  recorder.start('bell', 0);
  recorder.capture(Float32Array.from([0.5]), 0, 1, 0);
  recorder.stop('bell', 1);
  assert(sampler.hasVariant('bell', 'valid'));
});

test('the bridge rejects numeric coercion before passing commands to WASM', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  sampler.load('voice', [Float32Array.from([0.5])], 8);
  const recorder = new SampleRecorder({ sampleRate: 8, sampler });
  recorder.prepare('voice');
  for (const value of ['1', true, null]) {
    assert.throws(() => sampler.trigger('voice', value), /frame/);
    assert.throws(() => sampler.trigger('voice', 0, value), /gain/);
    assert.throws(() => sampler.setVolume(value), /volume/);
    assert.throws(() => sampler.setChannel('voice', { gain: value }), /gain/);
    assert.throws(() => recorder.start('voice', value), /frame/);
    assert.throws(() => recorder.prepare('voice', { transients: { expectedFrames: [value], radiusFrames: 1 } }), /recording frames/);
  }
  assert.equal(sampler.snapshot().activeVoices, 0);
});

test('loaded sample PCM belongs to WASM and survives mutation of the upload buffer', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  assert.equal(sampler.snapshot().metadata.backend, 'cpp-wasm');
  const left = Float32Array.from([0.25, 0.5, 0.75]);
  const right = Float32Array.from([-0.25, -0.5, -0.75]);
  sampler.load('voice', [left, right], 8);
  const stored = sampler.sampleFor('voice');
  assert.equal(stored.channels[0].buffer, samplerMemory.buffer);
  assert.equal(stored.channels[1].buffer, samplerMemory.buffer);
  assert.notEqual(stored.channels[0].buffer, left.buffer);
  left.fill(0);
  right.fill(0);
  sampler.trigger('voice', 0);
  const output = [new Float32Array(4), new Float32Array(4)];
  sampler.render(output, 0, 0, 4);
  assert.deepEqual(Array.from(output[0]), [0.25, 0.5, 0.75, 0]);
  assert.deepEqual(Array.from(output[1]), [-0.25, -0.5, -0.75, 0]);
});

test('native capture owns its buffer and replaces a take without rewriting a playing voice', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  const recorder = new SampleRecorder({ sampleRate: 8, sampler });
  recorder.prepare('voice', { maxSeconds: 1 });
  const prepared = recorder.slots.get('voice');
  assert.equal(prepared.buffer.buffer, samplerMemory.buffer);
  recorder.start('voice', 0);
  const input = Float32Array.from([0.25, 0.5, 0.75, 1]);
  recorder.capture(input, 0, input.length, 0);
  input.fill(0);
  recorder.prepareNext('voice', { maxSeconds: 1 });
  recorder.stop('voice', 4);
  sampler.trigger('voice', 4, 1, { loop: true });
  recorder.startNext('voice', 4);
  recorder.capture(Float32Array.from([-0.5, -0.25]), 0, 2, 4);
  recorder.stop('voice', 6);
  const current = sampler.sampleFor('voice');
  assert.notEqual(current.channels[0].byteOffset, prepared.buffer.byteOffset);
  const playing = [new Float32Array(4)];
  sampler.render(playing, 4, 0, 4);
  assert.deepEqual(Array.from(playing[0]), [0.25, 0.5, 0.75, 1]);
  sampler.trigger('voice', 8, 1, { loop: true });
  const replaced = [new Float32Array(4)];
  sampler.render(replaced, 8, 0, 4);
  assert.deepEqual(Array.from(replaced[0]), [-0.5, -0.25, -0.5, -0.25]);
});

test('invalid native replacement leaves stored PCM and playback unchanged', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  sampler.load('voice', [Float32Array.from([0.25, 0.5])], 8);
  const before = sampler.sampleFor('voice').channels[0].byteOffset;
  assert.throws(() => sampler.load('voice', [Float32Array.from([NaN])], 8), /finite/);
  assert.equal(sampler.sampleFor('voice').channels[0].byteOffset, before);
  sampler.trigger('voice', 0, 1, { loop: true });
  const output = [new Float32Array(4)];
  sampler.render(output, 0, 0, 4);
  assert.deepEqual(Array.from(output[0]), [0.25, 0.5, 0.25, 0.5]);
});

test('the highest native channel commits its duration limit through the unsigned WASM mask', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  const recorder = new SampleRecorder({ sampleRate: 8, sampler });
  for (let channel = 0; channel < 32; channel++) sampler.prepareCapture(`channel-${channel}`);
  recorder.prepare('channel-31', { maxSeconds: 0.125 });
  recorder.start('channel-31', 0);
  recorder.capture(Float32Array.from([0.75]), 0, 1, 0);
  assert.equal(recorder.snapshot()[0].reason, 'limit');
  assert.equal(recorder.isRecording('channel-31'), false);
  sampler.trigger('channel-31', 1);
  const output = [new Float32Array(1)];
  sampler.render(output, 1, 0, 1);
  assert.equal(output[0][0], 0.75);
});

test('short microphone blocks capture silence instead of stale staging-buffer PCM', () => {
  const sampler = new SampleEngine({ sampleRate: 8 });
  const recorder = new SampleRecorder({ sampleRate: 8, sampler });
  recorder.prepare('voice', { maxSeconds: 2 });
  recorder.start('voice', 0);
  recorder.capture(Float32Array.from([1, 2, 3, 4]), 0, 4, 0);
  recorder.capture(Float32Array.from([5]), 0, 4, 4);
  recorder.stop('voice', 8);
  sampler.trigger('voice', 8);
  const output = [new Float32Array(8)];
  sampler.render(output, 8, 0, 8);
  assert.deepEqual(Array.from(output[0]), [1, 2, 3, 4, 5, 0, 0, 0]);
});

test('fixed WASM heap exhaustion rejects capture preparation without losing prior audio', () => {
  const sampler = new SampleEngine({ sampleRate: 48000 });
  const recorder = new SampleRecorder({ sampleRate: 48000, sampler });
  sampler.load('baseline', [Float32Array.from([0.25, 0.5])], 48000);
  const bytes = samplerMemory.buffer.byteLength;
  let allocationError;
  let frame = 0;
  for (let channel = 0; channel < 8 && !allocationError; channel++) {
    for (let variant = 0; variant < 16; variant++) {
      const id = `capture-${channel}`;
      try {
        recorder.prepare(id, { maxSeconds: 30, variantKey: `take-${variant}` });
      } catch (error) {
        allocationError = error;
        break;
      }
      recorder.start(id, frame);
      recorder.capture(Float32Array.from([0.125]), 0, 1, frame);
      recorder.stop(id, ++frame);
    }
  }
  assert(allocationError instanceof Error, 'bounded heap must reject an oversized retained bank');
  assert.match(allocationError.message, /memory|allocat|capacity/i);
  assert.equal(samplerMemory.buffer.byteLength, bytes, 'the audio heap never grows');
  sampler.trigger('baseline', frame, 1, { loop: true });
  const output = [new Float32Array(4)];
  sampler.render(output, frame, 0, 4);
  assert.deepEqual(Array.from(output[0]), [0.25, 0.5, 0.25, 0.5]);
});
