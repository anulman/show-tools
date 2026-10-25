import assert from 'node:assert/strict';
import test from 'node:test';
import { NativePerformance } from '../../../lib/performance/wasm-performance.ts';
import { nativeApi, own } from '../../../lib/sequencer/tests/support/native-runtime.ts';

const engine = options => own(new NativePerformance({ api: nativeApi, sampleRate: 8000, clickGain: 0, ...options }));
function triggers(performance) {
  const count = performance.sampler.call('pf_trigger_count', performance.handle);
  return Array.from({ length: count }, (_, index) => {
    performance.sampler.invoke('pf_trigger_info', performance.handle, index, performance.sampler.scratch);
    const row = new Float64Array(performance.sampler.memory.buffer, performance.sampler.scratch, 3);
    return Array.from(row);
  });
}

const crossing = (performance, id, epoch) => performance.onBeat(id, id * 4000, epoch);

test('native count-in precedes the first song beat and looping preserves the chosen range', () => {
  const performance = engine({ barCount: 8, endBar: 8, program: { lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'R1' }] } });
  performance.start({ runId: 'first', startBar: 3, endBar: 3, automatic: true });
  for (let id = 41; id < 45; id++) {
    crossing(performance, id, 2);
    assert.deepEqual(triggers(performance), []);
    assert.equal(performance.state().bar, null);
    assert.equal(performance.state().countInRemaining, 45 - id);
  }
  crossing(performance, 45, 2);
  assert(triggers(performance).length > 0);
  assert.equal(performance.state().bar, 3);
  assert.equal(performance.state().beat, 1);
  for (let id = 46; id <= 49; id++) crossing(performance, id, 2);
  assert.equal(performance.state().bar, 3);
  assert.equal(performance.state().beat, 1);
});

test('duplicate native crossings do nothing and gaps or changed epochs stop transport', () => {
  for (const next of [{ id: 4, epoch: 1 }, { id: 3, epoch: 2 }]) {
    const performance = engine({ barCount: 218, endBar: 76 });
    performance.start({ runId: 'first', countInBars: 0 });
    crossing(performance, 2, 1);
    performance.events();
    crossing(performance, 2, 1);
    assert.equal(performance.events().length, 0, 'duplicate crossing does not publish or advance');
    try { crossing(performance, next.id, next.epoch); } catch {}
    assert.equal(performance.state().phase, 'idle');
    const fault = performance.events().find(event => event.type === 'fault');
    assert(fault, 'the native transport reports a fault');
    assert.match(fault.error, /clock.*(?:restarted|missed a beat)/i);
  }
});

test('stopping cancels count-in and every native restart has a fresh event sequence', () => {
  const performance = engine({ barCount: 218, endBar: 76 });
  performance.start({ runId: 'first' });
  assert.equal(performance.events().at(-1).seq, 1);
  crossing(performance, 10, 1);
  performance.stop();
  performance.events();
  crossing(performance, 11, 1);
  assert.equal(performance.events().length, 0);
  performance.start({ runId: 'second', countInBars: 0, startBar: 2, endBar: 2, loop: false });
  assert.equal(performance.events().at(-1).seq, 1);
  for (let id = 12; id < 16; id++) crossing(performance, id, 1);
  crossing(performance, 16, 1);
  assert.equal(performance.state().phase, 'ended');
});

test('bad native ranges and options leave transport stopped', () => {
  const performance = engine({ barCount: 218, endBar: 76 });
  for (const options of [{ bpm: 0 }, { startBar: 0 }, { countInBars: 0.5 }, { endBar: 300 }, { loop: 'yes' }]) {
    assert.throws(() => performance.start({ runId: 'bad', ...options }));
    assert.equal(performance.state().phase, 'idle');
  }
});

test('WASM integer limits reject wrapped song, transport, and voice settings', () => {
  for (const options of [
    { barCount: 4294967297, endBar: 4294967297 },
    { maxVoices: 4294967328 }, { mode: 4294967298 }, { beatsPerBar: 4294967300 },
    { program: { lengthBeats: 4294967300, events: [] } },
  ]) assert.throws(() => engine(options));
  const performance = engine({ barCount: 8 });
  for (const options of [
    { countInBars: 4294967296 }, { startBar: 4294967297 }, { endBar: 4294967297 },
  ]) assert.throws(() => performance.start({ runId: 'overflow', ...options }));
  assert.equal(performance.state().phase, 'idle');
});

test('generic native performance retains its configured meter', () => {
  const performance = engine({ mode: 1, beatsPerBar: 3 });
  performance.onBeat(10, 0, 1);
  assert.equal(performance.sequencer.snapshot().beatsPerBar, 3);
  assert.equal(performance.sequencer.snapshot().beat, 1);
  performance.onBeat(11, 4000, 1);
  performance.onBeat(12, 8000, 1);
  assert.equal(performance.sequencer.snapshot().beat, 3);
  performance.onBeat(13, 12000, 1);
  assert.equal(performance.sequencer.snapshot().beat, 1);
  assert.equal(performance.sequencer.snapshot().bar, 2);
});

test('native chart capture honors the configured recording limit', () => {
  const row = () => ({ L1: { kind: 'none' }, L2: { kind: 'none' }, R1: { kind: 'none' }, R2: { kind: 'none' } });
  const leadIn = row(); leadIn.R1 = { kind: 'arm', timing: 'now' };
  const performance = engine({ maxSeconds: 1, program: { lengthBeats: 4, events: [], controls: { leadIn, bars: [row()] } } });
  performance.setMicrophone(true);
  performance.start({ runId: 'limited' });
  performance.control({ id: 'R1' });
  assert.equal(performance.recorder.snapshot().find(slot => slot.id === 'R1').maxSeconds, 1);
  performance.process(new Float32Array(8000).fill(.125), [new Float32Array(8000)], 8000);
  assert.equal(performance.recorder.isRecording('R1'), false);
  assert.equal(performance.sampler.sampleFor('R1').length, 8000);
});

test('invalid native program replacement preserves the prior song definition', () => {
  const performance = engine({ bpm: 120, barCount: 8, endBar: 8, program: { lengthBeats: 1, events: [{ atBeat: 0, sampleId: 'R1' }] } });
  const before = performance.state();
  const result = performance.sampler.invoke('pf_configure', performance.handle, 99, 4, 2, 2, 0, 0, 0, 0, 0, 0, 0);
  assert.equal(result, -1);
  assert.equal(performance.state().bpm, before.bpm);
  assert.equal(performance.state().endBar, before.endBar);
  performance.start({ runId: 'retained', countInBars: 0, startBar: 8, endBar: 8, automatic: true });
  crossing(performance, 1, 1);
  assert.equal(performance.state().bar, 8);
  assert.equal(triggers(performance).length, 1);
});

const emptyCues = () => ({ L1: { kind: 'none' }, L2: { kind: 'none' }, R1: { kind: 'none' }, R2: { kind: 'none' } });
function render(performance, length) {
  const output = [new Float32Array(length)];
  performance.process(null, output, length);
  return output[0];
}

test('distinct continuous-sample tap cues do not reserve capture variants', () => {
  const bars = Array.from({ length: 17 }, (_, index) => {
    const row = emptyCues();
    row.R1 = { kind: 'tap', notation: `${index}`, beats: [index / 8] };
    return row;
  });
  const performance = engine({ barCount: bars.length, endBar: bars.length, program: { lengthBeats: 4, events: [], controls: { leadIn: emptyCues(), bars } } });
  performance.sampler.load('R1', [Float32Array.from([0.5, 0.25, 0])], 8000);
  performance.start({ runId: 'continuous-taps', countInBars: 0, loop: false });
  for (let bar = 1; bar <= bars.length; bar++) {
    render(performance, 4000 + (bar - 1) * 16000 + 128 - performance.processedFrames);
    assert.equal(performance.state().bar, bar);
    performance.control({ id: 'R1' });
    assert.deepEqual(render(performance, 3), Float32Array.from([0.5, 0.25, 0]));
  }
  assert.equal(performance.sampler.triggeredVoices, 17);
});

test('an earlier tap cue selects the sparse variant declared by a later capture hint', () => {
  const bars = Array.from({ length: 2 }, emptyCues);
  bars[0].R1 = { kind: 'tap', notation: '1& 2&', beats: [0.5, 1.5] };
  bars[1].R1 = { kind: 'arm', timing: 'bar', capture: { kind: 'sparse', beats: [0.5, 1.5], radiusBeats: 0.1 } };
  const performance = engine({ barCount: 2, endBar: 2, program: { lengthBeats: 4, events: [], controls: { leadIn: emptyCues(), bars } } });
  const pair = new Float32Array(4000);
  pair[1000] = 0.5; pair[3000] = 0.25;
  performance.recorder.prepare('R1', { maxSeconds: 1, transients: { key: '0.5,1.5', expectedFrames: [1000, 3000], radiusFrames: 100 } });
  performance.recorder.start('R1', 0);
  performance.recorder.capture(pair, 0, pair.length, 0);
  performance.recorder.stop('R1', pair.length);
  const single = new Float32Array(2000); single[1000] = 0.75;
  performance.recorder.prepare('R1', { maxSeconds: 1, transients: { key: 'single', expectedFrames: [1000], radiusFrames: 100 } });
  performance.recorder.start('R1', 4000);
  performance.recorder.capture(single, 0, single.length, 4000);
  performance.recorder.stop('R1', 6000);
  performance.start({ runId: 'retained-pair', countInBars: 0 });
  render(performance, 4100);
  performance.control({ id: 'R1' });
  assert.equal(render(performance, 1)[0], 0.5);
  performance.control({ id: 'R1' });
  assert.equal(render(performance, 1)[0], 0.25, 'the pair survives replacement by a different sparse take');
});

test('native command IDs preserve Unicode code units and embedded NUL characters', () => {
  const performance = engine({ barCount: 1 });
  for (const id of ['é'.repeat(200), '🎹'.repeat(100), '\ud800']) {
    performance.control({ id: 'knob', value: 0.25 }, id);
    performance.control({ id: 'knob', value: 0.25 }, id);
    assert.throws(() => performance.control({ id: 'knob', value: 0.5 }, id), /another control/);
  }
  performance.control({ id: 'knob', value: 0.5 }, 'name\0one');
  performance.control({ id: 'knob', value: 0.75 }, 'name\0two');
  assert.equal(performance.state().channels.find(channel => channel.id === 'R1').gain, 0.75);
  const events = performance.events().filter(event => event.type === 'control');
  assert.deepEqual(events.slice(-2).map(event => event.commandId), ['name\0one', 'name\0two']);
  assert.deepEqual(events.slice(0, 3).map(event => event.applied), [true, true, false]);
});
