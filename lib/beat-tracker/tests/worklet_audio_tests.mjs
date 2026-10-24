import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { pulsePCM } from './wasm_tests.mjs';

const module = await WebAssembly.compile(await readFile(new URL('../dist/beat-tracker.wasm', import.meta.url)));
const code = await readFile(new URL('../../../ui/practice/runtime/beat-worklet.js', import.meta.url), 'utf8');
const rate = 48000;

class AudioHarness {
  constructor() {
    this.messages = [];
    this.frame = 0;
    this.sequence = 0;
    let Processor;
    const messages = this.messages;
    this.sandbox = { currentFrame: 13579, sampleRate: rate, WebAssembly,
      AudioWorkletProcessor: class { constructor() { this.port = { postMessage: message => messages.push(message) }; } },
      registerProcessor: (name, implementation) => { Processor = implementation; } };
    vm.createContext(this.sandbox);
    vm.runInContext(code.replace('export class BeatProcessor', 'class BeatProcessor'), this.sandbox);
    this.processor = new Processor({ processorOptions: { module } });
    assert.equal(this.messages[0].type, 'ready');
  }

  send(message) {
    this.processor.receive(message);
    return this.messages.at(-1);
  }

  command(command, value = 0) {
    const state = this.poll().snapshot;
    const reply = this.send({ type: 'command', command, value, contextFrame: 13579 + this.frame,
      sequence: ++this.sequence, epoch: state[1] });
    assert.equal(reply.result, 0);
    return reply;
  }

  poll() { return this.send({ type: 'poll' }); }
  click(enabled) { return this.send({ type: 'click', enabled }); }

  render(frames, { chunk = 128, input = null, poll = true } = {}) {
    const result = new Float32Array(frames);
    for (let offset = 0; offset < frames; offset += chunk) {
      const length = Math.min(chunk, frames - offset);
      const output = new Float32Array(length);
      this.sandbox.currentFrame = 13579 + this.frame;
      assert.equal(this.processor.process([input ? [input.subarray(offset, offset + length)] : []], [[output]]), true);
      this.frame += length;
      result.set(output, offset);
      if (poll) this.poll();
    }
    return result;
  }

  events() {
    const result = [];
    for (const message of this.messages) {
      for (let offset = 0; offset < message.events.length; offset += 12) result.push(Array.from(message.events.slice(offset, offset + 12)));
    }
    return result;
  }

  dispose() { this.send({ type: 'dispose' }); }
}

function assertClockOutput(samples, events, origin = 0, barStartSerial = 0) {
  const clocks = events.filter(event => event[0] === 1);
  assert(clocks.length > 0, 'real C++ clock emitted crossings');
  let cursor = 0;
  let crossing = -Infinity;
  let downbeat = false;
  const duration = Math.ceil(rate * 0.012);
  const valueAt = index => index >= duration ? 0 : Math.fround((downbeat ? 0.12 : 0.08) *
    Math.cos(2 * Math.PI * (downbeat ? 2100 : 1400) * index / rate) *
    Math.exp(-index / rate / 0.002) * (1 - index / duration));
  for (let index = 0; index < samples.length; index++) {
    const frame = origin + index;
    while (cursor < clocks.length && clocks[cursor][2] <= frame) {
      downbeat = (clocks[cursor][1] - barStartSerial - 1) % 4 === 0;
      crossing = clocks[cursor++][2];
    }
    const age = frame - crossing;
    let expected = 0;
    if (age >= 0 && age < duration) {
      const sample = Math.floor(age);
      expected = Math.fround(valueAt(sample) + (age - sample) * (valueAt(sample + 1) - valueAt(sample)));
    }
    assert(expected === 0 ? samples[index] === 0 : Math.abs(samples[index] - expected) < 1e-8,
      `only the exact clock crossing drives output at frame ${frame}`);
  }
  assert(samples.some(value => value !== 0), 'clock produced audible output');
  assert(samples.every(value => Math.abs(value) <= 0.121), 'click gain is bounded');
}

function clickPeaks(samples, events, origin = 0) {
  return events.filter(event => event[0] === 1 && event[2] >= origin && event[2] + rate * 0.012 < origin + samples.length)
    .map(event => {
      const begin = Math.ceil(event[2] - origin);
      return Math.max(...samples.subarray(begin, begin + Math.ceil(rate * 0.012)).map(Math.abs));
    });
}

function assertAccentPattern(peaks, accented) {
  assert.equal(peaks.length, accented.length, 'each expected beat has a complete rendered click');
  for (let index = 0; index < peaks.length; index++) {
    assert(accented[index] ? peaks[index] > 0.10 : peaks[index] > 0.06 && peaks[index] < 0.081,
      `beat ${index + 1} is ${accented[index] ? 'accented' : 'soft'} in the rendered audio`);
  }
}

{
  const t = new AudioHarness();
  assert.equal(t.poll().clickEnabled, false);
  t.command(1, 120);
  const audio = t.render(rate);
  assert(audio.every(value => value === 0), 'click defaults off');
  assert(t.events().some(event => event[0] === 1), 'muting preserves clock telemetry');
  t.dispose();
}

const traces = [];
for (const chunk of [1, 127, 128, 8192, 16000]) {
  const t = new AudioHarness();
  t.command(1, 123);
  t.click(true);
  const audio = t.render(rate * 2, { chunk });
  const events = t.events();
  assertClockOutput(audio, events);
  assert.equal(t.poll().snapshot[17], 0, 'normal telemetry has no drops');
  assert.equal(t.poll().snapshot[14], 0, 'click is absent from the analyzer input');
  traces.push(events.filter(event => event[0] === 1).map(event => event.slice(0, 4)));
  t.dispose();
}
for (const trace of traces) assert.deepEqual(trace, traces[0], 'clock telemetry is identical across render block sizes');

{
  const t = new AudioHarness();
  t.command(2, 120);
  t.click(true);
  const first = t.render(rate * 4 + 1024);
  assertAccentPattern(clickPeaks(first, t.events()), [true, false, false, false, true, false, false, false]);
  t.click(false);
  assert(t.render(rate).every(value => value === 0), 'muted beats remain silent');
  t.click(true);
  const origin = t.frame;
  const resumed = t.render(rate * 2);
  assertAccentPattern(clickPeaks(resumed, t.events(), origin), [false, false, true, false]);
  assertClockOutput(resumed, t.events().filter(event => event[2] >= origin), origin);
  t.command(4);
  const followOrigin = t.frame;
  const follow = t.render(rate);
  assertAccentPattern(clickPeaks(follow, t.events(), followOrigin), [false, false]);
  t.command(2, 100);
  const tempoOrigin = t.frame;
  const changed = t.render(rate * 2);
  assertAccentPattern(clickPeaks(changed, t.events(), tempoOrigin), [true, false, false]);
  t.command(6);
  t.command(2, 120);
  const resetOrigin = t.frame;
  const reset = t.render(rate + 1024);
  assertAccentPattern(clickPeaks(reset, t.events().filter(event => event[4] === 2), resetOrigin), [true, false]);
  t.dispose();
}

{
  const t = new AudioHarness();
  t.command(2, 120);
  t.click(true);
  const first = t.render(24064);
  assert(first.subarray(24001).some(value => value !== 0), 'mute begins during a live click tail');
  assert.equal(t.click(false).clickEnabled, false);
  assert(t.render(128).every(value => value === 0), 'disable cancels the remaining tail');
  t.click(true);
  assert(t.render(128).every(value => value === 0), 're-enable cannot replay a muted tail');
  t.render(24000);
  const reset = t.command(6);
  const barStartSerial = reset.snapshot[9];
  assert.equal(reset.snapshot[1], 2);
  assert.equal(reset.clickEnabled, true, 'reset retains click preference');
  assert(t.render(rate).every(value => value === 0), 'reset cancels the active tail and old timeline');
  const origin = t.frame;
  t.command(1, 120);
  const audio = t.render(rate);
  assertClockOutput(audio, t.events().filter(event => event[4] === 2), origin, barStartSerial);
  assert.equal(t.poll().snapshot[3], 1, 'reset preserves Manual mode');
  t.command(4);
  const followOrigin = t.frame;
  const followAudio = t.render(rate * 5);
  assertClockOutput(followAudio, t.events().filter(event => event[0] === 1 && event[2] >= followOrigin - rate), followOrigin, barStartSerial);
  assert.equal(t.poll().snapshot[4], 2, 'Follow clock keeps clicking through silent coasting');
  t.dispose();
}

{
  const t = new AudioHarness();
  t.click(true);
  const p = t.processor;
  for (let index = 0; index < 130; index++) p.api.bt_observe(p.tracker, 0, 0, 120, 1, 0);
  assert(t.render(128).every(value => value === 0), 'raw rejected detections cannot click');
  assert.equal(t.events().filter(event => event[0] === 2).length, 130,
    'draining multiple scratch batches preserves every raw detection');
  assert.equal(t.poll().snapshot[17], 0);
  t.dispose();
}

{
  const input = pulsePCM(12, 8);
  const traces = [];
  for (const enabled of [false, true]) {
    const t = new AudioHarness();
    t.command(1, 120);
    t.click(enabled);
    const audio = t.render(input.length, { input });
    const events = t.events();
    assert(events.some(event => event[0] === 2) && events.some(event => event[0] === 3), 'actual PCM reaches detector and follower');
    if (enabled) assertClockOutput(audio, events);
    else assert(audio.every(value => value === 0), 'input is never monitored to output');
    traces.push(events);
    assert.equal(t.poll().snapshot[17], 0);
    t.dispose();
  }
  assert.deepEqual(traces[0], traces[1], 'click output leaves every clock, detection, acceptance and acknowledgment unchanged');
}

{
  const t = new AudioHarness();
  t.render(1);
  t.command(2, 240);
  t.click(true);
  const audio = t.render(rate * 130, { chunk: 8192, poll: false });
  assert(audio.some(value => value !== 0), 'click rendering runs without main-thread polling');
  const reply = t.poll();
  assert.equal(reply.events.length, 512 * 12, 'unpolled telemetry remains bounded');
  assert(reply.snapshot[17] > 0, 'overflow test fills the worklet telemetry ring');
  assert.equal(reply.snapshot[17], reply.snapshot[9] - 512, 'every worklet telemetry overflow is counted');
  assert.equal(reply.events[1], reply.snapshot[17] + 1, 'overflow retains the most recent clock events in order');
  t.dispose();
}

console.log('PASS real WASM worklet audio. Accented four-beat bars, bar phase through mute/reset, exact fractional clock alignment across block sizes, default mute, tail mute/reset, Manual/Follow coasting, analyzer isolation, complete telemetry and bounded overflow.');
