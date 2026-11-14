import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { terseCaptureFixture } from './fixtures/terse-capture.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(program: readonly number[], profiles?: Parameters<NativePerformance['prepareVoiceEffects']>[0]) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
  assert(instance.exports.memory instanceof WebAssembly.Memory); memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate: 8000, mode: PF.PRACTICE, compiledProgram: program, clickGain: 0, initialVoiceEffects: profiles });
}
function render(native: NativePerformance, frames: number, input = .25) {
  const out = [new Float32Array(frames), new Float32Array(frames)];
  native.process(new Float32Array(frames).fill(input), out, frames);
  return out[0];
}
function until(native: NativePerformance, bar: number, beat = 1) {
  for (let frames = 0; frames < 400000; frames++) {
    const state = native.state();
    if (state.bar === bar && state.beat === beat && state.phase === 'playing') return;
    render(native, 1);
  }
  throw new Error('Requested chart position not reached');
}
function press(native: NativePerformance) { native.control({ id: 'cueButton', value: 1 }); }
function release(native: NativePerformance) { native.control({ id: 'cueButton', value: 0 }); }

test('terse word store, chart parity, finite retrigger, grouped replacement, held release and gated reuse execute in WASM', async () => {
  const song = await terseCaptureFixture();
  assert.equal(song.executable, true, JSON.stringify(song.diagnostics));
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'terse-wasm', bpm: 120, countInBars: 1, startBar: 1, endBar: 10 });
    until(native, 1, 3); render(native, 2000); press(native); release(native);
    until(native, 1, 4); render(native, 2000); press(native); release(native);
    until(native, 2); render(native, 2000); press(native); release(native);
    until(native, 2, 2);
    assert.equal(native.compiledTake(0).frames, 4000); assert.equal(native.compiledTake(1).frames, 4000);
    assert.equal(native.state().compiledTakes?.[1].playback, 'idle', 'cx retains second source without launch');
    until(native, 3); press(native); release(native);
    assert.equal(native.state().compiledTakes?.[1].playback, 'playing', 'odd chart count uses count-one source');
    render(native, 4001);
    assert.equal(native.state().compiledTakes?.[1].playback, 'idle', 'word does not loop');
    press(native); release(native);
    assert.equal(native.state().compiledTakes?.[0].playback, 'playing', 'even chart count uses count-four source');
    until(native, 4); press(native); release(native);
    until(native, 5); press(native); release(native);
    assert.equal(native.state().compiledTakes?.[2].playback, 'idle', 'named strum is stored');
    until(native, 6); press(native); release(native);
    until(native, 7); press(native); release(native);
    assert.equal(native.state().compiledTakes?.[2].playback, 'playing', 'explicit group p replaces pick autoplay with strum');
    assert.equal(native.state().compiledTakes?.[3].playback, 'idle', 'pick remains stored after group replacement');
    until(native, 8); press(native);
    assert.equal(native.state().compiledTakes?.[1].playback, 'playing'); render(native, 12000);
    assert.equal(native.state().compiledTakes?.[1].playback, 'playing', 'held prepared region sustains');
    release(native); render(native, 1);
    assert.equal(native.state().compiledTakes?.[1].playback, 'idle', 'release reaches native held player');
    press(native); render(native, 64); release(native);
    assert.equal(native.state().compiledTakes?.[2].playback, 'idle', 'gate release stops prepared instrument');
    until(native, 8, 4); press(native); render(native, 64);
    assert.equal(native.state().compiledTakes?.[2].playback, 'playing', 'gated mode accepts repeated press outside original cue window');
    release(native); until(native, 9); press(native); release(native); render(native, 1);
    assert.equal(native.state().compiledTakes?.[2].playback, 'idle', 'explicit grouped x stops named sources');
  } finally { native.dispose(); }
});

test('external sample triggers overlap inside the canonical window and stop on transport stop', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_EXTERNAL_MAGIC, 1, 0, 2, 0, 4, 0];
  const native = engine(program);
  try {
    native.prepareExternalSample(0, new Float32Array(8000).fill(.2));
    native.prepareLiveEffects([]); native.start({ runId: 'terse-wasm', bpm: 120, countInBars: 1, startBar: 1, endBar: 4 });
    assert.throws(() => native.triggerExternal(0));
    until(native, 2); native.triggerExternal(0); render(native, 1000); native.triggerExternal(0);
    assert(render(native, 64).every(value => Math.abs(value - .4) < 1e-6), 'finite tails overlap');
    native.stop(); assert(render(native, 100).every(value => value === 0));
    assert.throws(() => native.prepareExternalSample(0, new Float32Array([NaN])));
  } finally { native.dispose(); }
});

test('manual per-note instrument hits select supplied order, skip missed notes and never autoplay', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_NOTES_MAGIC, 4,
    0, 0, 1, 0, 25, 0, 1, 1, 1, 25, 0, 2, 1, 2, 25, 0, 3, 1, 3, 25];
  const native = engine(program);
  try {
    for (let slot = 0; slot < 4; slot++) native.prepareExternalSample(slot, new Float32Array(64).fill((slot + 1) / 10));
    native.prepareLiveEffects([]); native.start({ runId: 'note-bank', bpm: 120, countInBars: 1, startBar: 1, endBar: 4 });
    until(native, 1); assert(render(native, 1).every(value => value === 0), 'unpressed expected note is silent');
    native.control({ id: 'L1' }); assert(render(native, 64).every(value => Math.abs(value - .1) < 1e-6));
    render(native, 3935); native.control({ id: 'L1' });
    assert(render(native, 64).every(value => Math.abs(value - .2) < 1e-6), 'next supplied note sounds immediately');
    until(native, 1, 4); native.control({ id: 'L1' });
    assert(render(native, 64).every(value => Math.abs(value - .4) < 1e-6), 'truly missed third note is skipped');
    native.control({ id: 'knob', value: 20 }); assert(render(native, 64).every(value => value === 0), 'knob does not trigger audio chorus');
  } finally { native.dispose(); }
});

test('missing a group only completes its authored outgoing commit and never launches the missed play', async () => {
  const song = await terseCaptureFixture();
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'missed-group', bpm: 120, countInBars: 1, startBar: 4, endBar: 10 });
    until(native, 4); press(native); release(native);
    until(native, 5); press(native); release(native);
    until(native, 6); press(native); release(native);
    until(native, 7);
    assert.equal(native.state().compiledTakes?.[3].playback, 'playing', 'missed c completes with its declared autoplay');
    assert.equal(native.state().compiledTakes?.[2].playback, 'idle', 'missed explicit strum play stays silent');
  } finally { native.dispose(); }
});

test('loop launch reconstructs the source phase instead of resetting a late attack to frame zero', () => {
  const cue = (bar: number, beat: number, kind: number, take: number, commit: number, selection: number, launch = 0) =>
    [0, 0, bar, beat, kind, 0, 0, take, commit, selection, 0, launch, 0, 0, -1, 0];
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 5, 120, 5, 25, 25, 1, 3, 1, 0, 0, 1, 2, 3,
    0, 1, 2.5, 2, 2.5, 1, 2, 2.5, 0,
    ...cue(1, 2.5, PF.ARM, 0, -1, -1), ...cue(2, 2.5, PF.COMMIT, -1, 0, 0, 1), ...cue(3, 3, PF.PLAY, -1, -1, 0),
    0, 0, 1];
  const native = engine(program);
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'source-phase', bpm: 120, countInBars: 1, startBar: 1, endBar: 5 });
    until(native, 1, 3); render(native, 2000); native.control({ id: 'L1' });
    render(native, 2000, .1); render(native, 14000, .8); native.control({ id: 'L1' });
    until(native, 3, 4); native.control({ id: 'L1' });
    assert.equal(native.compiledTake(0).phase, 2000, '3& source origin advances half a beat by attack count four');
    assert(Math.abs(render(native, 1)[0] - .8) < 1e-6, 'late launch reaches the corresponding stored source frame');
  } finally { native.dispose(); }
});

test('named stop exits a gated instrument established through a different bank control', () => {
  const cue = (button: number, bar: number, kind: number, take: number, commit: number, selection: number, mode = 0, launch = 0) =>
    [button, 0, bar, 0, kind, 0, 0, take, commit, selection, 0, launch, mode, 0, -1, 0];
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 5, 120, 5, 25, 25, 1, 4, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0,
    ...cue(0, 1, PF.ARM, 0, -1, -1), ...cue(0, 2, PF.COMMIT, -1, 0, 0, 0, 1),
    ...cue(1, 3, PF.PLAY, -1, -1, 1, 3), ...cue(0, 4, PF.STOP, -1, -1, 1),
    0, 0, 1, 1, 0, 1, PF.COMPILED_WINDOW_MAGIC, 1, 1, .25, .75, .5];
  const native = engine(program);
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'gate-exit', bpm: 120, countInBars: 1, startBar: 1, endBar: 5 });
    until(native, 1); native.control({ id: 'L1' });
    until(native, 2); native.control({ id: 'L1' });
    until(native, 3); native.control({ id: 'L2' }); render(native, 10); native.releaseChannel('L2');
    until(native, 4); native.control({ id: 'L1' }); render(native, 10);
    assert.equal(native.state().compiledTakes?.[0].playback, 'idle');
    until(native, 4, 2); press(native); render(native, 1);
    assert.equal(native.state().compiledTakes?.[0].playback, 'idle', 'blank shared presses cannot reenter a stopped gate');
  } finally { native.dispose(); }
});

test('manual note bank starts fresh on each practice loop without autoplay', () => {
  const native = engine([PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_NOTES_MAGIC, 1, 0, 0, 1, 0, 25]);
  try {
    native.prepareExternalSample(0, new Float32Array(64).fill(.2)); native.prepareLiveEffects([]);
    native.start({ runId: 'note-wrap', bpm: 120, countInBars: 1, startBar: 1, endBar: 1, loop: true });
    until(native, 1); native.control({ id: 'L1' });
    assert(render(native, 64).every(value => value > .19));
    assert(render(native, 15936).every(value => value === 0), 'unpressed notes in the next loop remain silent');
    native.control({ id: 'L1' });
    assert(render(native, 64).every(value => value > .19), 'same supplied note is available again after wrap');
  } finally { native.dispose(); }
});

test('later capture tempo cannot change an immutable source phase conversion', () => {
  const cue = (button: number, bar: number, beat: number, kind: number, take: number, commit: number, selection: number, launch = 0) =>
    [button, button, bar, beat, kind, 0, 0, take, commit, selection, 0, launch, 0, 0, -1, 0];
  const native = engine([PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 6, 120, 6, 25, 25, 2, 5, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0, 1, 3, 0, 4, 0, 1, 4, 0, 1,
    ...cue(0, 1, 0, PF.ARM, 0, -1, -1), ...cue(0, 2, 0, PF.COMMIT, -1, 0, 0, 1),
    ...cue(1, 3, 0, PF.ARM, 1, -1, -1), ...cue(1, 4, 0, PF.COMMIT, -1, 1, 1, 1),
    ...cue(0, 5, 1, PF.PLAY, -1, -1, 0), 0, 0, 1, 1, 1, 1]);
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'take-tempos', bpm: 120, countInBars: 1, startBar: 1, endBar: 6 });
    until(native, 1); native.control({ id: 'L1' });
    until(native, 2); native.control({ id: 'L1' }); native.control({ id: 'tempo' });
    render(native, 6000); native.control({ id: 'tempo' });
    assert.equal(native.state().bpm, 80);
    until(native, 3); native.control({ id: 'L2' });
    until(native, 4); native.control({ id: 'L2' });
    assert.equal(native.compiledTake(1).frames, 24000);
    until(native, 5, 2); native.control({ id: 'L1' });
    assert.equal(native.compiledTake(0).phase, 4000, 'one original chart count remains 4000 source frames');
  } finally { native.dispose(); }
});

test('native packet rejects groups spread across distinct press positions', () => {
  const cue = (bar: number, beat: number, button = 0) => [button, button, bar, beat, PF.STOP, 0, 0, -1, -1, -1, 0, 0, 0, 0, 0, 0];
  for (const second of [cue(2, 0), cue(1, 1), cue(1, 0, 1)]) {
    assert.throws(() => engine([PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 4, 120, 4, 25, 25, 0, 2, 0, 0, 0, 1, 2, 3,
      ...cue(1, 0), ...second]), /Invalid compiled song/);
  }
});

test('early acceptance quantizes a next-bar action from its authored measure', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 5, 120, 5, 25, 25, 1, 2, 1, 0, 0, 1, 2, 3,
    0, 3, 0, 4, 0, 1, 4, 0, 0,
    0, 0, 2, 0, PF.ARM, 1, 0, 0, -1, -1, 0, 0, 0, 0, -1, 0,
    0, 0, 3, 3.5, PF.COMMIT, 1, 0, -1, 0, 0, 0, 0, 0, 0, -1, 0,
    0, 0, 1];
  const native = engine(program);
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'early-next-bar', bpm: 120, countInBars: 1, startBar: 1, endBar: 5 });
    until(native, 1, 4); render(native, 3900); native.control({ id: 'L1' });
    until(native, 2); assert.equal(native.compiledTake(0).frames, 0, 'early physical press does not move the authored execution bar');
    until(native, 3); render(native, 1); assert(native.compiledTake(0).frames > 0);
  } finally { native.dispose(); }
});

test('held pitch uses signed velocity, forgets a stale baseline and resets on real release', async () => {
  const native = engine(Array.from(encodeCompiledProgram(await terseCaptureFixture())));
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'signed-bend', bpm: 120, countInBars: 1, startBar: 1, endBar: 10 });
    until(native, 1, 3); render(native, 2000); native.control({ id: 'R1' });
    until(native, 1, 4); render(native, 2000); native.control({ id: 'R1' });
    until(native, 2, 2); native.control({ id: 'knob', value: 100 });
    until(native, 8); native.control({ id: 'R1' }); native.control({ id: 'knob', value: 0 });
    const phase = () => native.compiledTake(1).phase;
    const before = phase(); render(native, 100); assert.equal(phase() - before, 100, 'stationary down baseline has decayed to zero');
    native.control({ id: 'knob', value: 100 }); const up = phase(); render(native, 100);
    assert(phase() - up >= 118 && phase() - up <= 119, 'positive signed velocity clamps at plus three semitones');
    native.control({ id: 'knob', value: -100 }); const down = phase(); render(native, 100);
    assert(phase() - down >= 84 && phase() - down <= 85, 'negative signed velocity clamps at minus three semitones');
    native.control({ id: 'R1', edge: 'release' }); render(native, 1);
    assert.equal(native.state().compiledTakes?.[1].playback, 'idle');
  } finally { native.dispose(); }
});

test('two named source profiles on one bank preserve independent capture, effects, selection and stopping', () => {
  const cue = (bar: number, kind: number, take: number, commit: number, selection: number, launch = 0) =>
    [0, 0, bar, 0, kind, 0, 0, take, commit, selection, 0, launch, 0, 0, -1, 0];
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 7, 120, 7, 25, 25, 2, 6, 2, 0, 0, 1, 2, 3,
    0, 1, 0, 2, 0, 1, 2, 0, 0, 0, 3, 0, 4, 0, 1, 4, 0, 1,
    ...cue(1, PF.ARM, 0, -1, -1), ...cue(2, PF.COMMIT, -1, 0, 0),
    ...cue(3, PF.ARM, 1, -1, -1), ...cue(4, PF.COMMIT, -1, 1, 1, 1),
    ...cue(5, PF.PLAY, -1, -1, 1), ...cue(6, PF.STOP, -1, -1, 0),
    0, 0, 1, 1, 1, 1, PF.COMPILED_PROFILES_MAGIC, 1, 1, 4];
  const profiles = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: profile === 4
    ? [{ kind: 'slapback' as const, delayMs: 40, feedback: 0, wet: .5 }] : [] }));
  const native = engine(program, profiles);
  try {
    native.setMicrophone(true); native.start({ runId: 'independent-source-profiles', bpm: 120, countInBars: 1, startBar: 1, endBar: 7 });
    until(native, 1); native.control({ id: 'L1' });
    until(native, 2); native.control({ id: 'L1' });
    until(native, 3); native.control({ id: 'L1' });
    assert(render(native, 128).every(value => Math.abs(value - .25) < 1e-6), 'new source recording leaves unrelated dry playback running');
    until(native, 4); native.control({ id: 'L1' });
    assert.equal(native.state().compiledTakes?.[1].playback, 'idle', 'store-only effected source stays silent');
    until(native, 5); native.control({ id: 'L1' });
    const mixed = render(native, 640).slice(400);
    assert(mixed.every(value => Math.abs(value - .625) < 1e-6), 'new source uses its own slapback rack while the dry source continues');
    assert.equal(native.state().compiledTakes?.[0].playback, 'playing');
    assert.equal(native.state().compiledTakes?.[1].playback, 'playing');
    until(native, 6); native.control({ id: 'L1' }); render(native, 1);
    assert.equal(native.state().compiledTakes?.[0].playback, 'idle');
    assert.equal(native.state().compiledTakes?.[1].playback, 'playing', 'named stop does not stop another profile on its bank');
  } finally { native.dispose(); }
});
