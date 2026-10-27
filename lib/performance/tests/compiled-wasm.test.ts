import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compiledCaptureFixture as fixture } from './fixtures/compiled-capture.js';
import { encodeCompiledProgram, compiledProgramBytes } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(program: readonly number[], rate = 8000) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory');
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE, compiledProgram: program, clickGain: 0 });
}
function render(native: NativePerformance, frames: number, value: number | ((frame: number) => number) = .25) {
  const begin = native.processedFrames;
  const input = Float32Array.from({ length: frames }, (_, index) => typeof value === 'number' ? value : value(begin + index));
  const mixed = [new Float32Array(frames), new Float32Array(frames)];
  const live = [new Float32Array(frames), new Float32Array(frames)];
  native.process(input, mixed, frames, live);
  return { mixed, live, events: native.events() };
}
function until(native: NativePerformance, bar: number, beat = 1, input = .25) {
  for (let attempts = 0; attempts < 10000; attempts++) {
    const state = native.state();
    if (state.bar === bar && state.beat === beat && state.phase === 'playing') return;
    render(native, 64, input);
  }
  throw new Error(`Did not reach ${bar}:${beat}`);
}

test('compiled artifact drives effected WASM capture, crb handoff, layer autoplay, fractional stop, and both download stems', async () => {
  const song = await fixture();
  assert(song.executable);
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    assert.equal(native.liveEffects().captureSupported, true);
    native.setMicrophone(true);
    native.start({ runId: 'joint-fixture', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' }, 'arm');
    assert.equal(native.compiledTake(0).frames, 0, 'arming switches the route without capturing early audio');
    until(native, 1);
    native.control({ id: 'R1' }, 'commit-arm');
    until(native, 2);
    assert.equal(native.compiledTake(0).frames, 16000);
    assert.equal(native.compiledTake(0).revision, 1);
    assert.equal(native.compiledTake(0).ready, true);
    assert.equal(native.state().channels.find(channel => channel.id === 'R1')?.status, 'recording');
    native.control({ id: 'R1' }, 'commit');
    until(native, 3);
    assert.equal(native.compiledTake(1).frames, 16000);
    const output = render(native, 128);
    assert(output.mixed[0].every(sample => Math.abs(sample - .625) < 1e-6), 'both processed takes autoplay as layers');
    assert(output.live[0].every(sample => Math.abs(sample - .3125) < 1e-6), 'live route is processed exactly once');
    assert.deepEqual(output.mixed[0], output.mixed[1]);
    assert.deepEqual(output.live[0], output.live[1]);
    assert(output.mixed[0].every((sample, index) => Math.abs(sample + output.live[0][index] - .9375) < 1e-6), 'download mix contains processed live plus cached voices once each');
    until(native, 3, 4);
    native.control({ id: 'R1' }, 'fractional-stop');
    const pendingLight = native.state().channels.find(channel => channel.id === 'R1')?.light;
    assert(pendingLight?.kind === 'releasing' && pendingLight.remainingMs > 0);
    const clock = native.query('pf_snapshot');
    const target = Math.ceil(clock[PF.CLOCK_BEAT_FRAME] + 1000);
    const remaining = target - native.processedFrames;
    const stopped = render(native, remaining + 1);
    assert(Math.abs(stopped.mixed[0][remaining - 1] - .625) < 1e-6);
    assert(Math.abs(stopped.mixed[0][remaining] - .125) < 1e-6);
    const tailLight = native.state().channels.find(channel => channel.id === 'R1')?.light;
    assert(tailLight?.kind === 'releasing' && tailLight.remainingMs > 0, 'audible release retains native light feedback');
    const released = render(native, 800);
    assert.equal(released.mixed[0][799], 0);
    assert.equal(native.state().channels.find(channel => channel.id === 'R1')?.light.kind, 'off');
    assert(stopped.events.some(event => event.type === 'state' && event.frame === target), 'fractional action publishes its effective source frame');
    native.stop();
    const silent = render(native, 1000);
    assert([...silent.live, ...silent.mixed].every(channel => channel.every(sample => sample === 0)));
  } finally { native.dispose(); }
});

test('WASM loop history evolves from original source, never a second effects pass on printed PCM', async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    native.setMicrophone(true);
    native.start({ runId: 'evolving', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' });
    until(native, 1, 1, 0);
    const captureStart = native.processedFrames - native.compiledTake(0).frames;
    native.control({ id: 'R1' });
    const commitFrame = captureStart + 16000;
    const output = render(native, commitFrame - native.processedFrames + 32000 + 801, frame => frame === commitFrame - 1 ? 1 : 0);
    const playbackStart = commitFrame - (native.processedFrames - output.mixed[0].length);
    assert.equal(output.mixed[0][playbackStart + 799], 0, 'first loop uses its originally captured history');
    assert.equal(output.mixed[0][playbackStart + 16000 + 799], .25, 'second loop retains the preceding iteration tail');
    assert(output.mixed[0].every(Number.isFinite));
  } finally { native.dispose(); }
});

test('native byte artifact and failed replacement preserve an existing prepared program', async () => {
  const song = await fixture();
  const native = engine(Array.from(encodeCompiledProgram(song)), 48000);
  try {
    const bytes = compiledProgramBytes(song);
    const pointer = native.call('malloc', bytes.byteLength);
    try {
      new Uint8Array(native.memory.buffer, pointer, bytes.length).set(bytes);
      native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length);
      const state = native.state();
      const immediateLeadIn = Array.from(encodeCompiledProgram(song));
      immediateLeadIn[PF.COMPILED_HEADER_FIELDS + song.takes.length * PF.COMPILED_TAKE_FIELDS + 5] = 0;
      assert.throws(() => native.configureCompiled(immediateLeadIn), /compiled|program/i);
      assert.equal(native.state().endBar, state.endBar);
      new Uint8Array(native.memory.buffer, pointer, 8).fill(0);
      assert.throws(() => native.call('pf_load_compiled_bytes', native.handle, pointer, bytes.length), /compiled|program/i);
      assert.equal(native.state().endBar, state.endBar);
      native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .25 }]);
      assert.equal(native.liveEffects().captureSupported, true);
      assert.equal(native.memory.buffer.byteLength, 268435456);
    } finally { native.invoke('free', pointer); }
  } finally { native.dispose(); }
});

test('stopped identical effect preparation refreshes reusable banks after a venue edit', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture())));
  const first = [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  const second = [{ kind: 'slapback', delayMs: 150, feedback: 0, wet: .5 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  function capture(run: number) {
    native.setMicrophone(true);
    native.start({ runId: `recapture-${run}`, bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    native.control({ id: 'R1' });
    until(native, 1);
    native.control({ id: 'R1' });
    until(native, 2);
    native.control({ id: 'R1' });
    until(native, 3);
    native.stop();
  }
  try {
    native.prepareLiveEffects(first);
    capture(0);
    native.prepareLiveEffects(second);
    assert.equal(native.compiledTake(0).revision, 1, 'the completed old take retains its graph');
    for (let run = 1; run <= 3; run++) {
      native.prepareLiveEffects(second);
      capture(run);
      assert.equal(native.compiledTake(0).revision, 2);
      assert.equal(native.compiledTake(1).revision, 2);
    }
  } finally { native.dispose(); }
});

test('stale venue bank rejects recapture nonfatally during transport until stopped preparation', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await fixture({ inTransportRecapture: true }))));
  const edited = [{ kind: 'slapback', delayMs: 150, feedback: 0, wet: .5 }] satisfies Parameters<NativePerformance['prepareLiveEffects']>[0];
  function startAndCapture(runId: string) {
    native.setMicrophone(true);
    native.start({ runId, bpm: 120, countInBars: 0, startBar: 1, endBar: 4, loop: true });
    until(native, 1);
    native.control({ id: 'R1' });
    until(native, 2);
    native.control({ id: 'R1' });
  }
  try {
    native.prepareLiveEffects([{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    startAndCapture('old-venue');
    native.stop();
    native.prepareLiveEffects(edited);
    startAndCapture('new-venue');
    until(native, 4, 4);
    until(native, 1);
    const before = native.compiledTake(0);
    const channels = native.state().channels;
    assert.throws(() => native.control({ id: 'R1' }), /No reusable take bank/);
    assert.deepEqual(native.compiledTake(0), before);
    assert.deepEqual(native.state().channels, channels);
    const output = render(native, 128);
    assert.equal(native.state().phase, 'playing');
    assert(output.mixed.every(channel => channel.every(sample => Math.abs(sample - .375) < 1e-6)));
    assert(output.live.every(channel => channel.every(sample => Math.abs(sample - .375) < 1e-6)));
    native.stop();
    native.prepareLiveEffects(edited);
    startAndCapture('refreshed');
    assert.equal(native.compiledTake(0).revision, 2);
  } finally { native.dispose(); }
});
