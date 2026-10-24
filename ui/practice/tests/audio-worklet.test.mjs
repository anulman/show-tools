import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { SampleEngine } from '../../../lib/sampler/sample-engine.js';
import { SampleRecorder } from '../../../lib/sampler/sample-recorder.js';
import { AudioSequenceEngine } from '../../../lib/sequencer/audio-sequence-engine.js';
import { PracticeEngine } from '../practice-engine.js';
import { CONTROL_IDS } from '../../../lib/performance/model.js';
import { sourceForVM } from '../../../scripts/source-for-vm.ts';

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
const wasm = await WebAssembly.compile(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)));
const sources = await Promise.all(['../runtime/beat-worklet.js', '../runtime/performance-worklet.js', '../practice-worklet.ts']
  .map(async path => (await sourceForVM(new URL(path, import.meta.url))).replace(/^import .*;\n/gm, '').replace(/export class /g, 'class ')));

class Harness {
  constructor({ bpm = 120, countInBars = 1, automatic = false, loop = true, preload = false, chartControls = controls(), audibleClick = false } = {}) {
    this.frame = 0;
    this.sequence = 0;
    this.request = 0;
    this.messages = [];
    this.performance = [];
    const processors = new Map();
    const messages = this.messages;
    this.sandbox = { currentFrame: origin, sampleRate: rate, WebAssembly, Float32Array, Float64Array, DataView,
      SampleEngine, SampleRecorder, AudioSequenceEngine, PracticeEngine, CONTROL_IDS,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
      registerProcessor: (name, processor) => processors.set(name, processor) };
    vm.createContext(this.sandbox);
    vm.runInContext(sources.join('\n'), this.sandbox);
    this.processor = new (processors.get('practice'))({ processorOptions: { module: wasm, practice: { barCount: 8, endBar: 8, program: { ...program, controls: chartControls } } } });
    assert.equal(messages[0].type, 'ready', messages[0].message);
    if (!audibleClick) for (const click of this.processor.clicks) click.fill(0);
    this.port = { start() {}, close() {}, postMessage: message => this.performance.push(message) };
    this.processor.receive({ type: 'performance-connect', port: this.port });
    if (preload) for (const sampleId of CONTROL_IDS) this.command('sample.load', { sampleId, channels: [Float32Array.from([0.5, 0.25, 0])], sampleRate: rate });
    this.tracker(2, bpm);
    this.command('practice.start', { runId: 'first', bpm, countInBars, automatic, loop, endBar: 8 });
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

  until(frame, value = 0.125) { return this.render(frame - this.frame, { input: new Float32Array(frame - this.frame).fill(value) }); }

  state() { return this.command('state').state.practice; }
  dispose() { this.processor.receive({ type: 'dispose' }); }
}

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
    assert(Math.abs(audio[firstFrame] - 3 * 0.8 * (0.5 - age * 0.25)) < 1e-5);
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
  assert(output.subarray(commitFrame - before).every(value => value === Math.fround(0.125 * 0.8)));
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
  assert(ending.subarray(0, stopFrame - stopStart).every(value => value === Math.fround(0.125 * 0.8)));
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
  assert(playing.every(value => value === Math.fround(0.125 * 0.8)));
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').status, 'recording');
  assert.equal(t.state().channels.find(channel => channel.id === 'R1').looping, true);
  t.command('practice.control', { control: { id: 'R1' } });
  const before = t.frame;
  const replacement = t.until(85000, 0.25);
  const replacementFrame = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 5 && message.event.state.beat === 1).event.frame);
  assert(replacement.subarray(0, replacementFrame - before).every(value => value === Math.fround(0.125 * 0.8)));
  assert(replacement.subarray(replacementFrame - before).every(value => value === Math.fround(0.25 * 0.8)));
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
  assert.deepEqual(first.subarray(0, 3), Float32Array.from([0.4, 0.2, 0]));
  assert(first.subarray(3).every(value => value === 0), 'no generated second hit');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.processor.sampler.triggeredVoices, before + 2);
  const second = t.until(20000);
  assert.deepEqual(second.subarray(0, 3), Float32Array.from([0.4, 0.2, 0]));
  assert(second.subarray(3).every(value => value === 0));
  const resumed = t.until(20100);
  const downbeat = Math.ceil(t.performance.find(message => message.event?.type === 'beat' && message.event.state.bar === 2 && message.event.state.beat === 1).event.frame);
  assert(resumed.subarray(0, downbeat - 20000).every(value => value === 0));
  assert.deepEqual(resumed.subarray(downbeat - 20000, downbeat - 20000 + 3), Float32Array.from([0.4, 0.2, 0]));
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
  assert.deepEqual(t.render(3), Float32Array.from([0.4, 0.2, 0]));
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
  assert.equal(first[0], Math.fround(0.4));
  assert(first.subarray(80).every(value => value === 0), 'the first tap never plays the second sound');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.2));
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.4));
  t.until(164100, 0);
  assert.equal(t.state().bar, 2);
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.4), 'a repeated bar starts from the first hit again');
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
  assert.equal(loop[commitFrame + 14000 - 52100], Math.fround(0.6), 'single sound snaps to 4&');
  assert(loop.subarray(67000 - 52100).every(value => value === 0), 'unrequested later audio is excluded');
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(100)[0], Math.fround(0.4));
  t.command('practice.control', { control: { id: 'R1' } });
  assert.equal(t.render(1)[0], Math.fround(0.2));
  t.dispose();
});

test('mixer mute preserves loop phase and gain affects an already playing voice', () => {
  const engine = new SampleEngine({ sampleRate: rate });
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
  assert(audio.subarray(onset).every(value => value === Math.fround(0.25 * 0.8)));
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
