import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import song from '../../../songs/dance-yrself-clean.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { CONTROL_IDS, type ChannelId } from '../model.js';
import { PF } from '../wasm-abi.js';

const compiled = song.compiled;
const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));

function createEngine(rate: number) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_write(_fd: number, _vectors: number, _count: number, written: number) {
        new DataView(memory.buffer).setUint32(written, 0, true);
        return 0;
      },
      fd_close: () => 0,
      fd_seek: () => 0,
      proc_exit(code: number) { throw new Error(`WASM exited ${code}`); },
    },
  });
  assert(instance.exports.memory instanceof WebAssembly.Memory);
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE,
    compiledProgram: Array.from(encodeCompiledProgram(compiled)), clickGain: 0,
    initialVoiceEffects: Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })) });
}

function marker(bar: number, beat: number) { return (bar * 8 + Math.floor(beat)) / 1024; }
type Audition = { bar: number; beat: number; channel: ChannelId; expected: number; label: string };

const auditions: readonly Audition[] = [
  { bar: 3, beat: .5, channel: 'R1', expected: marker(1, 0), label: 'first drums bar repeats while its second layer records' },
  { bar: 4, beat: 2.5, channel: 'R1', expected: marker(2, 2), label: 'second drums bar repeats while its second layer records' },
  { bar: 5, beat: .5, channel: 'R1', expected: marker(1, 0) + marker(3, 0), label: 'drums plays bar 1 plus bar 3' },
  { bar: 6, beat: 2.5, channel: 'R1', expected: marker(2, 2) + marker(4, 2), label: 'drums plays bar 2 plus bar 4' },
  { bar: 7, beat: 1.5, channel: 'R1', expected: marker(1, 1) + marker(3, 1), label: 'the drums composite repeats with a two-bar period' },
  { bar: 9, beat: .5, channel: 'L2', expected: marker(5, 0) + marker(7, 0), label: 'Bing Bong plays bar 5 plus bar 7' },
  { bar: 10, beat: .5, channel: 'L2', expected: marker(6, 0) + marker(8, 0), label: 'Bing Bong plays bar 6 plus the captured part of bar 8' },
  { bar: 10, beat: 2.5, channel: 'L2', expected: marker(6, 2), label: 'Bing Bong second layer contains zero source after bar 8 beat 3' },
  { bar: 11, beat: 1.5, channel: 'R2', expected: marker(10, 1), label: 'Cowbell first version contains bar 10' },
  { bar: 12, beat: 1.5, channel: 'R2', expected: marker(11, 1), label: 'Cowbell second version contains bar 11' },
  { bar: 13, beat: 1.5, channel: 'R2', expected: marker(12, 1), label: 'Cowbell third version contains bar 12' },
  { bar: 20, beat: .5, channel: 'R2', expected: marker(11, 0), label: 'the later (4)& phrase selects the separate bar 11 version' },
  { bar: 20, beat: 2.5, channel: 'R1', expected: marker(2, 2) + marker(4, 2), label: 'drums retains both layers later in the arrangement' },
  { bar: 21, beat: .5, channel: 'L2', expected: marker(5, 0) + marker(7, 0), label: 'Bing Bong retains both layers later in the arrangement' },
  { bar: 28, beat: .5, channel: 'R2', expected: marker(12, 0), label: 'the later 4 phrase selects the separate bar 12 version' },
  { bar: 36, beat: .5, channel: 'R2', expected: marker(11, 0), label: 'the new written Cowbell play resumes its matching bar 11 version' },
  { bar: 44, beat: .5, channel: 'R2', expected: marker(12, 0), label: 'the written Cowbell phrase selects bar 12 before the later stop cue' },
  { bar: 93, beat: .5, channel: 'R2', expected: marker(82, 0), label: 'the later Cowbell play selects the new bar 82 version' },
  { bar: 94, beat: .5, channel: 'R2', expected: marker(82, 0), label: 'the new Cowbell identity repeats on the next matching bar' },
  { bar: 95, beat: .5, channel: 'R2', expected: marker(83, 0), label: 'the new Cowbell identity selects the separate bar 83 version' },
  { bar: 96, beat: 3.25, channel: 'R2', expected: marker(82, 3), label: 'the shortened phrase reuses the retained bar 82 prefix' },
  { bar: 96, beat: 3.75, channel: 'R2', expected: 0, label: 'the shortened phrase excludes the final 4& source' },
  { bar: 97, beat: 3.75, channel: 'R2', expected: marker(82, 3), label: 'the following full phrase restores the final source without changing the take' },
  { bar: 100, beat: .5, channel: 'R2', expected: marker(84, 0), label: 'the new Cowbell identity selects the separate bar 84 version' },
  { bar: 164, beat: 3.25, channel: 'R2', expected: marker(82, 3), label: 'the second shortened phrase reuses the same retained prefix' },
  { bar: 164, beat: 3.75, channel: 'R2', expected: 0, label: 'the second shortened phrase excludes the final source' },
  { bar: 165, beat: 3.75, channel: 'R2', expected: marker(82, 3), label: 'the second following full phrase retains the original recording' },
];

for (const rate of [44100, 48000]) for (const autoFinish of [false, true]) test(`actual DYC source bars and Cowbell identities at ${rate} Hz with ${autoFinish ? 'automatic' : 'manual'} commit cues`, () => {
  const native = createEngine(rate);
  const at = (bar: number, beat: number) => Math.ceil((5 + (bar - 1) * 4 + beat) * rate * 60 / song.chart.bpm);
  const presses = compiled.cues.filter(cue => !autoFinish || (cue.kind !== 'commit' && cue.kind !== 'commit-arm'))
    .map(cue => ({ frame: cue.bar === 0 ? 1 : at(cue.bar, cue.cueBeat ?? 0) + 1, cue }))
    .sort((first, second) => first.frame - second.frame || CONTROL_IDS.indexOf(first.cue.buttonId) - CONTROL_IDS.indexOf(second.cue.buttonId));
  const checks = auditions.map(check => ({ ...check, frame: at(check.bar, check.beat) }));
  let frame = 0, nextPress = 0, nextCheck = 0;

  function render(frames: number) {
    const input = Float32Array.from({ length: frames }, (_, offset) => {
      const count = Math.floor((frame + offset) * song.chart.bpm / (rate * 60) - 5 + 1e-9);
      return count < 0 ? 0 : marker(Math.floor(count / 4) + 1, count % 4);
    });
    const mixed = [new Float32Array(frames), new Float32Array(frames)];
    native.process(input, mixed, frames, [new Float32Array(frames), new Float32Array(frames)]);
    frame += frames;
    for (const event of native.events()) {
      assert.notEqual(event.type, 'fault', `DYC fault at ${event.frame}: ${event.error}`);
      if (event.type === 'control') assert(event.applied, `DYC cue rejected at ${event.frame}: ${event.error}`);
    }
    return mixed;
  }

  try {
    native.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
    native.setMicrophone(true);
    native.start({ runId: `dyc-source-bars-${rate}`, bpm: song.chart.bpm, countInBars: 1, startBar: 1,
      endBar: song.chart.bars.length, loop: false, automatic: false });
    while (native.state().phase !== 'ended') {
      assert(frame < Math.ceil((compiled.chart.bars.length * 4 + 5) * rate * 60 / 40), 'DYC reaches the authored end');
      while (nextPress < presses.length && presses[nextPress].frame === frame) native.control({ id: presses[nextPress++].cue.buttonId });
      if (nextCheck < checks.length && checks[nextCheck].frame === frame) {
        const check = checks[nextCheck++];
        for (const channel of CONTROL_IDS) native.setChannel(channel, { gain: channel === check.channel ? 1 : 0 });
        const mixed = render(64);
        for (const output of mixed) assert(output.every(sample => Math.abs(sample - check.expected) < 1e-6),
          `${check.label}; expected ${check.expected}, received ${mixed[0][0]}`);
      } else {
        const count = Math.min(2048, (presses[nextPress]?.frame ?? Infinity) - frame, (checks[nextCheck]?.frame ?? Infinity) - frame);
        assert(count > 0);
        render(count);
      }
    }
    assert.equal(nextPress, presses.length, 'the entire song cue sequence ran');
    assert.equal(nextCheck, checks.length, 'every source-content audition ran');
  } finally { native.dispose(); }
});
