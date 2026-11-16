import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';
import { PF as LIGHT } from '../light-abi.js';
import { decodeNativeInputRouting } from '../native-observation.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { compiledCaptureFixture } from './fixtures/compiled-capture.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(program: readonly number[]) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; },
      fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); },
    },
  });
  if (!(instance.exports.memory instanceof WebAssembly.Memory)) throw new Error('Missing WASM memory');
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate: 8000, mode: PF.PRACTICE, compiledProgram: program, clickGain: 0 });
}
function emptyProgram() {
  return [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.INPUT_MAGIC, 3, 0, PF.INPUT_CUES, 1, 1, PF.INPUT_CUES, 2, 5, PF.INPUT_PANIC, 0];
}
function level(native: NativePerformance, id: number) {
  const image = native.lightOutput();
  for (let index = 0; index < image[LIGHT.LIGHT_COUNT]; index++) {
    const offset = LIGHT.LIGHT_SAMPLES + index * LIGHT.LIGHT_SAMPLE_FIELDS;
    if (image[offset + LIGHT.LIGHT_SAMPLE_ID] === id) return image[offset + LIGHT.LIGHT_SAMPLE_LEVEL];
  }
  return null;
}
function until(native: NativePerformance, bar: number) {
  const input = new Float32Array(64).fill(.25), mixed = [new Float32Array(64), new Float32Array(64)];
  for (let attempt = 0; attempt < 8000; attempt++) {
    if (native.state().phase === 'playing' && native.state().bar === bar && native.state().beat === 1) return;
    native.process(input, mixed, input.length);
  }
  throw new Error(`Did not reach bar ${bar}`);
}

test('WASM producer leases, initial release barriers and independent native light IDs roundtrip', () => {
  const native = engine(emptyProgram());
  try {
    const generation = native.inputRouting().bindingGeneration;
    native.inputAttach({ producer: 0, session: 10, bindingGeneration: generation, kind: 'physical', releasedMask: 1, heldMask: 2 });
    assert.equal(level(native, 257), 0);
    assert.equal(level(native, 258), 1);
    const event = (sequence: number, input: number, value: number) => native.inputEvent({ producer: 0, session: 10, bindingGeneration: generation, sequence, input, value });
    event(1, 1, 0);
    assert.equal(level(native, 258), 0);
    event(100, 1, 1);
    assert.equal(level(native, 258), 1);
    assert.throws(() => event(99, 1, 0), /stale/);
    assert.equal(level(native, 258), 1);
    event(101, 1, 1);
    event(102, 1, 0);
    assert.deepEqual(native.inputRouting(), {
      bindingGeneration: generation, sessionHighWatermark: 10, panicMask: 32,
      producers: [{ producer: 0, session: 10, kind: 'physical', releasedMask: 3, heldMask: 0, lastSequence: 102 }],
    });
    native.inputRevoke({ producer: 0, session: 10 });
    assert.equal(native.inputRouting().sessionHighWatermark, 10);
    assert.deepEqual(native.inputRouting().producers, []);
    native.inputAttach({ producer: 0, session: 11, bindingGeneration: generation, kind: 'physical', releasedMask: 3, heldMask: 0 });
    assert.throws(() => event(200, 0, 1), /stale/);
    native.configureCompiled(emptyProgram());
    assert.equal(native.inputRouting().bindingGeneration, generation + 1);
    assert.deepEqual(native.inputRouting().producers, []);
  } finally { native.dispose(); }
});

test('identified physical cue rows preserve capture doubling, native beat pulse and missed-commit policy', async () => {
  const compiled = await compiledCaptureFixture();
  const native = engine(Array.from(encodeCompiledProgram({ ...compiled, inputBindings: [
    { controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1'] } },
  ] })));
  try {
    const generation = native.inputRouting().bindingGeneration;
    native.inputAttach({ producer: 0, session: 1, bindingGeneration: generation, kind: 'physical', releasedMask: 3, heldMask: 0 });
    native.setMicrophone(true);
    native.start({ runId: 'identified-capture', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
    let sequence = 0;
    const edge = (input: number, value: number) => native.inputEvent({ producer: 0, session: 1, bindingGeneration: generation, sequence: ++sequence, input, value });
    edge(1, 1); edge(1, 0);
    assert.equal(native.state().recording, null, 'unbound Yellow never falls back to all cues');
    edge(0, 1);
    assert.equal(level(native, 257), 1);
    edge(0, 0);
    until(native, 1);
    assert.equal(native.state().recording?.status, 'recording');
    const recordingLevel = level(native, 257);
    assert(recordingLevel !== null && recordingLevel >= 0 && recordingLevel <= .7);
    edge(0, 1); edge(0, 0);
    until(native, 2);
    assert.equal(native.compiledTake(0).frames, 16000);
    until(native, 3);
    assert.equal(native.compiledTake(1).frames, 16000, 'missed commit completes at authored endpoint');
    assert.equal(native.state().recording, null);
    assert.equal(level(native, 257), .7);
    edge(0, 1);
    assert.equal(level(native, 257), 1);
    edge(0, 0);
    assert.equal(level(native, 257), .7);
    const retained = native.inputRouting().bindingGeneration;
    native.stop();
    assert.equal(native.inputRouting().bindingGeneration, retained);
  } finally { native.dispose(); }
});

test('native input readback rejects invalid bounds, contradictory masks and nonzero trailing fields', () => {
  const native = engine(emptyProgram());
  try {
    const image = native.query('pf_input_info').slice();
    assert.equal(image.length, PF.INPUT_INFO_FIELDS);
    assert.throws(() => decodeNativeInputRouting(image.slice(0, -1)), /header/);
    const excessive = image.slice(); excessive[PF.INPUT_COUNT] = PF.INPUT_PRODUCERS + 1;
    assert.throws(() => decodeNativeInputRouting(excessive), /header/);
    const garbage = image.slice(); garbage[garbage.length - 1] = 1;
    assert.throws(() => decodeNativeInputRouting(garbage), /padding/);
    native.inputAttach({ producer: 31, session: 100, bindingGeneration: native.inputRouting().bindingGeneration, kind: 'keyboard', releasedMask: 223, heldMask: 0 });
    const contradictory = native.query('pf_input_info').slice(); contradictory[PF.INPUT_RECORDS + PF.INPUT_HELD_MASK] = 1;
    assert.throws(() => decodeNativeInputRouting(contradictory), /record/);
    const unknown = native.query('pf_input_info').slice(); unknown[PF.INPUT_RECORDS + PF.INPUT_KIND] = 3;
    assert.throws(() => decodeNativeInputRouting(unknown), /record/);
  } finally { native.dispose(); }
});


function stagedHeldProgram(mode: number) {
  const data = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 2, 8, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0, 1, 2, 0, 3, 0, 1, 3, 0, 1];
  const cue = (button: number, voice: number, bar: number, kind: number, timing: number, take: number, commit: number, selection: number, playbackMode: number = PF.LOOP_MODE) => {
    data.push(button, voice, bar, -1, kind, timing, 0, take, commit, selection, 0,
      kind === PF.COMMIT ? PF.STORE_ONLY : PF.AUTOPLAY, playbackMode, 0, -1, 0);
  };
  cue(0, 0, 0, PF.ARM, 1, 0, -1, -1);
  cue(0, 0, 1, PF.COMMIT, 1, -1, 0, 0);
  cue(0, 0, 3, PF.PLAY, 0, -1, -1, 0, PF.HELD_MODE);
  cue(1, 1, 3, PF.PLAY, 0, -1, -1, 1, PF.GATED_MODE);
  cue(1, 1, 1, PF.ARM, 1, 1, -1, -1);
  cue(1, 1, 2, PF.COMMIT, 1, -1, 1, 1);
  cue(0, 0, 4, PF.PLAY, 1, -1, -1, 0, PF.HELD_MODE);
  cue(1, 1, 4, PF.PLAY, 1, -1, -1, 1, mode);
  data.push(0, 0, 1, 1, 1, 1, PF.INPUT_MAGIC, 2, 0, PF.INPUT_CUES, 1, 1, PF.INPUT_CUES, 2);
  return data;
}
for (const mode of [PF.HELD_MODE, PF.GATED_MODE]) for (const revoke of [false, true]) {
  test(`WASM staged mode ${mode} rechecks ownership after an earlier due launch before ${revoke ? 'revocation' : 'release'}`, () => {
    const native = engine(stagedHeldProgram(mode));
    try {
      native.setMicrophone(true);
      native.start({ runId: 'staged-owner', bpm: 120, countInBars: 1, startBar: 1, endBar: 6, loop: false });
      native.control({ id: 'L1' });
      until(native, 1);
      native.control({ id: 'L1' }); native.control({ id: 'L2' });
      until(native, 2);
      native.control({ id: 'L2' });
      until(native, 3);
      const bindingGeneration = native.inputRouting().bindingGeneration;
      native.inputAttach({ producer: 0, session: 1, bindingGeneration, kind: 'physical', releasedMask: 3, heldMask: 0 });
      native.inputAttach({ producer: 1, session: 2, bindingGeneration, kind: 'pointer', releasedMask: 223, heldMask: 0 });
      const physical = (sequence: number, input: number, value: number) => native.inputEvent({ producer: 0, session: 1, bindingGeneration, sequence, input, value });
      const pointer = (sequence: number, input: number, value: number) => native.inputEvent({ producer: 1, session: 2, bindingGeneration, sequence, input, value });
      physical(1, 1, 1);
      assert.equal(native.compiledTake(1).playbackState, 1);
      until(native, 4);
      physical(2, 0, 1); pointer(1, 1, 1);
      until(native, 5);
      assert(native.compiledTake(0).playbackState === 1 || native.compiledTake(1).playbackState === 1);
      if (revoke) {
        native.inputRevoke({ producer: 1, session: 2 });
        native.inputRevoke({ producer: 0, session: 1 });
      } else {
        pointer(2, 1, 0); physical(3, 1, 0); physical(4, 0, 0);
      }
      assert.notEqual(native.compiledTake(0).playbackState, 1);
      assert.notEqual(native.compiledTake(1).playbackState, 1, 'a staged launch invalidated by earlier execution must not outlive every input owner');
    } finally { native.dispose(); }
  });
}
