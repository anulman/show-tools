import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import source from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.mapping.json';
import { compileSong } from '../compiled-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { CONTROL_IDS } from '../model.js';
import { PF } from '../wasm-abi.js';

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));

for (const rate of [44100, 48000]) test(`DYC Cowbell play renders the written bar identity at ${rate} Hz`, async () => {
  const values = source.values.map(row => [...row]);
  values[18][21] = 'p';
  const song = await compileSong({ ...source, values }, mapping);
  assert(song.executable, JSON.stringify(song.diagnostics));
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_write(_fd: number, _vectors: number, _count: number, written: number) {
        new DataView(memory.buffer).setUint32(written, 0, true); return 0;
      },
      fd_close: () => 0, fd_seek: () => 0,
      proc_exit(code: number) { throw new Error(`WASM exited ${code}`); },
    },
  });
  assert(instance.exports.memory instanceof WebAssembly.Memory);
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const engine = new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE,
    compiledProgram: Array.from(encodeCompiledProgram(song)), clickGain: 0 });
  const at = (bar: number, beat = 0) => Math.ceil((5 + (bar - 1) * 4 + beat) * rate * 60 / song.chart.bpm);
  const plan = song.cues.filter(cue => cue.bar <= 20)
    .map(cue => ({ cue, frame: cue.bar === 0 ? 1 : at(cue.bar, cue.cueBeat ?? 0) + 1 }))
    .sort((a, b) => a.frame - b.frame || CONTROL_IDS.indexOf(a.cue.buttonId) - CONTROL_IDS.indexOf(b.cue.buttonId));
  let frame = 0, press = 0;
  try {
    engine.prepareVoiceEffects(Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })));
    engine.setMicrophone(true);
    engine.start({ runId: 'variant-play-audio', bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar: 21, loop: false });
    for (const id of CONTROL_IDS) engine.setChannel(id, { gain: id === 'R2' ? 1 : 0 });
    while (frame < at(20, .5)) {
      while (press < plan.length && plan[press].frame === frame) engine.control({ id: plan[press++].cue.buttonId });
      const count = Math.min(1024, (plan[press]?.frame ?? Infinity) - frame, at(20, .5) - frame);
      assert(count > 0);
      const input = Float32Array.from({ length: count }, (_, offset) => {
        const musicalCount = Math.floor((frame + offset) * song.chart.bpm / (rate * 60) - 5 + 1e-9);
        return musicalCount < 0 ? 0 : (Math.floor(musicalCount / 4) + 1) / 100;
      });
      engine.process(input, [new Float32Array(count), new Float32Array(count)], count);
      frame += count;
      for (const event of engine.events()) {
        assert.notEqual(event.type, 'fault', event.error);
        if (event.type === 'control') assert(event.applied, event.error);
      }
    }
    const output = [new Float32Array(32), new Float32Array(32)];
    engine.process(new Float32Array(32), output, 32);
    for (const channel of output) assert(channel.every(sample => Math.abs(sample - .11) < 1e-6),
      `written (4)& must replay bar 11, rather than the last recorded bar 12; received ${output[0][0]}`);
  } finally { engine.dispose(); }
});
