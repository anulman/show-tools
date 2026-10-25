import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NativePerformance } from '../../performance/wasm-performance.ts';
import { pulsePCM } from '../../beat-tracker/tests/wasm_tests.mjs';

const rate = 48000;
const origin = 13579;
const followerTests = process.env.SHOW_TOOLS_FOLLOWER_TESTS === '1';
const wasm = await WebAssembly.compile(await readFile(new URL(followerTests ? '../../beat-tracker/dist/beat-tracker.wasm' : '../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
const base = (await readFile(new URL('../../../ui/practice/runtime/beat-worklet.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export class BeatProcessor', 'class BeatProcessor');
const performer = (await readFile(new URL('../../../ui/practice/runtime/performance-worklet.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export class PerformanceProcessor', 'class PerformanceProcessor');

class PerformanceHarness {
  constructor() {
    this.messages = [];
    this.performanceMessages = [];
    this.frame = 0;
    this.sequence = 0;
    this.request = 0;
    const processors = new Map();
    const messages = this.messages;
    this.sandbox = { currentFrame: origin, sampleRate: rate, WebAssembly, Float32Array, Float64Array, DataView,
      NativePerformance,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
      registerProcessor: (name, processor) => processors.set(name, processor) };
    vm.createContext(this.sandbox);
    vm.runInContext(`${base}\n${performer}`, this.sandbox);
    const Processor = processors.get('performance');
    this.processor = new Processor({ processorOptions: { module: wasm } });
    assert.equal(this.messages[0].type, 'ready', 'subclass engines initialize before base ready reply');
    assert.equal(this.processor.sampler.api.memory.buffer, this.processor.api.memory.buffer, 'sample storage shares the actual clock WASM instance');
    assert.equal(this.processor.sampler.snapshot().metadata.backend, 'cpp-wasm');
    this.port = { start() {}, close() {}, postMessage: message => this.performanceMessages.push(message) };
    this.processor.receive({ type: 'performance-connect', port: this.port });
    assert.equal(this.performanceMessages[0].state.sampler.ready, true);
  }

  command(command, payload = {}) {
    const id = ++this.request;
    this.port.onmessage({ data: { id, command, payload } });
    const reply = this.performanceMessages.at(-1);
    assert.equal(reply.id, id);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  }

  tracker(command, value = 0) {
    this.processor.receive({ type: 'command', command, value, contextFrame: origin + this.frame,
      sequence: ++this.sequence, epoch: this.processor.epoch });
    assert.equal(this.messages.at(-1).result, 0);
  }

  poll() {
    this.processor.receive({ type: 'poll' });
    return this.messages.at(-1);
  }

  load(id = 'pulse', channels = [Float32Array.from([1, 0.75, 0.5, 0.25, 0])], sampleRate = rate) {
    this.command('sample.load', { sampleId: id, channels, sampleRate });
  }

  define(id, lengthBeats, events) {
    this.command('sequence.define', { pattern: { id, label: id, lengthBeats, events } });
  }

  render(frames, { chunk = 128, input } = {}) {
    const left = new Float32Array(frames);
    const right = new Float32Array(frames);
    for (let offset = 0; offset < frames; offset += chunk) {
      const length = Math.min(chunk, frames - offset);
      const output = [new Float32Array(length), new Float32Array(length)];
      this.sandbox.currentFrame = origin + this.frame;
      assert.equal(this.processor.process([input ? [input.subarray(offset, offset + length)] : []], [output]), true);
      left.set(output[0], offset);
      right.set(output[1], offset);
      this.frame += length;
    }
    return [left, right];
  }

  events() {
    this.poll();
    return this.messages.flatMap(message => {
      const events = [];
      for (let offset = 0; offset < (message.events?.length || 0); offset += 12) events.push(Array.from(message.events.slice(offset, offset + 12)));
      return events;
    });
  }

  state() { return this.command('state').state; }
  recorded(id) {
    const sample = this.processor.sampler.samples.get(id);
    return sample.channels[0].subarray(0, sample.length);
  }
  dispose() { this.processor.receive({ type: 'dispose' }); }
}

function expectedPulse(output, crossings, source, sourceRate = rate, startFrame = 0, gain = 1) {
  const expected = new Float32Array(output.length);
  for (const crossing of crossings) {
    for (let frame = Math.max(startFrame, Math.ceil(crossing)); frame < startFrame + output.length; frame++) {
      const age = (frame - crossing) * sourceRate / rate;
      if (age >= source.length) break;
      const index = Math.floor(age);
      const value = source[index] + (age - index) * ((source[index + 1] || 0) - source[index]);
      expected[frame - startFrame] += value * gain;
    }
  }
  for (let index = 0; index < output.length; index++) {
    assert(Math.abs(output[index] - expected[index]) < 1e-6,
      `PCM at frame ${startFrame + index} is ${output[index]}, expected ${expected[index]}`);
  }
}

test('actual WASM renders finite patterns for ten seconds without any UI polls at fractional crossings', () => {
  for (const chunk of [127, 128, 8192, 16000]) {
    const t = new PerformanceHarness();
    const source = Float32Array.from([1, 0.75, 0.5, 0.25, 0]);
    t.load('pulse', [source]);
    t.define('run', 32, Array.from({ length: 32 }, (_, atBeat) => ({ atBeat, sampleId: 'pulse' })));
    t.command('sequence.queue', { patternId: 'run', quantize: 'beat' });
    t.tracker(1, 123);
    const before = t.messages.length;
    const [left, right] = t.render(rate * 10, { chunk });
    assert.equal(t.messages.length, before + 1, 'only started telemetry is sent while rendering');
    const clocks = t.events().filter(event => event[0] === 1);
    assert.equal(clocks.length, 20);
    expectedPulse(left, clocks.map(event => event[2]), source);
    assert.deepEqual(right, left);
    assert.equal(t.state().sampler.metadata.triggeredVoices, 20);
    assert.equal(t.state().sampler.metadata.lateTriggers, 0, 'fractional crossing is on time');
    assert.equal(t.poll().snapshot[14], 0, 'rendered samples never feed analyzer input');
    t.dispose();
  }
});

test('next-bar queue replacement, cancellation, Mark 1 and active progression reach actual output', () => {
  const t = new PerformanceHarness();
  t.load();
  t.load('quiet', [Float32Array.from([0.2, 0.2, 0.2, 0.2, 0])]);
  t.define('a', 4, [0, 1, 2, 3].map(atBeat => ({ atBeat, sampleId: 'pulse' })));
  t.define('b', 1, [{ atBeat: 0, sampleId: 'quiet' }]);
  t.tracker(2, 120);
  t.render(24128);
  t.command('sequence.queue', { patternId: 'a', quantize: 'bar' });
  assert.equal(t.state().sequencer.queued.targetBeatId, 5);
  t.command('sequence.queue', { patternId: 'b', quantize: 'bar' });
  t.command('sequence.cancel');
  assert(t.render(24000)[0].every(value => value === 0));
  t.command('sequence.queue', { patternId: 'a', quantize: 'bar' });
  t.command('sequence.markOne');
  assert.equal(t.state().sequencer.queued.targetBeatId, 3);
  const start = t.frame;
  const [audio] = t.render(24000);
  assert(audio.some(value => value !== 0));
  assert.equal(t.state().sequencer.beat, 1);
  t.command('sequence.markOne');
  t.render(24000);
  assert.equal(t.state().sequencer.playing.positionBeat, 1, 'Mark 1 leaves active relative pattern position intact');
  t.command('sequence.queue', { patternId: 'b', quantize: 'bar' });
  assert.equal(t.state().sequencer.queued.targetBeatId, 8);
  t.command('sequence.markOne');
  const next = t.frame;
  const [replacement] = t.render(24000);
  const clocks = t.events().filter(event => event[0] === 1);
  expectedPulse(audio, clocks.filter(event => event[1] === 3).map(event => event[2]), Float32Array.from([1, .75, .5, .25, 0]), rate, start);
  expectedPulse(replacement, clocks.filter(event => event[1] === 5).map(event => event[2]), Float32Array.from([.2, .2, .2, .2, 0]), rate, next);
  assert.equal(t.state().sequencer.playing.id, 'b');
  t.dispose();
});

test('tempo changes and silent Follow coasting use final crossings without lookahead scheduling', () => {
  const t = new PerformanceHarness();
  const source = Float32Array.from([1, .75, .5, .25, 0]);
  t.load();
  t.define('run', 32, Array.from({ length: 32 }, (_, atBeat) => ({ atBeat, sampleId: 'pulse' })));
  t.command('sequence.queue', { patternId: 'run', quantize: 'beat' });
  t.tracker(2, 120);
  t.render(rate * 2);
  t.tracker(2, 157);
  const start = t.frame;
  const [manual] = t.render(rate * 2);
  t.tracker(4);
  const followStart = t.frame;
  const [follow] = t.render(rate * 6);
  const clocks = t.events().filter(event => event[0] === 1);
  expectedPulse(manual, clocks.map(event => event[2]), source, rate, start);
  expectedPulse(follow, clocks.map(event => event[2]), source, rate, followStart);
  assert.equal(t.poll().snapshot[3], 0, 'Follow selected');
  assert.equal(t.poll().snapshot[4], 2, 'silent input coasts');
  assert(t.state().sampler.metadata.triggeredVoices > 20);
  t.tracker(5);
  assert.equal(t.poll().snapshot[3], 1, 'manual takeover persists');
  t.dispose();
});

test('immediate context times, stereo conversion, overlapping tails, Stop All and reset are atomic', () => {
  const t = new PerformanceHarness();
  t.render(128);
  const source = Float32Array.from([1, .5, .25, 0]);
  t.load('stereo', [source, Float32Array.from([.5, .25, .125, 0])], rate / 2);
  t.command('sample.trigger', { sampleId: 'stereo', when: (origin + 130.25) / rate });
  t.command('sample.trigger', { sampleId: 'stereo', when: (origin + 130.25) / rate });
  const [left, right] = t.render(32);
  expectedPulse(left, [130.25, 130.25], source, rate / 2, 128);
  expectedPulse(right, [130.25, 130.25], Float32Array.from([.5, .25, .125, 0]), rate / 2, 128);
  t.command('sample.trigger', { sampleId: 'stereo', when: 0 });
  assert(t.render(1)[0][0] > 0, 'late immediate starts at next unrendered frame');
  assert.equal(t.state().sampler.metadata.lateTriggers, 1);
  t.load('tail', [new Float32Array(rate * 2).fill(.1)]);
  t.define('a', 8, [{ atBeat: 0, sampleId: 'tail' }, { atBeat: 1, sampleId: 'tail' }]);
  t.tracker(2, 120);
  t.command('sequence.queue', { patternId: 'a', quantize: 'beat' });
  assert(t.render(24000)[0].some(value => value !== 0));
  t.command('sequence.queue', { patternId: 'a', quantize: 'bar' });
  t.command('performance.stopAll');
  const stopped = t.state();
  assert.equal(stopped.sampler.activeVoices, 0);
  assert.equal(stopped.sequencer.queued, null);
  assert.equal(stopped.sequencer.playing, null);
  assert(t.render(rate * 3)[0].every(value => value === 0), 'Stop All kills tails and future launches');
  t.command('sequence.queue', { patternId: 'a', quantize: 'beat' });
  t.render(24000);
  t.command('sequence.queue', { patternId: 'a', quantize: 'bar' });
  t.tracker(6);
  assert.equal(t.state().sampler.activeVoices, 0);
  assert.equal(t.state().sequencer.queued, null);
  assert.equal(t.state().sequencer.playing, null);
  t.tracker(1, 120);
  assert(t.render(rate)[0].every(value => value === 0));
  t.dispose();
});

test('sample output leaves actual detector, follower and clock telemetry unchanged', { skip: !followerTests }, () => {
  const input = pulsePCM(12, 8);
  const traces = [];
  for (const withSamples of [false, true]) {
    const t = new PerformanceHarness();
    t.tracker(1, 120);
    if (withSamples) {
      t.load('tail', [new Float32Array(rate).fill(.5)]);
      t.define('run', 32, Array.from({ length: 32 }, (_, atBeat) => ({ atBeat, sampleId: 'tail' })));
      t.command('sequence.queue', { patternId: 'run', quantize: 'beat' });
    }
    const [output] = t.render(input.length, { input });
    const events = t.events();
    assert(events.some(event => event[0] === 3), 'actual PCM trains follower');
    assert.equal(output.some(value => value !== 0), withSamples);
    traces.push(events);
    t.dispose();
  }
  assert.deepEqual(traces[1], traces[0], 'output does not contaminate analyzer input');
});

test('dedicated port errors acknowledge request IDs and tracker replies retain their own protocol', () => {
  const t = new PerformanceHarness();
  t.port.onmessage({ data: { id: 71, command: 'sequence.queue', payload: { patternId: 'missing' } } });
  assert.equal(t.performanceMessages.at(-1).id, 71);
  assert.equal(t.performanceMessages.at(-1).ok, false);
  assert.match(t.performanceMessages.at(-1).error, /Unknown pattern/);
  assert(t.performanceMessages.at(-1).state.sampler.ready);
  t.tracker(1, 120);
  assert.equal(t.messages.at(-1).type, 'ack');
  assert.equal(t.performanceMessages.at(-1).id, 71);
  t.dispose();
});


test('native processing dispatches a crossing once and polling cannot reapply it', () => {
  const t = new PerformanceHarness();
  t.load();
  t.define('a', 1, [{ atBeat: 0, sampleId: 'pulse' }]);
  t.command('sequence.queue', { patternId: 'a', quantize: 'beat' });
  t.tracker(2, 120);
  const [output] = t.render(24128);
  assert(output.some(value => value !== 0), 'native processing executes the queued pattern before polling');
  t.poll();
  assert.equal(t.state().sequencer.metadata.beatId, 1);
  assert.equal(t.state().sampler.metadata.triggeredVoices, 1);
  t.poll();
  assert.equal(t.state().sampler.metadata.triggeredVoices, 1, 'later replies cannot deliver the same beat twice');
  t.dispose();
});

test('live follower adjustments move all pattern hits with the authoritative crossings', { skip: !followerTests }, () => {
  const t = new PerformanceHarness();
  const source = Float32Array.from([1, .75, .5, .25, 0]);
  t.load();
  t.define('run', 64, Array.from({ length: 64 }, (_, atBeat) => ({ atBeat, sampleId: 'pulse' })));
  t.command('sequence.queue', { patternId: 'run', quantize: 'beat' });
  t.tracker(1, 123);
  const [output] = t.render(rate * 14, { input: pulsePCM(14, 10) });
  const events = t.events();
  const clocks = events.filter(event => event[0] === 1);
  assert(events.some(event => event[0] === 3), 'real input trains live tempo follower');
  assert(clocks.some(event => Math.abs(event[6] - 123) > .1), 'live clock tempo changes from the seed');
  expectedPulse(output, clocks.map(event => event[2]), source);
  assert.equal(t.state().sampler.metadata.lateTriggers, 0);
  t.dispose();
});

test('immediate microphone capture saves only input, then plays the recorded PCM', () => {
  const t = new PerformanceHarness();
  t.render(16);
  const input = Float32Array.from({ length: 64 }, (_, index) => (index + 1) / 1000);
  t.load('tone', [new Float32Array(64).fill(.2)]);
  t.command('sample.trigger', { sampleId: 'tone' });
  t.command('record.start', { sampleId: 'take', maxSeconds: .1 });
  const [output] = t.render(input.length, { input });
  assert(output.every(value => value === Math.fround(.2)), 'recording does not monitor microphone input');
  t.command('record.stop', { sampleId: 'take' });
  const recording = t.state().sampler.recordings.find(slot => slot.id === 'take');
  assert.equal(recording.frames, 64);
  assert.equal(recording.recording, false);
  assert.equal(recording.duration, 64 / rate);
  const saved = t.recorded('take');
  assert.deepEqual(saved, input, 'playback output was never mixed into recorded PCM');
  t.command('sample.trigger', { sampleId: 'take' });
  const [played] = t.render(input.length);
  assert.deepEqual(played, input);
  t.dispose();
});

test('quantized capture uses exact beat/bar bounds and commits before same-crossing cue playback', () => {
  for (const chunk of [128, 16000]) {
    const t = new PerformanceHarness();
    t.load('take', [Float32Array.from([-.25, -.25, 0])]);
    t.command('sequence.record', { sampleId: 'take', action: 'start', quantize: 'beat' });
    t.tracker(1, 123);
    const input = Float32Array.from({ length: rate * 3 }, (_, index) => (index + 1) / (rate * 4));
    const firstLength = 28800;
    assert(t.render(firstLength, { chunk, input: input.subarray(0, firstLength) })[0].every(value => value === 0));
    assert.equal(t.state().sampler.recordings[0].recording, true);
    t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'bar', loop: false });
    t.command('sequence.cue', { sampleId: 'take', quantize: 'bar' });
    const [output] = t.render(input.length - firstLength, { chunk, input: input.subarray(firstLength) });
    const clocks = t.events().filter(event => event[0] === 1);
    const start = clocks.find(event => event[1] === 1)[2];
    const stop = clocks.find(event => event[1] === 5)[2];
    const expected = input.slice(Math.ceil(start), Math.ceil(stop));
    const saved = t.recorded('take');
    assert.deepEqual(saved, expected, 'capture starts at ceil(start) and ends before ceil(stop)');
    assert.equal(t.state().sampler.recordings[0].frames, expected.length);
    expectedPulse(output, [stop], expected, rate, firstLength);
    assert.equal(t.state().sequencer.cues.length, 0);
    assert.equal(t.state().sequencer.recordArms.length, 0);
    t.dispose();
  }
});

test('recording limits commit playable takes and Stop All/reset clear every queued action', () => {
  const t = new PerformanceHarness();
  const input = Float32Array.from({ length: 128 }, (_, index) => (index + 1) / 1000);
  t.command('record.start', { sampleId: 'limited', maxSeconds: 96 / rate });
  assert(t.render(128, { input })[0].every(value => value === 0));
  const limited = t.state().sampler.recordings.find(slot => slot.id === 'limited');
  assert.equal(limited.recording, false);
  assert.equal(limited.frames, 96);
  assert.equal(limited.reason, 'limit');
  t.command('sample.trigger', { sampleId: 'limited' });
  assert.deepEqual(t.render(96)[0], input.slice(0, 96));
  for (const reset of [false, true]) {
    t.command('record.start', { sampleId: 'active', maxSeconds: 1 });
    t.render(128, { input });
    t.command('sequence.record', { sampleId: 'armed', action: 'start', quantize: 'bar' });
    t.command('sequence.record', { sampleId: 'active', action: 'stop', quantize: 'bar' });
    t.command('sequence.cue', { sampleId: 'limited', quantize: 'bar' });
    t.define('p', 2, [{ atBeat: 0, sampleId: 'limited' }]);
    t.command('sequence.queue', { patternId: 'p', quantize: 'bar' });
    if (reset) t.tracker(6);
    else t.command('performance.stopAll');
    const state = t.state();
    assert.equal(state.sequencer.recordArms.length, 0);
    assert.equal(state.sequencer.cues.length, 0);
    assert.equal(state.sequencer.queued, null);
    assert.equal(state.sequencer.playing, null);
    assert.equal(state.sampler.activeVoices, 0);
    assert(state.sampler.recordings.every(slot => !slot.recording));
    assert.deepEqual(t.recorded('active'), input, 'global stop commits active microphone take');
    t.tracker(1, 120);
    assert(t.render(rate)[0].every(value => value === 0), 'old arms/cues/patterns cannot restart after stop/reset');
    if (!reset) t.tracker(6);
  }
  t.dispose();
});

test('immediate recording start and stop cancel that slot arm, with repeated starts rejected', () => {
  const t = new PerformanceHarness();
  t.command('sequence.record', { sampleId: 'take', action: 'start', quantize: 'bar' });
  t.command('record.start', { sampleId: 'take', maxSeconds: .1 });
  assert.equal(t.state().sequencer.recordArms.length, 0);
  t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'bar' });
  t.port.onmessage({ data: { id: 800, command: 'record.start', payload: { sampleId: 'take' } } });
  assert.equal(t.performanceMessages.at(-1).ok, false);
  assert.match(t.performanceMessages.at(-1).error, /already recording/i);
  assert.equal(t.state().sequencer.recordArms[0].action, 'stop', 'rejected start preserves valid stop arm');
  t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'bar' });
  t.command('sequence.recordCancel', { sampleId: 'take' });
  assert.equal(t.state().sampler.recordings[0].recording, true, 'canceling stop arm keeps recording');
  t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'bar' });
  t.command('record.stop', { sampleId: 'take' });
  assert.equal(t.state().sequencer.recordArms.length, 0);
  assert.equal(t.state().sampler.recordings[0].recording, false);
  t.command('record.stop', { sampleId: 'unknown' });
  t.dispose();
});

test('attached Sampler Stop All commits microphone recording and silences its voices', () => {
  const t = new PerformanceHarness();
  const input = Float32Array.from([.1, .2, .3, .4]);
  t.command('record.start', { sampleId: 'take', maxSeconds: .1 });
  t.render(4, { input });
  t.load('tone', [new Float32Array(32).fill(.5)]);
  t.command('sample.trigger', { sampleId: 'tone' });
  t.command('sample.stopAll');
  assert.equal(t.state().sampler.recordings[0].recording, false);
  assert.equal(t.state().sampler.activeVoices, 0);
  assert.deepEqual(t.recorded('take'), input);
  assert(t.render(32)[0].every(value => value === 0));
  t.dispose();
});

test('quantized recorded takes wrap until an exact beat or bar stop without UI polling', () => {
  for (const quantize of ['beat', 'bar']) for (const chunk of [128, 16000]) {
    const t = new PerformanceHarness();
    t.command('sequence.record', { sampleId: 'take', action: 'start', quantize: 'beat' });
    t.tracker(1, 123);
    const initial = Float32Array.from({ length: 28800 }, (_, i) => (i % 257) / 512);
    assert(t.render(initial.length, { chunk, input: initial })[0].every(v => v === 0));
    t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize });
    const target = t.state().sequencer.recordArms[0].targetBeatId;
    const start = t.frame;
    const input = Float32Array.from({ length: rate * 7 }, (_, i) => ((i + start) % 257) / 512);
    const messageCount = t.performanceMessages.length;
    const [output] = t.render(input.length, { chunk, input });
    assert.equal(t.performanceMessages.length, messageCount, 'loop playback has no state-poll dependency');
    const clocks = t.events().filter(event => event[0] === 1);
    const onset = Math.ceil(clocks.find(event => event[1] === target)[2]);
    const recorded = t.recorded('take');
    for (let i = 0; i < output.length; i++) {
      const frame = start + i;
      assert.equal(output[i], frame < onset ? 0 : recorded[(frame - onset) % recorded.length], `loop frame ${frame}`);
    }
    assert.deepEqual(t.state().sampler.looping, ['take']);
    assert.equal(t.state().sampler.activeVoices, 1);
    t.command('sequence.sampleStop', { sampleId: 'take', quantize });
    const stopTarget = t.state().sequencer.cues[0].targetBeatId;
    const stopStart = t.frame;
    const [ending] = t.render(rate * 3, { chunk });
    const stop = Math.ceil(t.events().find(event => event[0] === 1 && event[1] === stopTarget)[2]);
    for (let i = 0; i < ending.length; i++) {
      const frame = stopStart + i;
      assert.equal(ending[i], frame < stop ? recorded[(frame - onset) % recorded.length] : 0, `stop frame ${frame}`);
    }
    assert.deepEqual(t.state().sampler.looping, []);
    t.dispose();
  }
});

test('force stop cancels a slot cue and prevents an armed recording stop from relaunching', () => {
  const t = new PerformanceHarness();
  t.load('take', [new Float32Array(64).fill(.3)]);
  t.tracker(2, 120);
  t.render(24128);
  t.command('record.start', { sampleId: 'take' });
  t.render(128, { input: new Float32Array(128).fill(.2) });
  t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'bar' });
  t.command('sequence.cue', { sampleId: 'take', quantize: 'bar' });
  t.command('sample.stop', { sampleId: 'take' });
  assert.equal(t.state().sequencer.cues.length, 0);
  assert.equal(t.state().sequencer.recordArms[0].loop, false);
  assert(t.render(rate * 3, { input: new Float32Array(rate * 3).fill(.2) })[0].every(v => v === 0));
  assert.equal(t.state().sampler.recordings[0].recording, false, 'armed capture stop still saves take');
  assert.equal(t.state().sampler.activeVoices, 0);
  t.dispose();
});

test('slot recording replacement and force stop leave other loops running; global stop clears all', () => {
  const t = new PerformanceHarness();
  t.tracker(2, 120);
  t.render(24128);
  for (const [id, value] of [['a', .25], ['b', .5]]) {
    t.command('record.start', { sampleId: id });
    t.render(16, { input: new Float32Array(16).fill(value) });
    t.command('sequence.record', { sampleId: id, action: 'stop', quantize: 'beat' });
    t.render(24000, { input: new Float32Array(24000).fill(value) });
  }
  assert.deepEqual(t.state().sampler.looping.sort(), ['a', 'b']);
  assert(t.render(128)[0].every(v => v === .75));
  t.command('record.start', { sampleId: 'a' });
  assert.deepEqual(t.state().sampler.looping, ['b']);
  assert(t.render(128)[0].every(v => v === .5), 'record replacement silences only its own playback');
  t.command('record.stop', { sampleId: 'a' });
  t.command('sample.stop', { sampleId: 'a' });
  assert(t.render(128)[0].every(v => v === .5));
  t.command('sequence.sampleStop', { sampleId: 'b', quantize: 'bar' });
  t.command('performance.stopAll');
  assert.deepEqual(t.state().sampler.looping, []);
  assert.equal(t.state().sequencer.cues.length, 0);
  assert(t.render(rate * 3)[0].every(v => v === 0));
  t.dispose();
});

test('an expired or empty recording stop cannot restart a previous take as a loop', () => {
  const t = new PerformanceHarness();
  t.load('take');
  t.command('record.start', { sampleId: 'take', maxSeconds: 16 / rate });
  t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'beat' });
  t.tracker(2, 120);
  const [output] = t.render(24128, { input: new Float32Array(24128).fill(.25) });
  assert(output.every(v => v === 0));
  assert.deepEqual(t.state().sampler.looping, []);
  assert.equal(t.state().sampler.recordings[0].reason, 'limit');
  t.command('sequence.record', { sampleId: 'take', action: 'stop', quantize: 'beat' });
  assert(t.render(24000)[0].every(v => v === 0));
  t.dispose();
});
