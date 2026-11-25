import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import song from '../../../songs/dance-yrself-clean.js';
import { compileSheetsSong } from '../compiled-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { terseCaptureInput } from './fixtures/terse-capture.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { CONTROL_IDS, type ChannelId } from '../model.js';
import { PF } from '../wasm-abi.js';

const compiled = song.compiled;
assert.equal(compiled.takes.filter(take => take.voiceId === 'whistle').length, 1);
assert.equal(compiled.chart.bars[46].cues.L1, 'c4&~2..3');
assert.equal(compiled.chart.bars[47].cues.L1, '');
const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));

function createEngine(rate: number, program = compiled) {
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
    compiledProgram: Array.from(encodeCompiledProgram(program)), clickGain: 0,
    initialVoiceEffects: Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })) });
}

function marker(bar: number, beat: number) { return (bar * 8 + Math.floor(beat * 2)) / 1024; }
type Audition = { bar: number; beat: number; channel: ChannelId; expected: number; label: string };

const auditions: readonly Audition[] = [
  { bar: 47, beat: 3.75, channel: 'L1', expected: marker(44, 3.5), label: 'Whistle starts on the recorded pickup' },
  { bar: 48, beat: .25, channel: 'L1', expected: marker(45, 0), label: 'Whistle plays section 1 on the first pass' },
  { bar: 49, beat: 2.25, channel: 'L1', expected: marker(46, 2), label: 'Whistle reaches section 2' },
  { bar: 51, beat: .25, channel: 'L1', expected: marker(46, 0), label: 'Whistle repeats section 2 instead of section 1' },
  { bar: 69, beat: .25, channel: 'L1', expected: marker(44, 3.5), label: 'A later Whistle launch starts with the pickup again' },
  { bar: 3, beat: 3.75, channel: 'R1', expected: marker(0, 3.5), label: 'Drums start on the recorded count-in pickup' },
  { bar: 4, beat: .25, channel: 'R1', expected: marker(1, 0), label: 'Drums play the opening section once' },
  { bar: 5, beat: .25, channel: 'R1', expected: marker(2, 0), label: 'Drums reach the repeat start' },
  { bar: 6, beat: 2.25, channel: 'R1', expected: marker(3, 2), label: 'Drums play the second bar of the repeat' },
  { bar: 7, beat: 3.75, channel: 'R1', expected: marker(2, 3.5), label: 'The second repeat bar keeps its pickup on the seam' },
  { bar: 9, beat: .25, channel: 'R1', expected: marker(2, 0), label: 'Drums repeat section 2 without replaying section 1' },
  { bar: 9, beat: .625, channel: 'L2', expected: marker(5, .5), label: 'Bing Bong reuses bar 5' },
  { bar: 10, beat: .625, channel: 'L2', expected: marker(6, .5), label: 'Bing Bong reuses bar 6' },
  { bar: 10, beat: 2.625, channel: 'L2', expected: marker(6, 2.5), label: 'Bing Bong retains the whole second bar' },
  { bar: 11, beat: 1.625, channel: 'R2', expected: 0, label: 'Cowbell capture remains unpublished before cxb' },
  { bar: 12, beat: 1.625, channel: 'R2', expected: 0, label: 'Cowbell captures all performed bars before publishing' },
  { bar: 13, beat: 1.625, channel: 'R2', expected: 0, label: 'Cowbell commit stores without launching playback' },
  { bar: 20, beat: .625, channel: 'R2', expected: marker(11, .5), label: 'the later (4)& phrase selects the separate bar 11 version' },
  { bar: 20, beat: 2.25, channel: 'R1', expected: marker(3, 2), label: 'drums retains its original take later in the arrangement' },
  { bar: 21, beat: .625, channel: 'L2', expected: marker(5, .5), label: 'Bing Bong retains its original take later in the arrangement' },
  { bar: 28, beat: .625, channel: 'R2', expected: marker(12, .5), label: 'the later 4 phrase selects the separate bar 12 version' },
  { bar: 36, beat: .625, channel: 'R2', expected: marker(11, .5), label: 'the new written Cowbell play resumes its matching bar 11 version' },
  { bar: 44, beat: .625, channel: 'R2', expected: marker(12, .5), label: 'the written Cowbell phrase selects bar 12 before the later stop cue' },
  { bar: 93, beat: .625, channel: 'R2', expected: marker(82, .5), label: 'the later Cowbell play selects the new bar 82 version' },
  { bar: 94, beat: .625, channel: 'R2', expected: marker(82, .5), label: 'the new Cowbell identity repeats on the next matching bar' },
  { bar: 95, beat: .625, channel: 'R2', expected: marker(83, .5), label: 'the new Cowbell identity selects the separate bar 83 version' },
  { bar: 96, beat: 3.25, channel: 'R2', expected: marker(82, 3), label: 'the shortened phrase reuses the retained bar 82 prefix' },
  { bar: 96, beat: 3.75, channel: 'R2', expected: 0, label: 'the shortened phrase excludes the final 4& source' },
  { bar: 97, beat: 3.75, channel: 'R2', expected: marker(82, 3.5), label: 'the following full phrase restores the final source without changing the take' },
  { bar: 100, beat: .625, channel: 'R2', expected: marker(84, .5), label: 'the new Cowbell identity selects the separate bar 84 version' },
  { bar: 164, beat: 3.25, channel: 'R2', expected: marker(82, 3), label: 'the second shortened phrase reuses the same retained prefix' },
  { bar: 164, beat: 3.75, channel: 'R2', expected: 0, label: 'the second shortened phrase excludes the final source' },
  { bar: 165, beat: 3.75, channel: 'R2', expected: marker(82, 3.5), label: 'the second following full phrase retains the original recording' },
];

for (const rate of [44100, 48000]) for (const countInBars of [1, 2]) for (const autoFinish of [false, true]) test(`actual DYC source bars and Cowbell identities at ${rate} Hz with ${autoFinish ? 'automatic' : 'manual'} commit cues and ${countInBars} count-in bars`, () => {
  const native = createEngine(rate);
  const startCount = 1 + countInBars * 4;
  const at = (bar: number, beat: number) => Math.ceil((startCount + (bar - 1) * 4 + beat) * rate * 60 / song.chart.bpm);
  const presses = compiled.cues.filter(cue => !autoFinish || (cue.kind !== 'commit' && cue.kind !== 'commit-arm'))
    .map(cue => ({ frame: cue.bar === 0 ? 1 : at(cue.bar, cue.cueBeat ?? 0) + 1, cue }))
    .sort((first, second) => first.frame - second.frame || CONTROL_IDS.indexOf(first.cue.buttonId) - CONTROL_IDS.indexOf(second.cue.buttonId));
  const checks = auditions.map(check => ({ ...check, frame: at(check.bar, check.beat) })).sort((a, b) => a.frame - b.frame);
  let frame = 0, nextPress = 0, nextCheck = 0;

  function render(frames: number) {
    const input = Float32Array.from({ length: frames }, (_, offset) => {
      const count = Math.floor(((frame + offset) * song.chart.bpm / (rate * 60) - startCount) * 2 + 1e-9) / 2;
      const bar = Math.floor(count / 4);
      return count < -4 ? 0 : marker(bar + 1, count - bar * 4);
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
    native.start({ runId: `dyc-source-bars-${rate}`, bpm: song.chart.bpm, countInBars, startBar: 1,
      endBar: song.chart.bars.length, loop: false, automatic: false });
    while (native.state().phase !== 'ended') {
      assert(frame < Math.ceil((compiled.chart.bars.length * 4 + startCount) * rate * 60 / 40), 'DYC reaches the authored end');
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

test('stored pickup take keeps its ending while playback skips it and wraps at a new tempo', async () => {
  const { source, mapping } = terseCaptureInput();
  for (const control of mapping.controls) source.values[control.cueRow - 1].fill('', 1);
  source.values[19][1] = 'r4&';
  source.values[19][5] = 'cx4&~2..3';
  source.values[19][6] = 'pb';
  for (let bar = 1; bar <= 4; bar++) source.values[11][bar + 1] = `/${bar}/-`;
  const beyondCapture = structuredClone(source);
  beyondCapture.values[19][5] = 'cx4&~2..5';
  const invalid = await compileSheetsSong(beyondCapture, mapping);
  assert(!invalid.executable);
  assert(invalid.diagnostics.some(issue => issue.code === 'repeat-range' && issue.source.a1 === 'F20'));

  const { xml } = await importSheetMusicXml({ source, mapping });
  const { song: loop } = await readMusicXmlSong(xml);
  assert(loop.executable);
  assert.equal(loop.takes[0].phrase, '/1/-|/2/-|/3/-|/4/-');
  assert.deepEqual(loop.selections[0].window, { kind: 'intro-loop', repeatBeginCount: 4, endCount: 12 });
  const rate = 16000;
  const engine = createEngine(rate, loop);
  const inputAt = (count: number) => count < 0 ? .05 : (Math.floor(count / 4) + 1) / 10;
  let frame = 0;
  function renderUntil(end: number, input?: (frame: number) => number) {
    while (frame < end) {
      const size = Math.min(end - frame, 1024);
      const mixed = [new Float32Array(size), new Float32Array(size)];
      const pcm = Float32Array.from({ length: size }, (_, offset) => input?.(frame + offset) ?? 0);
      engine.process(pcm, mixed, size, [new Float32Array(size), new Float32Array(size)]);
      frame += size;
      for (const event of engine.events()) {
        assert.notEqual(event.type, 'fault', event.error);
        if (event.type === 'control') assert(event.applied, event.error);
      }
      if (frame === end) return mixed[0].at(-1);
    }
  }
  const start = (bpm: number, countInBars: number, startBar: number) => {
    frame = 0;
    engine.start({ runId: `repeat-${bpm}-${countInBars}`, bpm, countInBars, startBar, endBar: 10, loop: false, automatic: false });
  };
  try {
    engine.setMicrophone(true);
    start(120, 0, 1);
    renderUntil(5 * rate, () => .5);
    assert(!engine.compiledTake(0).ready);
    assert.equal(engine.state().channels.find(channel => channel.id === 'L1')?.status, 'empty');
    engine.stop();

    start(120, 1, 1);
    renderUntil(21 * rate / 2, at => inputAt(at * 2 / rate - 5));
    assert(engine.compiledTake(0).ready);
    assert.equal(engine.compiledTake(0).frames, 16 * rate / 2);
    engine.stop();

    // Launch at bar 6 after restarting transport at bar 5 at a faster tempo.
    start(180, 0, 5);
    const at = (count: number) => Math.ceil(count * rate / 3);
    renderUntil(at(1.25));
    engine.control({ id: 'L1' });
    for (const [elapsed, expected] of [[.15, .05], [1.5, .1], [5.5, .2], [9.5, .3], [13.5, .2], [17.5, .3]]) {
      const actual = renderUntil(at(5 + elapsed));
      assert(actual !== undefined && Math.abs(actual - expected) < 1e-5, `count ${elapsed}: expected ${expected}, read ${actual}`);
    }
  } finally { engine.dispose(); }
});
