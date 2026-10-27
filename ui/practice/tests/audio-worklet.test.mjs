import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { NativePerformance } from '../../../lib/performance/wasm-performance.ts';
import { CONTROL_IDS } from '../../../lib/performance/model.js';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';
import { loadSong } from '../../../songs/index.ts';
import { SampleEngine as TestSampleEngine } from '../../../lib/sampler/tests/support/wasm-runtime.ts';
import { withoutPerformanceExports } from './support/wasm-exports.ts';
import { compiledCaptureFixture } from '../../../lib/performance/tests/fixtures/compiled-capture.ts';
import { encodeCompiledProgram } from '../../../lib/performance/compiled-native.ts';

const rate = 8000;
const program = { lengthBeats: 16, events: Array.from({ length: 16 }, (_, atBeat) => [
  { atBeat, sampleId: 'R1' },
  ...(atBeat % 2 === 0 ? [{ atBeat, sampleId: 'R2' }] : [{ atBeat, sampleId: 'L2' }]),
  ...(atBeat === 0 ? [{ atBeat, sampleId: 'L1' }] : []),
]).flat() };
const emptyRow = () => Object.fromEntries(CONTROL_IDS.map(id => [id, { kind: 'none' }]));
const controls = () => {
  const leadIn = emptyRow();
  leadIn.R1 = { kind: 'arm', timing: 'bar' };
  const bars = Array.from({ length: 8 }, emptyRow);
  bars[1].R1 = { kind: 'commit', timing: 'bar' };
  bars[3].R1 = { kind: 'stop', timing: 'bar' };
  return { leadIn, bars };
};
const origin = 13579;
const wasmBytes = await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url));
const wasm = await WebAssembly.compile(wasmBytes);
const sources = await Promise.all(['../runtime/beat-worklet.js', '../runtime/performance-worklet.js', '../practice-worklet.ts']
  .map(async path => (await sourceForVM(new URL(path, import.meta.url))).replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ')));

class Harness {
  constructor({ bpm = 120, countInBars = 1, automatic = false, loop = true, preload = false, chartControls = controls(), audibleClick = false, barPlayback = [], barCount = 8, liveEffects, microphone = false, compiledProgram } = {}) {
    this.frame = 0;
    this.sequence = 0;
    this.request = 0;
    this.messages = [];
    this.performance = [];
    const processors = new Map();
    const messages = this.messages;
    this.sandbox = { currentFrame: origin, sampleRate: rate, WebAssembly, Float32Array, Float64Array, DataView,
      NativePerformance, CONTROL_IDS,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
      registerProcessor: (name, processor) => processors.set(name, processor) };
    vm.createContext(this.sandbox);
    vm.runInContext(sources.join('\n'), this.sandbox);
    this.processor = new (processors.get('practice'))({ processorOptions: { module: wasm, clickGain: audibleClick ? 1 : 0, practice: { barCount, endBar: barCount, compiledProgram, program: { ...program, controls: { ...chartControls, bars: chartControls.bars.slice(0, barCount) }, barPlayback: barPlayback.filter(cue => cue.bar <= barCount) } } } });
    assert.equal(messages[0].type, 'ready', messages[0].message);
    assert.equal(this.processor.sampler.api.memory.buffer, this.processor.api.memory.buffer, 'sample storage shares the actual clock WASM instance');
    assert.equal(this.processor.sampler.snapshot().metadata.backend, 'cpp-wasm');
    this.port = { start() {}, close() {}, postMessage: message => this.performance.push(message) };
    this.processor.receive({ type: 'performance-connect', port: this.port });
    if (preload) for (const sampleId of CONTROL_IDS) this.command('sample.load', { sampleId, channels: [Float32Array.from([0.5, 0.25, 0])], sampleRate: rate });
    this.tracker(2, bpm);
    if (liveEffects !== undefined) this.command('practice.effects', { effects: liveEffects });
    if (microphone) this.command('practice.microphone', { enabled: true });
    this.command('practice.start', { runId: 'first', bpm, countInBars, automatic, loop, endBar: barCount });
    this.command('practice.click', { enabled: false });
  }

  command(command, payload = {}) {
    this.port.onmessage({ data: { id: ++this.request, command, payload } });
    const reply = this.performance.at(-1);
    assert.equal(reply.id, this.request);
    assert.equal(reply.ok, true, reply.error);
    return reply;
  }

  tracker(command, value = 0) {
    this.processor.receive({ type: 'command', command, value, contextFrame: origin + this.frame,
      sequence: ++this.sequence, epoch: this.processor.epoch });
    assert.equal(this.messages.at(-1).result, 0);
  }

  render(frames, { chunk = 128, input } = {}) {
    const left = new Float32Array(frames);
    for (let offset = 0; offset < frames; offset += chunk) {
      const length = Math.min(chunk, frames - offset);
      const output = [new Float32Array(length), new Float32Array(length)];
      this.sandbox.currentFrame = origin + this.frame;
      this.processor.process([input ? [input.subarray(offset, offset + length)] : []], [output]);
      left.set(output[0], offset);
      this.frame += length;
    }
    return left;
  }

  renderStems(frames, { chunk = 128, input } = {}) {
    const mixed = [new Float32Array(frames), new Float32Array(frames)];
    const live = [new Float32Array(frames), new Float32Array(frames)];
    for (let offset = 0; offset < frames; offset += chunk) {
      const length = Math.min(chunk, frames - offset);
      const output = [new Float32Array(length), new Float32Array(length)];
      const voice = [new Float32Array(length), new Float32Array(length)];
      this.sandbox.currentFrame = origin + this.frame;
      this.processor.process([input ? [input.subarray(offset, offset + length)] : []], [output, voice]);
      for (let channel = 0; channel < 2; channel++) {
        mixed[channel].set(output[channel], offset);
        live[channel].set(voice[channel], offset);
      }
      this.frame += length;
    }
    return { mixed, live };
  }

  until(frame, value = 0.125) { return this.render(frame - this.frame, { input: new Float32Array(frame - this.frame).fill(value) }); }

  state() { return this.command('state').state.practice; }
  dispose() { this.processor.receive({ type: 'dispose' }); }
}

test('compiled program crosses the real worklet control port and renders processed layers into both stems', async () => {
  const song = await compiledCaptureFixture();
  const t = new Harness({ compiledProgram: Array.from(encodeCompiledProgram(song)), barCount: 4,
    liveEffects: [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }], microphone: true });
  function advance(bar) {
    for (let attempt = 0; attempt < 1000; attempt++) {
      if (t.state().bar === bar && t.state().phase === 'playing') return;
      t.render(128, { input: new Float32Array(128).fill(.25) });
    }
    throw new Error(`Worklet did not reach bar ${bar}`);
  }
  try {
    assert.equal(t.state().liveEffects.captureSupported, true);
    t.command('practice.control', { control: { id: 'R1' }, commandId: '["keyboard","first",0]' });
    advance(1);
    const handoff = { control: { id: 'R1' }, commandId: '["keyboard","first",1]' };
    t.command('practice.control', handoff);
    t.command('practice.control', handoff);
    advance(2);
    assert.equal(t.processor.native.compiledTake(0).frames, 16000);
    assert.equal(t.processor.native.compiledTake(0).ready, true);
    t.command('practice.control', { control: { id: 'R1' }, commandId: '["keyboard","first",2]' });
    advance(3);
    const output = t.renderStems(128, { input: new Float32Array(128).fill(.25) });
    assert(output.mixed.every(channel => channel.every(value => Math.abs(value - .625) < 1e-6)));
    assert(output.live.every(channel => channel.every(value => Math.abs(value - .25) < 1e-6)), 'capture tail transfers to playback rather than being mixed again on live');
    const warm = t.renderStems(800, { input: new Float32Array(800).fill(.25) });
    assert(warm.live.every(channel => channel.slice(-128).every(value => Math.abs(value - .3125) < 1e-6)));
    for (const [command, payload] of [['record.start', { sampleId: 'L1' }], ['sequence.record', { sampleId: 'L1', action: 'start' }]]) {
      t.port.onmessage({ data: { id: ++t.request, command, payload } });
      const reply = t.performance.at(-1);
      assert.equal(reply.ok, false);
      assert.match(reply.error, /compiled song pad/);
      assert.equal(t.processor.native.compiledTake(0).frames, 16000);
    }
    t.command('practice.stop');
    const silence = t.renderStems(1000, { input: new Float32Array(1000).fill(.25) });
    assert([...silence.mixed, ...silence.live].every(channel => channel.every(value => value === 0)));
  } finally { t.dispose(); }
});

for (const order of [['L2', 'R1'], ['R1', 'L2']]) test(`DYC future-arm handoff keeps recording ownership through the real port (${order.join(' then ')})`, async () => {
  const song = (await loadSong('dance-yrself-clean')).compiled;
  const t = new Harness({ bpm: 98, compiledProgram: Array.from(encodeCompiledProgram(song)), barCount: 76,
    liveEffects: [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }], microphone: true });
  const atBar = bar => t.until(Math.ceil((5 + (bar - 1) * 4) * rate * 60 / 98) + 1, .25);
  try {
    t.command('practice.control', { control: { id: 'R1' } });
    atBar(2); t.command('practice.control', { control: { id: 'R1' } });
    atBar(4);
    for (const id of order) t.command('practice.control', { control: { id } });
    assert.equal(t.state().recording.id, 'R1', 'actual recording takes priority over a future armed reservation');
    assert.equal(t.state().channels.find(channel => channel.id === 'L2').status, 'armed');
    atBar(5);
    assert.equal(t.state().recording.id, 'L2');
    assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
    assert(t.processor.native.compiledTake(song.takes.findIndex(take => take.voiceId === 'drums-claps' && take.begin.bar === 3)).ready);
    assert(!t.performance.some(message => message.event?.type === 'fault' || message.event?.type === 'control' && !message.event.applied));
  } finally { t.dispose(); }
});

test('DYC missed old commit rejects only the future recording with a source-indexed outcome', async () => {
  const song = (await loadSong('dance-yrself-clean')).compiled;
  const t = new Harness({ bpm: 98, compiledProgram: Array.from(encodeCompiledProgram(song)), barCount: 76,
    liveEffects: [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }], microphone: true });
  const atBar = bar => t.until(Math.ceil((5 + (bar - 1) * 4) * rate * 60 / 98) + 1, .25);
  try {
    t.command('practice.control', { control: { id: 'R1' } });
    atBar(2); t.command('practice.control', { control: { id: 'R1' } });
    atBar(4); t.command('practice.control', { control: { id: 'L2' } });
    atBar(5);
    assert.equal(t.state().phase, 'playing');
    assert.equal(t.state().recording.id, 'R1');
    assert(!t.performance.some(message => message.event?.type === 'fault'));
    const rejected = t.performance.filter(message => message.event?.type === 'control' && message.event.applied === false).map(message => message.event);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].cueIndex, song.cues.findIndex(cue => cue.source.a1 === 'F21'));
    assert.match(rejected[0].error, /recording|capture/i);
    const output = t.renderStems(128, { input: new Float32Array(128).fill(.25) });
    assert(output.mixed.every(channel => channel.every(value => Math.abs(value - .3125) < 1e-6)));
    assert(output.live.every(channel => channel.every(value => Math.abs(value - .3125) < 1e-6)));
  } finally { t.dispose(); }
});

test('actual manual WASM renders four count-in beats before first song PCM without UI polls', () => {
  for (const chunk of [127, 128, 16000]) {
    const t = new Harness({ bpm: 123, automatic: true, preload: true });
    const audio = t.render(rate * 4, { chunk });
    const beats = t.performance.filter(message => message.event?.type === 'beat').map(message => message.event);
    assert.equal(beats.length, 8);
    assert(beats.slice(0, 4).every(event => event.state.phase === 'count-in' && event.state.bar === null));
    assert.equal(beats[4].state.phase, 'playing');
    assert.equal(beats[4].state.bar, 1);
    const firstFrame = Math.ceil(beats[4].frame);
    assert(Math.abs(beats[4].frame - 5 * 60 / 123 * rate) < 1e-5);
    assert(audio.subarray(0, firstFrame).every(value => value === 0));
    const age = firstFrame - beats[4].frame;
    assert(Math.abs(audio[firstFrame] - 3 * (0.5 - age * 0.25)) < 1e-5);
    assert.equal(t.processor.sampler.lateTriggers, 0);
    assert(t.performance.filter(message => message.event).every((message, index, all) => index === 0 || message.event.seq > all[index - 1].event.seq));
    t.dispose();
  }
});

test('lead-in always clicks with the song toggle off and stops exactly at the song downbeat', () => {
  for (const countInBars of [1, 2]) {
    const t = new Harness({ countInBars, audibleClick: true });
    const first = t.render(10000);
    t.command('practice.click', { enabled: false });
    const rest = t.render(40000);
    const output = new Float32Array(50000);
    output.set(first);
    output.set(rest, first.length);
    const beats = t.performance.filter(message => message.event?.type === 'beat').map(message => message.event);
    const leadIn = beats.filter(event => event.state.phase === 'count-in');
    assert.equal(leadIn.length, countInBars * 4);
    for (const event of leadIn) assert(output.subarray(Math.ceil(event.frame), Math.ceil(event.frame) + 96).some(value => value !== 0));
    const downbeat = Math.ceil(beats.find(event => event.state.phase === 'playing').frame);
    assert(output.subarray(downbeat).every(value => value === 0), 'no click leaks into the song when disabled');
    assert.equal(t.state().click, false, 'mandatory lead-in does not change the song preference');
    t.command('practice.click', { enabled: true });
    assert(t.render(5000).some(value => value !== 0));
    t.dispose();
  }
  const noLeadIn = new Harness({ countInBars: 0, audibleClick: true });
  assert(noLeadIn.render(10000).every(value => value === 0));
  noLeadIn.dispose();
});

test('count-in click renders audibly and mushroom clears click, voices, arms, and transport', () => {
  const t = new Harness({ automatic: false, audibleClick: true });
  t.command('practice.click', { enabled: true });
  assert(t.render(4100).some(value => value !== 0));
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.command('practice.control', { control: { id: 'mushroom' }, commandId: 'panic-1' });
  assert(t.render(rate * 2).every(value => value === 0));
  const state = t.state();
  assert.equal(state.phase, 'idle');
  assert.equal(state.recording, null);
  assert.equal(t.processor.sampler.snapshot().activeVoices, 0);
  assert.equal(t.performance.filter(message => message.event?.commandId === 'panic-1').length, 1);
  t.dispose();
});

test('samples start empty and chart arm/commit/stop actions run at exact crossings without UI polls', () => {
  const t = new Harness();
  assert(t.state().channels.every(channel => !channel.ready && channel.status === 'empty'));
  assert(t.state().channels.every(channel => channel.gain === 1), 'every sample starts at 100% volume');
  t.render(4100);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').light.kind, 'cue');
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'armed');
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').light.kind, 'steady');
  assert(t.until(21000).every(value => value === 0));
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'recording');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'recording', 'blank bar leaves recording alone');
  t.until(36100);
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'stopping');
  const before = t.frame;
  const output = t.until(53000);
  const commitFrame = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 3 && message.event.state.beat === 1).event.frame);
  assert(output.subarray(0, commitFrame - before).every(value => value === 0));
  assert(output.subarray(commitFrame - before).every(value => value === Math.fround(0.125)));
  assert.equal(t.processor.recorder.slots.get('R1').frames, 32000);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').light.kind, 'steady');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true, 'blank bar does not exit a loop');
  t.until(68100);
  t.command('practice.control', { control: { id: 'R1' } });
  const stopStart = t.frame;
  const ending = t.until(85000);
  const stopFrame = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 5 && message.event.state.beat === 1).event.frame);
  assert(ending.subarray(0, stopFrame - stopStart).every(value => value === Math.fround(0.125)));
  assert(ending.subarray(stopFrame - stopStart).every(value => value === 0));
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, false);
  t.dispose();
});

test('pad lights distinguish available cues, active loops, queued release, and immediate stop', () => {
  for (const timing of ['now', 'bar']) {
    const chartControls = controls();
    chartControls.bars[0].R1 = { kind: 'stop', timing };
    chartControls.bars[1].R1 = { kind: 'none' };
    const t = new Harness({ chartControls, countInBars: 0, preload: true });
    const light = () => t.state().channels.find(channel => channel.id === 'R1').light;
    t.render(4100);
    assert.equal(light().kind, 'cue');
    t.processor.sampler.trigger('R1', t.frame, 1, { loop: true });
    assert.equal(light().kind, 'steady', 'an active loop stays steady even with an unused cue');
    t.command('practice.control', { control: { id: 'R1' } });
    if (timing === 'bar') {
      const release = light();
      assert.equal(release.kind, 'releasing');
      t.render(1000);
      assert(Math.abs(release.remainingMs - light().remainingMs - 125) < 0.01);
      t.until(20100);
    }
    assert.equal(light().kind, 'off', 'a completed stop does not restart its available-cue pulse');
    t.command('practice.control', { control: { id: 'mushroom' } });
    assert(t.state().channels.every(channel => channel.light.kind === 'off'));
    t.dispose();
  }
});

test('commit-and-arm loops the first take while the next capture records, then replaces it on commit', () => {
  const chartControls = controls();
  chartControls.bars[1].R1 = { kind: 'commit-arm', timing: 'bar' };
  chartControls.bars[3].R1 = { kind: 'commit', timing: 'bar' };
  chartControls.bars[4].R1 = { kind: 'stop', timing: 'now' };
  const t = new Harness({ chartControls });
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.until(36100, 0.125);
  t.command('practice.control', { control: { id: 'R1' } });
  t.until(52001, 0.125);
  const playing = t.until(68100, 0.25);
  assert(playing.every(value => value === Math.fround(0.125)));
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'recording');
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  t.command('practice.control', { control: { id: 'R1' } });
  const before = t.frame;
  const replacement = t.until(85000, 0.25);
  const replacementFrame = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 5 && message.event.state.beat === 1).event.frame);
  assert(replacement.subarray(0, replacementFrame - before).every(value => value === Math.fround(0.125)));
  assert(replacement.subarray(replacementFrame - before).every(value => value === Math.fround(0.25)));
  t.command('practice.control', { control: { id: 'R1' } });
  assert(t.render(1000).every(value => value === 0), 'x stops the loop immediately');
  t.dispose();
});

test('each chart row arms and commits its own capture independently', () => {
  const chartControls = controls();
  chartControls.leadIn.L2 = { kind: 'arm', timing: 'bar' };
  chartControls.bars[1].L2 = { kind: 'commit', timing: 'bar' };
  const t = new Harness({ chartControls });
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  for (const id of ['R1', 'L2']) t.command('practice.control', { control: { id } });
  assert.equal(t.state().channels.filter(channel => channel.status === 'armed').length, 2);
  t.until(36100);
  assert.equal(t.state().channels.filter(channel => channel.status === 'recording').length, 2);
  t.command('practice.control', { control: { id: 'L2' } });
  t.until(53000);
  assert.equal(t.state().channels.find(channel => channel.id === 'L2').looping, true);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'recording');
  t.dispose();
});

test('subdivision cues play only on physical taps and resume an existing loop on the following bar', () => {
  const chartControls = controls();
  chartControls.bars[0].R1 = { kind: 'tap', notation: '&a]', beats: [3.5, 3.75] };
  const t = new Harness({ chartControls, countInBars: 0, preload: true });
  t.render(4100);
  t.processor.sampler.trigger('R1', t.frame, 1, { loop: true });
  t.until(18017);
  const before = t.processor.sampler.triggeredVoices;
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.processor.sampler.triggeredVoices, before + 1);
  assert.equal(t.processor.sampler.voices.find(voice => voice.sample?.id === 'R1').frame, 18017);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, false);
  const first = t.until(19007);
  assert.deepEqual(first.subarray(0, 3), Float32Array.from([0.5, 0.25, 0]));
  assert(first.subarray(3).every(value => value === 0), 'no generated second hit');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.processor.sampler.triggeredVoices, before + 2);
  const second = t.until(20000);
  assert.deepEqual(second.subarray(0, 3), Float32Array.from([0.5, 0.25, 0]));
  assert(second.subarray(3).every(value => value === 0));
  const resumed = t.until(20100);
  const downbeat = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 2 && message.event.state.beat === 1).event.frame);
  assert(resumed.subarray(0, downbeat - 20000).every(value => value === 0));
  assert.deepEqual(resumed.subarray(downbeat - 20000, downbeat - 20000 + 3), Float32Array.from([0.5, 0.25, 0]));
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  t.dispose();
});

test('manual subdivision taps start at the recorded sound while loops preserve leading silence', () => {
  const chartControls = controls();
  chartControls.bars[0].R1 = { kind: 'tap', notation: '&a]', beats: [3.5, 3.75] };
  const t = new Harness({ chartControls, countInBars: 0 });
  const sample = new Float32Array(16000);
  sample.set([0.5, 0.25], 14000);
  t.command('sample.load', { sampleId: 'R1', channels: [sample], sampleRate: rate });
  t.render(4100);
  t.processor.sampler.trigger('R1', t.frame, 1, { loop: true });
  assert(t.render(100).every(value => value === 0), 'ordinary loops preserve their bar phase');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.deepEqual(t.render(3), Float32Array.from([0.5, 0.25, 0]));
  t.dispose();
});

test('hinted live capture maps two late-bar sounds to successive manual taps', () => {
  const chartControls = controls();
  chartControls.bars[0].R1 = { kind: 'commit', timing: 'bar' };
  chartControls.bars[1].R1 = { kind: 'tap', notation: '&a]', beats: [3.5, 3.75] };
  chartControls.leadIn.R1.capture = { kind: 'sparse', beats: [3.5, 3.75], radiusBeats: 0.2 };
  const t = new Harness({ chartControls });
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.until(21000, 0);
  t.command('practice.control', { control: { id: 'R1' } });
  const input = new Float32Array(15100);
  input.fill(0.5, 12960, 13040);
  input.fill(0.25, 14040, 14120);
  t.render(input.length, { input });
  assert.equal(t.processor.recorder.slots.get('R1').frames, 16000);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  t.command('practice.control', { control: { id: 'R1' } });
  const first = t.render(1200);
  assert.equal(first[0], Math.fround(0.5));
  assert(first.subarray(80).every(value => value === 0), 'the first tap never plays the second sound');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.25));
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.5));
  t.until(164100, 0);
  assert.equal(t.state().bar, 2);
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.5), 'a repeated bar starts from the first hit again');
  t.dispose();
});

test('panic after a subdivision tap cancels automatic loop resumption', () => {
  const chartControls = controls();
  chartControls.bars[0].R1 = { kind: 'tap', notation: '&a]', beats: [3.5, 3.75] };
  const t = new Harness({ chartControls, countInBars: 0, preload: true });
  t.render(4100);
  t.processor.sampler.trigger('R1', t.frame, 1, { loop: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.command('practice.control', { control: { id: 'mushroom' } });
  assert(t.until(30000).every(value => value === 0));
  t.dispose();
});

test('a single sparse replacement loops cleanly while later pair cues retain the earlier two hits', () => {
  const chartControls = controls();
  chartControls.leadIn.R1.capture = { kind: 'sparse', beats: [3.5, 3.75], radiusBeats: 0.2 };
  chartControls.bars[0].R1 = { kind: 'commit-arm', timing: 'bar', capture: { kind: 'sparse', beats: [3.5], radiusBeats: 0.2 } };
  chartControls.bars[1].R1 = { kind: 'commit', timing: 'bar' };
  chartControls.bars[2].R1 = { kind: 'tap', notation: '&a]', beats: [3.5, 3.75] };
  const t = new Harness({ chartControls });
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.until(21000, 0);
  t.command('practice.control', { control: { id: 'R1' } });
  const pair = new Float32Array(15100);
  pair.fill(0.5, 12960, 13040);
  pair.fill(0.25, 14040, 14120);
  t.render(pair.length, { input: pair });
  t.command('practice.control', { control: { id: 'R1' } });
  const single = new Float32Array(16000);
  single.fill(0.75, 13920, 14000);
  single.fill(0.3, 15000, 15100);
  t.render(single.length, { input: single });
  const loop = t.until(67200, 0);
  const commitFrame = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 3 && message.event.state.beat === 1).event.frame);
  assert.equal(loop[commitFrame + 14000 - 52100], Math.fround(0.75), 'single sound snaps to 4&');
  assert(loop.subarray(67000 - 52100).every(value => value === 0), 'unrequested later audio is excluded');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(100)[0], Math.fround(0.5));
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.25));
  t.dispose();
});

test('mixer mute preserves loop phase and gain affects an already playing voice', () => {
  const engine = new TestSampleEngine({ sampleRate: rate });
  engine.load('R1', [Float32Array.from([0.1, 0.2, 0.3, 0.4, 0.5])], rate);
  engine.setChannel('R1', { gain: 0.5 });
  engine.trigger('R1', 0, 1, { loop: true });
  const render = (frame, length) => {
    const output = [new Float32Array(length)];
    engine.render(output, frame, 0, length);
    return output[0];
  };
  assert.deepEqual(render(0, 2), Float32Array.from([0.05, 0.1]));
  engine.setChannel('R1', { muted: true });
  assert(render(2, 4).every(value => value === 0));
  engine.setChannel('R1', { muted: false, gain: 1 });
  assert.deepEqual(render(6, 3), Float32Array.from([0.2, 0.3, 0.4]));
  assert.equal(engine.snapshot().activeVoices, 1);
});

test('remote command IDs suppress repeat pad activation and reject changed commands', () => {
  const t = new Harness({ automatic: false });
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  const payload = { control: { id: 'R1' }, commandId: 'tap-1' };
  t.command('practice.control', payload);
  const count = t.processor.sampler.triggeredVoices;
  t.command('practice.control', payload);
  assert.equal(t.processor.sampler.triggeredVoices, count);
  t.port.onmessage({ data: { id: 900, command: 'practice.control', payload: { control: { id: 'R2' }, commandId: 'tap-1' } } });
  assert.equal(t.performance.at(-1).ok, false);
  assert.match(t.performance.at(-1).error, /another control/);
  t.dispose();
});

test('a rejected remote recording control emits a terminal acknowledgement', () => {
  const t = new Harness({ automatic: false });
  t.render(4100);
  t.port.onmessage({ data: { id: 901, command: 'practice.control', payload: { control: { id: 'R1' }, commandId: 'remote-arm' } } });
  assert.equal(t.performance.at(-1).ok, false);
  const acknowledgement = t.performance.find(message => message.event?.commandId === 'remote-arm').event;
  assert.equal(acknowledgement.type, 'control');
  assert.equal(acknowledgement.applied, false);
  assert.match(acknowledgement.error, /microphone/);
  t.dispose();
});

test('recording duration limit commits and starts its loop on the exact limit frame', () => {
  const t = new Harness({ countInBars: 0, automatic: false });
  t.render(4100);
  t.command('sequence.record', { sampleId: 'R1', action: 'start', quantize: 'beat', maxSeconds: 0.01 });
  const begin = t.frame;
  const audio = t.render(4100, { input: new Float32Array(4100).fill(0.25) });
  const slot = t.processor.recorder.slots.get('R1');
  const onset = slot.startFrame + slot.frames - begin;
  assert.equal(slot.reason, 'limit');
  assert(audio.subarray(0, onset).every(value => value === 0));
  assert(audio.subarray(onset).every(value => value === Math.fround(0.25)));
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  t.dispose();
});

test('stop clears armed chart captures and restart waits through a fresh count-in', () => {
  const t = new Harness();
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'armed');
  t.command('practice.stop');
  assert.equal(t.state().recording, null);
  t.command('practice.start', { runId: 'second', bpm: 120, countInBars: 1, automatic: false, endBar: 8 });
  assert(t.render(rate * 6).every(value => value === 0));
  assert.equal(t.state().recording, null);
  t.dispose();
});

test('legacy whole-bar fixture preserves quiet captures and automatically selects retained double takes', () => {
  const chartControls = { leadIn: emptyRow(), bars: Array.from({ length: 12 }, emptyRow) };
  chartControls.bars[1].R2 = { kind: 'arm', timing: 'bar', capture: { kind: 'bar', variantKey: 'cowbell-double' } };
  chartControls.bars[2].R2 = { kind: 'commit-arm', timing: 'bar', capture: { kind: 'bar', variantKey: 'cowbell-single' } };
  chartControls.bars[3].R2 = { kind: 'commit', timing: 'bar' };
  chartControls.bars[10].R2 = { kind: 'stop', timing: 'now' };
  const barPlayback = [5, 6, 7, 8, 9, 10].map(bar => ({ bar, channelId: 'R2', variantKey: bar === 8 || bar === 10 ? 'cowbell-double' : 'cowbell-single' }));
  const t = new Harness({ countInBars: 0, barCount: 12, chartControls, barPlayback });
  t.command('practice.microphone', { enabled: true });
  t.until(20100, 0);
  t.command('practice.control', { control: { id: 'R2' } });
  t.until(36100, 0);
  t.command('practice.control', { control: { id: 'R2' } });
  const pair = new Float32Array(16000);
  pair.fill(0.002, 13700, 13780);
  pair.fill(0.003, 14850, 14930);
  t.render(pair.length, { input: pair });
  t.command('practice.control', { control: { id: 'R2' } });
  const single = new Float32Array(16000);
  single.fill(0.0015, 13950, 14030);
  t.render(single.length, { input: single });
  const doubleTake = t.processor.sampler.sampleFor('R2', 'cowbell-double');
  const singleTake = t.processor.sampler.sampleFor('R2', 'cowbell-single');
  assert.equal(doubleTake.slices.length, 0);
  assert.equal(singleTake.slices.length, 0);
  const doubleAt = doubleTake.channels[0].findIndex(value => value !== 0);
  const singleAt = singleTake.channels[0].findIndex(value => value !== 0);
  const start = t.frame;
  const output = t.until(164100, 0);
  for (const bar of [5, 6, 7, 8, 9, 10]) {
    const downbeat = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === bar && message.event.state.beat === 1).event.frame);
    const isDouble = bar === 8 || bar === 10;
    assert.equal(output[downbeat + (isDouble ? doubleAt : singleAt) - start], Math.fround(isDouble ? 0.002 : 0.0015), `bar ${bar} selects its full take`);
    if (isDouble) assert.equal(output[downbeat + doubleAt + 1150 - start], Math.fround(0.003), 'the captured second hit plays without a second press');
  }
  t.command('practice.control', { control: { id: 'R2' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R2').looping, false);
  assert(t.until(325000, 0).every(value => value === 0), 'automatic take changes never restart a stopped channel');
  t.dispose();
});


test('a sampler-only WASM artifact fails instead of falling back to JavaScript orchestration', () => {
  const oldModule = new WebAssembly.Module(withoutPerformanceExports(wasmBytes));
  const exports = WebAssembly.Module.exports(oldModule).map(entry => entry.name);
  assert(exports.includes('bt_process'));
  assert(exports.includes('st_render'));
  assert(!exports.includes('pf_process'));
  const messages = [];
  const processors = new Map();
  const sandbox = { currentFrame: origin, sampleRate: rate, WebAssembly, Float32Array, Float64Array, DataView,
    NativePerformance, CONTROL_IDS,
    AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
    registerProcessor: (name, processor) => processors.set(name, processor) };
  vm.createContext(sandbox);
  vm.runInContext(sources.join('\n'), sandbox);
  new (processors.get('practice'))({ processorOptions: { module: oldModule, practice: { barCount: 8, program: { lengthBeats: 4, events: [] } } } });
  const fault = messages.find(message => message.type === 'fault');
  assert(fault, 'missing native performance code must prevent startup');
  assert.match(fault.message, /pf_|performance.*(?:export|unavailable|missing)/i);
  assert(!messages.some(message => message.type === 'ready'));
});

test('a bar-quantized arm during a multi-bar count-in waits for the first song bar', () => {
  const t = new Harness({ countInBars: 2 });
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  t.until(35000, 0.25);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'armed');
  assert.equal(t.processor.recorder.slots.get('R1').frames, 0);
  t.until(36100, 0.25);
  const slot = t.processor.recorder.slots.get('R1');
  const firstSongBeat = t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 1 && message.event.state.beat === 1).event.frame;
  assert(Math.abs(firstSongBeat - 36000) < 1e-6);
  assert.equal(slot.startFrame, Math.ceil(firstSongBeat));
  assert.equal(slot.frames, 36100 - Math.ceil(firstSongBeat));
  assert.equal(t.state().bar, 1);
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'recording');
  t.dispose();
});

test('native chart instructions remain unchanged when the uploaded JS definition is edited', () => {
  const chartControls = controls();
  const t = new Harness({ chartControls });
  chartControls.leadIn.R1 = { kind: 'stop', timing: 'now' };
  chartControls.bars[1].R1 = { kind: 'stop', timing: 'now' };
  t.render(4100);
  t.command('practice.microphone', { enabled: true });
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'armed');
  t.until(36100);
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'stopping');
  const rendered = t.until(53000);
  assert(rendered.some(value => value === Math.fround(0.125)), 'the original native commit cue starts its captured loop');
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  t.dispose();
});


const slapback = { kind: 'slapback', delayMs: 100, feedback: 0, wet: 0.25 };
function rejectCommand(harness, command, payload) {
  harness.port.onmessage({ data: { id: ++harness.request, command, payload } });
  const reply = harness.performance.at(-1);
  assert.equal(reply.id, harness.request);
  assert.equal(reply.ok, false);
  return reply;
}

test('actual WASM exposes prepared native effects and renders mono live PCM only on its second stereo bus', () => {
  for (const chunk of [127, 128, 10037]) {
    const t = new Harness({ countInBars: 0, liveEffects: [slapback], microphone: true });
    assert.deepEqual(t.state().liveEffects, { prepared: true, active: true, revision: 1, stageCount: 1, captureSupported: false });
    const input = new Float32Array(10037); input[0] = 1;
    const { mixed, live } = t.renderStems(input.length, { chunk, input });
    assert(mixed.every(channel => channel.every(value => value === 0)), 'sample/click bus excludes processed live voice');
    assert.deepEqual(live[0], live[1], 'mono reaches both channels equally');
    for (let frame = 0; frame < input.length; frame++) {
      assert.equal(live[0][frame], frame === 0 ? 1 : frame === 800 ? 0.25 : 0, `native live frame ${frame}`);
    }
    assert(!t.messages.some(message => message.type === 'fault'));
    t.dispose();
  }
});

test('processed live voice does not delay or change the mandatory count-in click', () => {
  const baseline = new Harness({ audibleClick: true });
  const wet = new Harness({ audibleClick: true, liveEffects: [slapback], microphone: true });
  const input = new Float32Array(rate * 3); input[0] = 1;
  const dryClick = baseline.render(input.length, { input });
  const { mixed, live } = wet.renderStems(input.length, { input });
  assert.deepEqual(mixed[0], dryClick);
  assert.deepEqual(mixed[0], mixed[1]);
  assert(dryClick.some(value => value !== 0), 'fixture contains real native count-in clicks');
  assert.equal(live[0][0], 1);
  assert.equal(live[0][800], 0.25);
  assert(live[0].subarray(801).every(value => value === 0), 'click never enters effects');
  baseline.dispose(); wet.dispose();
});

test('old API and null live channels still advance live DSP exactly once', () => {
  for (const route of ['legacy', 'no-live-channels', 'left-live-only']) {
    const t = new Harness({ countInBars: 0, liveEffects: [slapback], microphone: true });
    const input = new Float32Array(100); input[0] = 1;
    if (route === 'legacy') t.render(100, { input });
    else {
      const mixed = [new Float32Array(100), new Float32Array(100)];
      const voice = route === 'left-live-only' ? [new Float32Array(100)] : [];
      t.sandbox.currentFrame = origin + t.frame;
      t.processor.process([[input]], [mixed, voice]);
      t.frame += 100;
      assert(mixed.every(channel => channel.every(value => value === 0)));
      if (voice.length) assert.equal(voice[0][0], 1);
    }
    const { live } = t.renderStems(900);
    for (let frame = 0; frame < 900; frame++) assert.equal(live[0][frame], frame === 700 ? 0.25 : 0, route);
    assert.deepEqual(live[0], live[1]);
    t.dispose();
  }
});

test('effect command validation preserves applied revision and rejects runtime edits without muting live', () => {
  const t = new Harness({ countInBars: 0, liveEffects: [slapback], microphone: true });
  const before = t.state().liveEffects;
  for (const effect of [{ ...slapback, wet: NaN }, { ...slapback, delayMs: '100' }, { ...slapback, kind: 'chorus' }]) {
    assert.match(rejectCommand(t, 'practice.effects', { effects: [effect] }).error, /invalid/i);
    assert.deepEqual(t.state().liveEffects, before);
  }
  assert.match(rejectCommand(t, 'practice.effects', { effects: [{ ...slapback, wet: 0.5 }] }).error, /effects|stop|stopped|idle|running/i);
  assert.deepEqual(t.state().liveEffects, before);
  const input = new Float32Array(801); input[0] = 1;
  const { live } = t.renderStems(input.length, { input });
  assert.equal(live[0][800], 0.25);
  t.command('practice.stop');
  t.command('practice.effects', { effects: [] });
  assert.deepEqual(t.state().liveEffects, { prepared: true, active: false, revision: 2, stageCount: 0, captureSupported: true });
  t.dispose();
});

test('unsupported effects capture is a rejected command while live processing continues', () => {
  const t = new Harness({ liveEffects: [slapback], microphone: true });
  assert.match(rejectCommand(t, 'practice.control', { control: { id: 'R1' } }).error, /capture|sampling/i);
  assert.match(rejectCommand(t, 'record.start', { sampleId: 'R1' }).error, /capture/i);
  assert.match(rejectCommand(t, 'sequence.record', { sampleId: 'R1', action: 'start' }).error, /capture/i);
  assert.equal(t.processor.recorder.slots.size, 0);
  assert.equal(t.state().liveEffects.active, true);
  assert.equal(t.state().recording, null);
  assert(!t.performance.some(message => message.event?.type === 'fault'));
  assert(!t.messages.some(message => message.type === 'fault'));
  const input = new Float32Array(801); input[0] = 1;
  assert.equal(t.renderStems(input.length, { input }).live[0][800], 0.25);
  t.dispose();
});

test('native Stop, Panic, microphone loss and nonloop end gate both live channels without stale restart', () => {
  for (const stop of ['stop', 'panic', 'microphone-loss', 'performance-stop-all']) {
    const t = new Harness({ countInBars: 0, liveEffects: [slapback], microphone: true });
    const input = new Float32Array(100); input[0] = 1;
    t.renderStems(input.length, { input });
    if (stop === 'stop') t.command('practice.stop');
    else if (stop === 'panic') t.command('practice.control', { control: { id: 'mushroom' } });
    else if (stop === 'performance-stop-all') t.command('performance.stopAll');
    else t.command('practice.microphone', { enabled: false });
    assert.equal(t.state().liveEffects.active, false);
    t.command('practice.microphone', { enabled: true });
    assert.equal(t.state().liveEffects.active, false, 'microphone readiness alone cannot reauthorize live output');
    assert(t.renderStems(1000, { input: new Float32Array(1000).fill(0.5) }).live.every(channel => channel.every(value => value === 0)), stop);
    t.command('practice.stop');
    t.command('practice.start', { runId: 'fresh', bpm: 120, countInBars: 0, automatic: false, endBar: 8 });
    assert(t.renderStems(1000).live.every(channel => channel.every(value => value === 0)), 'new run has no stale echo');
    t.dispose();
  }
  const ended = new Harness({ countInBars: 0, barCount: 1, loop: false, liveEffects: [slapback], microphone: true });
  const output = ended.renderStems(20128, { input: new Float32Array(20128).fill(0.125), chunk: 20128 });
  assert.equal(ended.state().phase, 'ended');
  assert.equal(ended.state().liveEffects.active, false);
  const endEvent = ended.performance.find(message => message.event?.type === 'beat' && message.event.state.phase === 'ended').event;
  const endFrame = Math.ceil(endEvent.frame);
  assert(Math.abs(endFrame - 20000) <= 1, 'end crossing has the expected musical position');
  assert(output.live[0].subarray(0, endFrame).every(value => value > 0));
  assert(output.live[0].subarray(endFrame).every(value => value === 0), 'segment after native end boundary is silent');
  assert.deepEqual(output.live[0], output.live[1]);
  ended.dispose();
});

test('worklet render failures silence every output bus', () => {
  const t = new Harness({ countInBars: 0, liveEffects: [slapback], microphone: true });
  const originalProcess = t.processor.native.process;
  t.processor.native.process = () => { throw new Error('injected rendering failure'); };
  const outputs = Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => new Float32Array(128).fill(1)));
  t.processor.process([[new Float32Array(128)]], outputs);
  assert(outputs.every(bus => bus.every(channel => channel.every(value => value === 0))));
  assert(t.messages.some(message => message.type === 'fault' && /injected/.test(message.message)));
  t.processor.native.process = originalProcess;
  t.command('practice.microphone', { enabled: true });
  assert.equal(t.state().liveEffects.active, false, 'a fatal render failure clears native authorization');
  assert(t.renderStems(1000, { input: new Float32Array(1000).fill(.5) }).live.every(channel => channel.every(value => value === 0)), 'later quanta stay silent without a valid Start');
  t.command('practice.start', { runId: 'recovered', bpm: 120, countInBars: 0, automatic: false, endBar: 8 });
  assert(t.renderStems(1000).live.every(channel => channel.every(value => value === 0)), 'fresh Start contains no stale tail');
  t.dispose();
});
