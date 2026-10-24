import assert from 'node:assert/strict';
import test from 'node:test';
import { SampleEngine } from '../sample-engine.js';

const render = (engine, start, length, channels = 2) => {
  const output = Array.from({ length: channels }, () => new Float32Array(length));
  engine.render(output, start, 0, length);
  return output;
};

test('future fractional starts survive block boundaries and interpolate their source age', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  engine.load('tone', [new Float32Array([1, 2, 3, 4])], 8);
  engine.trigger('tone', 5.25);
  assert.deepEqual(Array.from(render(engine, 0, 4)[0]), [0, 0, 0, 0]);
  const output = render(engine, 4, 8);
  assert.deepEqual(Array.from(output[0]), [0, 0, 1.75, 2.75, 3.75, 1, 0, 0]);
  assert.deepEqual(output[0], output[1]);
  assert.equal(engine.snapshot().activeVoices, 0);
});

test('render adds stereo, mono, overlapping voices and resamples at the source rate', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  engine.load('stereo', [new Float32Array([1, 3]), new Float32Array([2, 4])], 4);
  engine.load('mono', [new Float32Array([2, 2])], 8);
  engine.trigger('stereo', 0, 0.5);
  engine.trigger('mono', 1);
  engine.setVolume(0.5);
  const output = [new Float32Array(5).fill(1), new Float32Array(5).fill(1)];
  engine.render(output, 0, 0, 5);
  assert.deepEqual(Array.from(output[0]), [1.25, 2.5, 2.75, 1.375, 1]);
  assert.deepEqual(Array.from(output[1]), [1.5, 2.75, 3, 1.5, 1]);
  engine.trigger('stereo', 5);
  assert.deepEqual(Array.from(render(engine, 5, 4, 1)[0]), [0.75, 1.25, 1.75, 0.875]);
});

test('segmented rendering preserves frame timestamps independently of the output offset', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  engine.load('tone', [new Float32Array([1, 2, 3, 4])], 8);
  engine.trigger('tone', 1.25);
  const output = [new Float32Array(8)];
  engine.render(output, 0, 0, 2);
  engine.render(output, 2, 2, 3);
  engine.render(output, 5, 5, 3);
  assert.deepEqual(Array.from(output[0]), [0, 0, 1.75, 2.75, 3.75, 1, 0, 0]);
});

test('crossings announced after the preceding segment preserve fractional source age', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  engine.load('tone', [new Float32Array([1, 2, 3, 4])], 8);
  render(engine, 0, 2);
  engine.trigger('tone', 1.25);
  assert.deepEqual(Array.from(render(engine, 2, 4)[0]), [1.75, 2.75, 3.75, 1]);
  assert.equal(engine.snapshot().metadata.lateTriggers, 0);
});

test('late triggers start at the next unrendered frame and voice stealing is bounded', () => {
  const engine = new SampleEngine({ sampleRate: 8, maxVoices: 2 });
  engine.load('tone', [new Float32Array([1, 1, 1, 1])], 8);
  render(engine, 0, 8);
  engine.trigger('tone', 1);
  assert.deepEqual(Array.from(render(engine, 8, 2)[0]), [1, 1]);
  assert.equal(engine.snapshot().metadata.lateTriggers, 1);
  assert.equal(engine.snapshot().metadata.maxLateFrames, 7);
  engine.trigger('tone', 10, 2);
  engine.trigger('tone', 10, 3);
  assert.equal(engine.snapshot().activeVoices, 2);
  assert.equal(engine.snapshot().metadata.stolenVoices, 1);
  assert.deepEqual(Array.from(render(engine, 10, 2)[0]), [5, 5]);
  engine.stopAll();
  assert.deepEqual(Array.from(render(engine, 12, 4)[0]), [0, 0, 0, 0]);
});

test('loading rejects malformed PCM and failed commands do not change playback', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  assert.throws(() => engine.load('bad', [new Float32Array([NaN])], 8), /finite/);
  assert.throws(() => engine.load('bad', [new Float32Array(1), new Float32Array(2)], 8), /equal-length/);
  assert.throws(() => engine.trigger('missing', 0), /Unknown sample/);
  assert.throws(() => engine.setVolume(-1), /volume/);
  assert.equal(engine.snapshot().samples.length, 0);
});

test('looped PCM wraps continuously with circular interpolation and replaces duplicate loops', () => {
  const s = new SampleEngine({ sampleRate: 8 });
  s.load('a', [Float32Array.from([1, .5, 0]), Float32Array.from([0, .5, 1])], 4);
  s.trigger('a', 0, 1, { loop: true });
  s.trigger('a', 0, 1, { loop: true });
  const left = new Float32Array(20);
  const right = new Float32Array(20);
  s.render([left, right], 0, 0, 7);
  s.render([left, right], 7, 7, 13);
  const cycle = [1, .75, .5, .25, 0, .5];
  const other = [0, .25, .5, .75, 1, .5];
  assert.deepEqual(Array.from(left), Array.from({ length: 20 }, (_, i) => cycle[i % 6]));
  assert.deepEqual(Array.from(right), Array.from({ length: 20 }, (_, i) => other[i % 6]));
  assert.equal(s.snapshot().activeVoices, 1);
  assert.deepEqual(s.snapshot().looping, ['a']);
  s.stop('a');
  const silence = new Float32Array(8);
  s.render([silence], 20, 0, 8);
  assert(silence.every(value => value === 0));
  assert.deepEqual(s.snapshot().looping, []);
});

test('manual hits start at the audible onset while full-bar loops retain their phase', () => {
  const engine = new SampleEngine({ sampleRate: 8, maxVoices: 1 });
  const pcm = Float32Array.from([0, 0, 0, 0.75, 0.25, 0]);
  engine.load('cowbell', [pcm], 8);
  engine.trigger('cowbell', 0, 1, { loop: true });
  assert.deepEqual(Array.from(render(engine, 0, 8)[0]), [0, 0, 0, 0.75, 0.25, 0, 0, 0]);
  engine.trigger('cowbell', 8, 1, { trimStart: true });
  assert.deepEqual(Array.from(render(engine, 8, 5)[0]), [0.75, 0.25, 0, 0, 0]);
  assert.equal(engine.snapshot().activeVoices, 0);
  assert.equal(engine.samples.get('cowbell').channels[0], pcm);
  engine.trigger('cowbell', 13);
  assert.deepEqual(Array.from(render(engine, 13, 6)[0]), Array.from(pcm));
});

test('trimmed stereo hits use the earliest channel onset and preserve source-rate interpolation', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  engine.load('stereo', [Float32Array.from([0, 0, 1, 0]), Float32Array.from([0, -0.5, 0, 0])], 4);
  engine.trigger('stereo', 0, 1, { trimStart: true });
  const output = render(engine, 0, 7);
  assert.deepEqual(Array.from(output[0]), [0, 0.5, 1, 0.5, 0, 0, 0]);
  assert.deepEqual(Array.from(output[1]), [-0.5, -0.25, 0, 0, 0, 0, 0]);
  assert.equal(engine.snapshot().activeVoices, 0);
});

test('silent and below-threshold samples retain their complete duration when trimmed', () => {
  const engine = new SampleEngine({ sampleRate: 8 });
  for (const pcm of [Float32Array.from([0, 0, 0]), Float32Array.from([0, 0.004, -0.005])]) {
    engine.load('quiet', [pcm], 8);
    const frame = engine.processedFrames;
    engine.trigger('quiet', frame, 1, { trimStart: true });
    assert.deepEqual(Array.from(render(engine, frame, 3)[0]), Array.from(pcm));
  }
  assert.throws(() => engine.trigger('quiet', 6, 1, { trimStart: 1 }), /trimStart/);
});
