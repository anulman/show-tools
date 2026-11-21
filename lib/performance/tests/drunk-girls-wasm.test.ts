import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { encodeCompiledProgram } from '../compiled-native.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { PF } from '../wasm-abi.js';
import { NativePerformance } from '../wasm-performance.js';

const wasm = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
const chart = await readMusicXmlSong(await readFile(new URL('../../../songs/drunk-girls.musicxml', import.meta.url), 'utf8'));

for (const sampleRate of [44100, 48000]) test(`Drunk Girls captures on 4 and 1 and plays both words through real taps at ${sampleRate} Hz`, () => {
  const instance = new WebAssembly.Instance(wasm, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } },
  });
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const { song } = chart;
  const native = new NativePerformance({ api: instance.exports, sampleRate, mode: PF.PRACTICE,
    compiledProgram: Array.from(encodeCompiledProgram(song)), clickGain: 0,
    initialVoiceEffects: Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })) });
  const takes = song.takes.flatMap((take, index) => take.voiceId === 'girls' ? [index] : []);
  assert.equal(takes.length, 2);
  const automaticCommit = song.cues.findIndex(cue => cue.commitTakeId === song.takes[takes[1]].id);
  assert(automaticCommit >= 0);
  const [drunk, girls] = takes;
  const beatFrames = sampleRate * 60 / song.chart.bpm;
  const at = (bar: number, beat: number, ms = 0) => Math.ceil(((bar - 13) * 4 + 5 + beat - 1) * beatFrames + ms * sampleRate / 1000) + 1;
  const tap = () => native.control({ id: 'R2' });
  let frame = 0;
  function advance(until: number, input = 0) {
    let peak = 0;
    while (frame < until) {
      const count = Math.min(256, until - frame);
      const left = new Float32Array(count);
      native.process(new Float32Array(count).fill(input), [left, new Float32Array(count)], count);
      for (const sample of left) peak = Math.max(peak, Math.abs(sample));
      frame += count;
    }
    return peak;
  }
  try {
    native.setMicrophone(true);
    native.setClick(false);
    native.start({ runId: 'drunk-girls-taps', bpm: song.chart.bpm, countInBars: 1, startBar: 13, endBar: 20, loop: false, automatic: false });
    advance(at(13, 4, -50));
    tap();
    advance(at(13, 4));
    advance(at(14, 1, -50), .2);
    tap();
    advance(at(14, 1), .2);
    assert.equal(native.compiledTake(drunk).ready, true);
    assert.equal(native.state().compiledTakes?.[drunk].playback, 'idle', 'the second recording marker should only store Drunk');
    assert.equal(native.compiledTake(girls).ready, false, 'Girls is still recording before beat 2');
    advance(at(14, 2, -1), .6);
    assert.equal(native.compiledTake(girls).ready, false);
    advance(at(14, 2), .6);
    const captureEvents = native.events();
    assert(captureEvents.some(event => event.type === 'cue' && event.cueRow === 'R2'));
    assert(!captureEvents.some(event => event.type === 'cue' && event.cueIndex === automaticCommit), 'the automatic store never asks for a third tap');
    for (const take of takes) {
      assert.equal(native.compiledTake(take).ready, true);
      assert(Math.abs(native.compiledTake(take).frames - beatFrames) <= 1);
      assert.equal(native.state().compiledTakes?.[take].playback, 'idle', 'recording never launches a word');
    }
    const playbackTaps = [
      [15, 4, 55, drunk, girls, .2], [16, 1, 55, girls, drunk, .6],
      [17, 4, -55, drunk, girls, .2], [18, 1, -55, girls, drunk, .6],
    ] as const;
    for (const [bar, beat, offset, selected, other, signal] of playbackTaps) {
      advance(at(bar, beat, offset));
      tap();
      assert.equal(native.state().compiledTakes?.[selected].playback, 'playing', `tap on bar ${bar} beat ${beat} must launch its word`);
      assert.equal(native.state().compiledTakes?.[other].playback, 'idle');
      assert(Math.abs(advance(frame + Math.round(beatFrames)) - signal) < .03, 'the selected word reaches the output');
    }
  } finally { native.dispose(); }
});
