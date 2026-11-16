import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
function engine(sampleRate: number) {
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } },
  });
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate, mode: PF.PRACTICE, bpm: 120, beatsPerBar: 4, barCount: 2, endBar: 2, clickGain: 0 });
}
function render(native: NativePerformance, frames: number, frequency = 0) {
  const offset = native.processedFrames;
  const input = Float32Array.from({ length: frames }, (_, i) => frequency ? .2 * Math.sin(2 * Math.PI * frequency * (offset + i) / native.sampleRate) : 0);
  const output = [new Float32Array(frames), new Float32Array(frames)];
  const live = [new Float32Array(frames), new Float32Array(frames)];
  native.process(input, output, frames, live);
  return { output, live };
}
for (const rate of [44100, 48000]) test(`shared tuner analyzes raw PCM and renders finite reference at ${rate} Hz`, () => {
  const native = engine(rate);
  try {
    assert.equal(PF.ABI_VERSION, 12);
    let state = native.tunerState();
    assert.equal(state.root, 48);
    assert.deepEqual(state.targets.map(note => note.midi), [48, 50, 52, 53, 55, 57, 59, 60]);
    native.tunerCommand({ kind: 'configure', root: 49, scale: 'major', expectedRevision: state.revision });
    state = native.tunerState();
    assert.deepEqual(state.targets[2], { midi: 53, letter: 'E', accidental: 1, octave: 3 });
    native.tunerCommand({ kind: 'cue', expectedRevision: state.revision });
    const cue = render(native, rate * 2);
    assert.equal(native.state().phase, 'idle');
    assert.equal(native.tunerState().preview.kind, 'silent');
    assert(cue.output[0].some(value => Math.abs(value) > .01));
    assert(cue.live.every(channel => channel.every(value => value === 0)));
    assert(cue.output.every(channel => channel.slice(Math.ceil(rate * 1.5)).every(value => value === 0)));
    let crossings = 0;
    for (let i = Math.round(rate * .1); i < rate * 1.1; i++) if (cue.output[0][i - 1] <= 0 && cue.output[0][i] > 0) crossings++;
    assert(Math.abs(crossings - 138.59131549) < 1.1, 'Reference frequency matches native C#3');
    native.tunerCommand({ kind: 'play-scale', expectedRevision: native.tunerState().revision });
    const wholeScale = render(native, rate * 14).output[0];
    assert.equal(native.tunerState().preview.kind, 'silent');
    assert.equal(native.tunerState().step, 0, 'Audition never confirms the exercise');
    for (const [index, midi] of [49, 51, 53, 54, 56, 58, 60, 61].entries()) {
      const begin = Math.round(index * rate * 1.65);
      let crossings = 0;
      for (let i = begin + Math.round(rate * .1); i < begin + Math.round(rate * 1.1); i++)
        if (wholeScale[i - 1] <= 0 && wholeScale[i] > 0) crossings++;
      assert(Math.abs(crossings - 440 * 2 ** ((midi - 69) / 12)) < 1.1, `Scale degree ${index + 1} has its expected frequency`);
      if (index < 7) assert(wholeScale.slice(begin + Math.ceil(rate * 1.5), begin + Math.ceil(rate * 1.65)).every(value => value === 0));
    }
    native.setMicrophone(true);
    state = native.tunerState();
    native.tunerCommand({ kind: 'listen', enabled: true, expectedRevision: state.revision });
    const revision = native.tunerState().revision;
    for (let i = 0; i < 120; i++) render(native, 257, 130.81278265);
    state = native.tunerState();
    assert.equal(state.revision, revision);
    assert.equal(state.pitch.kind, 'pitched');
    if (state.pitch.kind !== 'pitched') throw new Error('Expected pitch');
    assert.equal(state.pitch.note.midi, 48);
    assert(Math.abs(state.pitch.cents) < 3);
    native.tunerCommand({ kind: 'confirm', expectedRevision: revision });
    assert.equal(native.tunerState().preview.kind, 'silent', 'Confirm does not play a reference');
    assert.throws(() => native.tunerCommand({ kind: 'confirm', expectedRevision: revision }), /changed/);
    assert.equal(native.tunerState().step, 1);
    native.start({ runId: 'tuner-handoff', countInBars: 0, startBar: 1, endBar: 2, loop: false });
    state = native.tunerState();
    assert(!state.listening && state.preview.kind === 'silent');
    assert.throws(() => native.tunerCommand({ kind: 'cue', expectedRevision: state.revision }), /Stop the performance/);
    assert.equal(native.state().phase, 'playing');
    native.stop();
    const before = native.tunerState().revision;
    native.control({ id: 'mushroom' });
    assert.throws(() => native.tunerCommand({ kind: 'cue', expectedRevision: before }), /changed/);
    state = native.tunerState();
    native.tunerCommand({ kind: 'listen', enabled: true, expectedRevision: state.revision });
    native.setMicrophone(false);
    assert.equal(native.tunerState().listening, false);
  } finally { native.dispose(); }
});
