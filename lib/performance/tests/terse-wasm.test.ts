import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { terseCaptureFixture } from './fixtures/terse-capture.js';
import { prepareDeclaredExternalAssets } from '../external-assets.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { compileSheetsSong } from '../compiled-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';
import tribulations from '../../../songs/tribulations.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(program: readonly number[], profiles?: Parameters<NativePerformance['prepareVoiceEffects']>[0], sampleRate = 8000) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, { env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } } });
  assert(instance.exports.memory instanceof WebAssembly.Memory); memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate, mode: PF.PRACTICE, compiledProgram: program, clickGain: 0, initialVoiceEffects: profiles });
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
    native.control({ id: 'external', slot: 0 }, 'outside-window'); assert(render(native, 10).every(value => value === 0));
    until(native, 2); native.control({ id: 'external', slot: 0 }, 'manual-shake/1'); render(native, 1000); native.control({ id: 'external', slot: 0 }, 'manual-shake/2');
    native.control({ id: 'external', slot: 0 }, 'manual-shake/2');
    assert(render(native, 64).every(value => Math.abs(value - .4) < 1e-6), 'finite tails overlap');
    native.setMicrophone(false); assert(render(native, 64).every(value => Math.abs(value - .4) < 1e-6), 'microphone loss preserves independent external tails');
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

test('unpressed groups finish capture and wait for a manual press to recover loop playback', async () => {
  const song = await terseCaptureFixture();
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'missed-group', bpm: 120, countInBars: 1, startBar: 4, endBar: 10 });
    until(native, 7);
    assert.equal(native.compiledTake(2).frames, 16000, 'unpressed arm and cx preserve the complete strum source');
    assert.equal(native.state().compiledTakes?.[3].playback, 'playing', 'missed c completes with its declared autoplay');
    assert.equal(native.state().compiledTakes?.[2].playback, 'idle', 'missed explicit strum play stays silent');
    until(native, 7, 2); press(native); release(native);
    assert.equal(native.state().compiledTakes?.[2].playback, 'playing', 'late press recovers the missed loop');
    assert.equal(native.state().compiledTakes?.[3].playback, 'idle', 'recovery replaces the active take without replaying the commit');
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
    until(native, 1, 3); render(native, 2000);
    render(native, 2000 - native.compiledTake(0).frames, .1); render(native, 14000, .8);
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

test('stopped Tuning records the selected scale into note slots, locks on meaningful rightward motion and retains it across Start', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 3, 120, 3, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_NOTES_MAGIC, 2, 0, 0, 1, 0, 25, 0, 1, 1, 1, 25];
  const native = engine(program);
  const sing = (midi: number, frames = 10000) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    for (let remaining = frames; remaining > 0;) {
      const count = Math.min(256, remaining), begin = native.processedFrames;
      const input = Float32Array.from({ length: count }, (_, index) => .2 * Math.sin(2 * Math.PI * frequency * (begin + index) / 8000));
      const output = [new Float32Array(count), new Float32Array(count)];
      native.process(input, output, count);
      assert(output.every(channel => channel.every(value => value === 0)), 'tuning capture does not audition or launch a note');
      remaining -= count;
    }
  };
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.tunerCommand({ kind: 'configure', root: 57, scale: 'major', expectedRevision: native.tunerState().revision });
    native.prepareTuningBank({ profile: 0, slots: [0, 1, 2, 3, 4, 5, 6, 7] });
    assert.throws(() => native.prepareExternalSample(0, new Float32Array(1)), 'partial bank owns its prepared memory');
    native.tunerCommand({ kind: 'listen', enabled: true, expectedRevision: native.tunerState().revision });
    assert.throws(() => native.tunerCommand({ kind: 'confirm', expectedRevision: native.tunerState().revision }), /steadily/);
    sing(58); assert.equal(native.tuningBankState().ready, false, 'wrong target pitch never prepares a lock');
    const targets = native.tunerState().targets;
    for (const [index, target] of targets.entries()) {
      sing(target.midi);
      assert.equal(native.tuningBankState().ready, true, `target ${target.midi} is stable`);
      if (index === 1) {
        native.setMicrophone(false);
        assert.equal(native.tuningBankState().filledFrames, 0, 'microphone loss discards only the unfinished window');
        assert.equal(native.tuningBankState().capturedFrames[0], 2000, 'microphone loss preserves the first locked note');
        native.setMicrophone(true);
        assert.equal(native.tunerState().listening, false, 'microphone restoration does not silently resume capture');
        native.tunerCommand({ kind: 'listen', enabled: true, expectedRevision: native.tunerState().revision });
        sing(target.midi); assert.equal(native.tuningBankState().ready, true);
      }
      if (index === 0) {
        for (let motion = 0; motion < 3; motion++) native.control({ id: 'knob', value: 1 });
        assert.equal(native.tuningBankState().step, 0, 'tiny raw deltas do not each lock another note');
        native.control({ id: 'knob', value: 1 });
      } else native.tunerCommand({ kind: 'confirm', expectedRevision: native.tunerState().revision });
      assert.equal(native.tuningBankState().step, index + 1);
    }
    assert.equal(native.tunerState().complete, true);
    assert.deepEqual(native.tuningBankState().midi, targets.map(note => note.midi));
    assert(native.tuningBankState().capturedFrames.every(frames => frames === 2000));
    native.start({ runId: 'captured-note-bank', bpm: 120, countInBars: 1, startBar: 1, endBar: 3 });
    assert.equal(native.tunerState().listening, false); assert.equal(native.tunerState().preview.kind, 'silent');
    assert.throws(() => native.tunerCommand({ kind: 'confirm', expectedRevision: native.tunerState().revision }), /Stop the performance/);
    assert.throws(() => native.prepareTuningBank({ profile: 0, slots: [0, 1, 2, 3, 4, 5, 6, 7] }));
    until(native, 1); native.control({ id: 'L1' });
    assert(render(native, 1000).some(value => Math.abs(value) > .1), 'chart-aware manual note hit plays captured singing');
    native.stop(); assert(native.tuningBankState().capturedFrames.every(frames => frames === 2000));
    native.setMicrophone(false); assert(native.tuningBankState().capturedFrames.every(frames => frames === 2000));
    native.configureCompiled(program); assert.equal(native.tuningBankState().count, 0, 'song replacement releases the old note bank');
  } finally { native.dispose(); }
});

test('native WAV preparation converts source rate and rejects malformed replacements atomically', () => {
  const program = [PF.COMPILED_MAGIC, PF.COMPILED_VERSION, 4, 3, 120, 3, 25, 25, 0, 0, 0, 0, 0, 1, 2, 3,
    PF.COMPILED_EXTERNAL_MAGIC, 1, 0, 1, 0, 3, 0];
  const wav = new Uint8Array(60), view = new DataView(wav.buffer);
  const text = (at: number, value: string) => { for (const [index, char] of [...value].entries()) wav[at + index] = char.charCodeAt(0); };
  text(0, 'RIFF'); view.setUint32(4, wav.length - 8, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 12000, true); view.setUint32(28, 48000, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 16, true);
  for (let frame = 0; frame < 4; frame++) { view.setInt16(44 + frame * 4, frame * 8192, true); view.setInt16(46 + frame * 4, -frame * 8192, true); }
  const native = engine(program);
  try {
    native.prepareExternalWav(0, wav);
    const invalid = wav.slice(); invalid[40] = 255;
    assert.throws(() => native.prepareExternalWav(0, invalid));
    native.prepareLiveEffects([]);
    assert.throws(() => native.prepareTuningBank({ profile: 0, slots: [0, 1, 2, 3, 4, 5, 6, 7] }), 'song external source owns its sample slot');
    assert.throws(() => native.prepareTuningBank({ profile: 0, slots: [1, 1, 2, 3, 4, 5, 6, 7] }), 'scale notes need distinct sample slots');
    native.start({ runId: 'native-wav', bpm: 120, countInBars: 1, startBar: 1, endBar: 3 }); until(native, 1); native.triggerExternal(0);
    const left = new Float32Array(4), right = new Float32Array(4); native.process(null, [left, right], 4);
    assert.deepEqual(Array.from(left), [0, .375, .75, 0]); assert.deepEqual(Array.from(right), [0, -.375, -.75, 0]);
  } finally { native.dispose(); }
});

test('live periodic preparation trims silence and sustains native h/g; silence, DC and noise stay unavailable', async () => {
  const { terseCaptureInput } = await import('./fixtures/terse-capture.js');
  const { compileSheetsSong } = await import('../compiled-song.js');
  const input = terseCaptureInput();
  const values = input.source.values.map(row => [...row]);
  for (const control of input.mapping.controls) values[control.cueRow - 1].fill('', 2);
  values[17][2] = '1r'; values[17][3] = '1cx'; values[17][4] = '1h'; values[17][6] = '1g'; values[17][7] = '1p';
  const mapping = { ...input.mapping, sourceBindings: input.mapping.sourceBindings?.map(binding => binding.sourceName === 'words' ? { ...binding, sustain: { kind: 'periodic' as const } } : binding) };
  const song = await compileSheetsSong({ ...input.source, values }, mapping);
  assert(song.executable, JSON.stringify(song.diagnostics));
  const program = Array.from(encodeCompiledProgram(song));
  assert(program.includes(PF.COMPILED_SUSTAIN_MAGIC));
  for (const signal of ['periodic', 'silence', 'dc', 'noise'] as const) {
    const native = engine(program);
    try {
      native.prepareLiveEffects([]); native.setMicrophone(true);
      native.start({ runId: signal, bpm: 120, countInBars: 1, startBar: 1, endBar: 6 });
      until(native, 1); press(native); release(native);
      const sample = new Float32Array(16000); let seed = 1;
      for (let frame = 0; frame < sample.length; frame++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        sample[frame] = signal === 'periodic' ? frame < 1600 ? 0 : .3 * Math.sin(2 * Math.PI * 200 * frame / 8000)
          : signal === 'noise' ? .3 * (seed / 2147483648 - 1) : signal === 'dc' ? .3 : 0;
      }
      native.process(sample, [new Float32Array(sample.length), new Float32Array(sample.length)], sample.length);
      until(native, 3);
      if (signal !== 'periodic') {
        assert.throws(() => press(native), /Capture or load a sample/);
        render(native, 1, 0);
        assert.equal(native.state().compiledTakes?.[0].playback, 'idle', `${signal} cannot prepare a pitched sustain`);
      } else {
        press(native); render(native, 1, 0);
        assert.equal(native.state().compiledTakes?.[0].playback, 'playing');
        const held = render(native, 24000, 0);
        assert(held.every(Number.isFinite));
        assert(held.some(value => Math.abs(value) > .1), 'held source sounds beyond original two-second capture');
        assert(!held.slice(0, 800).every(value => value === 0), 'trimmed region omits captured silence');
        assert.equal(native.compiledTake(0).frames, 16000, 'parent recording remains complete');
        release(native); assert(render(native, 64, 0).every(value => value === 0));
        until(native, 5); press(native); render(native, 8000, 0); release(native);
        assert.equal(native.state().compiledTakes?.[0].playback, 'idle');
        press(native); assert(render(native, 400, 0).some(value => Math.abs(value) > .1)); release(native);
        until(native, 6); press(native); release(native);
        render(native, 16001, 0); assert.equal(native.state().compiledTakes?.[0].playback, 'idle', 'ordinary word p exits gated mode and remains finite');
      }
    } finally { native.dispose(); }
  }
});

test('canonical Drunk Girls pickup loop restarts at Pickup8 phase and crosses numbered one without resetting', async () => {
  const { readMusicXmlSong } = await import('../musicxml-song.js');
  const { song } = await readMusicXmlSong(await readFile(new URL('../../../songs/drunk-girls.musicxml', import.meta.url), 'utf8'));
  assert(song.executable); assert.equal(song.chart.bars.length, 137);
  assert.equal(song.chart.bars[8].label, 'Pickup 8'); assert.equal(song.chart.bars[9].label, '1');
  assert.equal(song.terminalStops?.[0].text, 'x');
  const native = engine(Array.from(encodeCompiledProgram(song)));
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    native.start({ runId: 'dg-pickup', bpm: 144, countInBars: 1, startBar: 1, endBar: 10 });
    until(native, 9); render(native, 1); native.setMicrophone(false);
    const guitar = native.compiledTake(6);
    assert(guitar.ready); assert(Math.abs(guitar.frames - 98333) <= 1); assert.equal(guitar.period, 106667);
    assert(render(native, 100, 0).every(value => value === 0), 'virtual source rest preserves the 3& pickup offset');
    until(native, 9, 3); render(native, 1668, 0);
    assert(render(native, 100, 0).some(value => Math.abs(value) > .1), 'captured source begins again at Pickup8 3&');
    until(native, 10); assert(render(native, 100, 0).some(value => Math.abs(value) > .1), 'numbered one keeps the ongoing eight-bar loop');
  } finally { native.dispose(); }
});

test('Tribulations uses the same four recorded samples for Audition and chart playback', async () => {
  assert(tribulations.compiled);
  const native = engine(Array.from(encodeCompiledProgram(tribulations.compiled)), undefined, 48000);
  try {
    const samples = await prepareDeclaredExternalAssets(tribulations.compiled.externalSamples);
    assert.deepEqual(samples.map(sample => sample.slot), [0, 1, 2, 3]);
    for (const { slot, bytes } of samples) native.prepareExternalWav(slot, bytes);
    const auditions: Float32Array[] = [];
    assert.throws(() => native.auditionTambourine(127, 0));
    native.auditionTambourine(0);
    assert(render(native, 2048, 0).every(value => value === 0));
    for (const { slot } of samples) {
      native.auditionTambourine(127, slot);
      const pcm = render(native, 2048, 0);
      assert(pcm.some(value => Math.abs(value) > .001), `audible sample in slot ${slot}`);
      assert(!auditions.some(prior => prior.every((value, frame) => value === pcm[frame])), 'each slot sounds different');
      auditions.push(pcm);
      native.auditionTambourine(-1);
      assert(render(native, 2048, 0).every(value => value === 0), 'ending audition clears tails');
      native.auditionTambourine(0);
    }

    native.start({ runId: 'outside-window', bpm: 120, countInBars: 0, startBar: 1, endBar: 1 });
    until(native, 1);
    native.control({ id: 'external', slot: 0 });
    assert(render(native, 2048, 0).every(value => value === 0), 'chart input outside the window is silent');
    native.auditionTambourine(0);
    native.auditionTambourine(127, 0);
    assert.deepEqual(render(native, 2048, 0), auditions[0], 'running audition bypasses only the chart window');
    native.stop();
    assert.throws(() => native.auditionTambourine(127, 0), 'Stop disarms audition');

    for (const { slot } of samples) {
      native.start({ runId: `chart-sample-${slot}`, bpm: 120, countInBars: 0, startBar: 160, endBar: 160 });
      until(native, 160);
      native.control({ id: 'external', slot });
      assert.deepEqual(render(native, 2048, 0), auditions[slot]);
      native.stop();
    }
  } finally { native.dispose(); }
});

test('Drunk Girls layers the recorded final eighth only at four-bar repeat seams', async () => {
  const { source, mapping } = await readMusicXmlSong(await readFile(new URL('../../../songs/drunk-girls.musicxml', import.meta.url), 'utf8'));
  assert(source && mapping);
  const edited = { ...source, values: source.values.map(row => [...row]) };
  // Use sections 0.1–0.4 in a local copy of the Guitar row.
  edited.values[20][3] = 'r4&';
  edited.values[20][7] = 'cb~1..4^&';
  edited.values[20][10] = '';
  edited.values[20][43] = 'p4&';
  const { xml } = await importSheetMusicXml({ source: edited, mapping });
  const { song } = await readMusicXmlSong(xml);
  assert(song.executable, JSON.stringify(song.diagnostics));
  const guitar = song.takes.find(take => take.voiceId === 'guitar');
  assert(guitar);
  assert.deepEqual([guitar.begin, guitar.captureEnd], [{ bar: 1, beat: 3.5 }, { bar: 6, beat: 0 }]);
  assert.deepEqual(song.selections.find(selection => selection.id === song.cues.find(cue => cue.source.a1 === 'H21')?.selectionId)?.window,
    { kind: 'intro-loop', repeatBeginCount: 0, endCount: 16, overlapFinalEighth: true });

  const invalid = structuredClone(edited);
  invalid.values[20][7] = 'c4&~1..4^&';
  const rejected = await compileSheetsSong(invalid, mapping);
  assert(!rejected.executable);
  assert(rejected.diagnostics.some(issue => issue.code === 'repeat-range' && issue.source.a1 === 'H21'));

  const sampleRate = 14400;
  const native = engine(Array.from(encodeCompiledProgram(song)), undefined, sampleRate);
  let frame = 0, framesPerCount = 0;
  function renderUntil(count: number, input: (elapsedCounts: number) => number = () => 0) {
    const end = Math.ceil(count * framesPerCount);
    let last: number | undefined;
    while (frame < end) {
      const size = Math.min(end - frame, 512);
      const pcm = Float32Array.from({ length: size }, (_, index) => input((frame + index) / framesPerCount));
      const out = [new Float32Array(size), new Float32Array(size)];
      native.process(pcm, out, size, [new Float32Array(size), new Float32Array(size)]);
      last = out[0].at(-1);
      frame += size;
      for (const event of native.events()) assert.notEqual(event.type, 'fault', event.error ?? 'native fault');
    }
    return last;
  }
  function start(bpm: number, startBar: number, endBar: number) {
    frame = 0; framesPerCount = sampleRate * 60 / bpm;
    native.start({ runId: `overlap-${startBar}`, bpm, countInBars: 0, startBar, endBar, loop: false, automatic: false });
  }
  function check(count: number, expected: number) {
    const actual = renderUntil(count);
    assert(actual !== undefined && Math.abs(actual - expected) < 1e-6, `count ${count}: expected ${expected}, got ${actual}`);
  }
  try {
    native.prepareLiveEffects([]); native.setMicrophone(true);
    start(144, 1, 15);
    renderUntil(21, elapsed => elapsed < 5 ? .125 : elapsed < 20.5 ? .25 : .375);
    assert.equal(native.compiledTake(song.takes.indexOf(guitar)).frames, framesPerCount * 16.5);
    check(24.25, 0);
    check(24.65, .125);
    check(25.25, .25);
    check(40.4, .25);
    check(40.65, .5);
    check(41.25, .25);
    check(56.65, .5);
    native.stop();

    start(180, 41, 51);
    renderUntil(2);
    native.control({ id: 'L2' });
    check(4.65, .125);
    check(5.25, .25);
    check(20.65, .5);
    check(21.25, .25);
    check(36.65, .5);
  } finally { native.dispose(); }
});
