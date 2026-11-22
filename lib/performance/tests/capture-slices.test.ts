import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { decodeCompiledSong } from '../compiled-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { NativePerformance } from '../wasm-performance.js';
import { CONTROL_IDS } from '../model.js';
import { PF } from '../wasm-abi.js';

async function fixture() {
  return readMusicXmlSong(await readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8'));
}

test('latest DYC retains complete Cowbell parents and selects explicit whole-bar slices', async () => {
  const { song, report, source, mapping } = await fixture();
  assert(source && mapping);
  const reimported = await importSheetMusicXml({ source, mapping });
  assert.deepEqual((await readMusicXmlSong(reimported.xml)).song, song);
  assert(song.executable);
  assert.equal(song.takes.length, 5);
  const parents = song.takes.filter(take => take.voiceId === 'cowbell');
  assert.deepEqual(parents.map(take => [take.begin.bar, take.captureEnd?.bar]), [[8, 13], [79, 85]]);
  for (const [index, cell] of ['N21', 'CH21'].entries()) {
    const cue = song.cues.find(cue => cue.source.a1 === cell);
    assert(cue);
    assert.deepEqual(cue.execution, { kind: 'next-bar' });
    assert.equal(cue.launchPolicy, 'store');
    const full = song.selections.find(selection => selection.id === cue.selectionId);
    assert.deepEqual(full?.window, { kind: 'full' });
    const parent = parents[index];
    assert.deepEqual(full?.takeIds, [parent.id]);
    const windows = song.selections.filter(selection => selection.takeIds[0] === parent.id && selection.id.includes('/bar-')).map(selection => selection.window);
    assert.deepEqual(windows, Array.from({ length: index === 0 ? 5 : 6 }, (_, offset) =>
      ({ kind: 'slice', beginCount: offset * 4, endCount: (offset + 1) * 4, loopCounts: 4 })));
  }
  const shortened = song.playback.find(cue => cue.voiceId === 'cowbell' && cue.bar === 96);
  assert.deepEqual(song.selections.find(selection => selection.id === shortened?.selectionId)?.window,
    { kind: 'slice', beginCount: 12, endCount: 15.5, loopCounts: 4 });
  const rewritten = await readMusicXmlSong(await writeMusicXmlSong({ song, report }));
  assert.deepEqual(rewritten.song, song);
  assert.deepEqual(rewritten.report, report);
  const slice = song.selections.find(selection => selection.window.kind === 'slice');
  assert(slice?.window.kind === 'slice');
  assert.throws(() => decodeCompiledSong({ ...song, selections: song.selections.map(selection => selection === slice
    ? { ...selection, window: { ...slice.window, endCount: 10000 } } : selection) }), /capture slice/);
});

const module = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
for (const rate of [44100, 48000]) test(`actual DYC chopped Cowbell views admit the correct parent source at ${rate} Hz`, async () => {
  const { song } = await fixture();
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(module, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) {
      new DataView(memory.buffer).setUint32(written, 0, true); return 0;
    }, fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); } },
  });
  assert(instance.exports.memory instanceof WebAssembly.Memory);
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const native = new NativePerformance({ api: instance.exports, sampleRate: rate, mode: PF.PRACTICE,
    compiledProgram: Array.from(encodeCompiledProgram(song)), clickGain: 0,
    initialVoiceEffects: Array.from({ length: PF.VOICE_PROFILES }, (_, profile) => ({ profile, effects: [] })) });
  const at = (bar: number, count = 0) => Math.ceil((5 + (bar - 1) * 4 + count) * rate * 60 / song.chart.bpm);
  const plan = song.cues.filter(cue => cue.bar <= 98).map(cue => ({ cue, frame: cue.bar === 0 ? 1 : at(cue.bar, cue.cueBeat ?? 0) + 1 }))
    .sort((a, b) => a.frame - b.frame || CONTROL_IDS.indexOf(a.cue.buttonId) - CONTROL_IDS.indexOf(b.cue.buttonId));
  let frame = 0, press = 0;
  function until(end: number): Float32Array {
    let last = new Float32Array();
    while (frame < end) {
      while (press < plan.length && plan[press].frame === frame) native.control({ id: plan[press++].cue.buttonId });
      const count = Math.min(1024, (plan[press]?.frame ?? Infinity) - frame, end - frame);
      const input = Float32Array.from({ length: count }, (_, offset) => Math.max(0,
        Math.floor(((frame + offset) * song.chart.bpm / (rate * 60) - 5) / 4) + 1) / 100);
      const mixed = [new Float32Array(count), new Float32Array(count)];
      native.process(input, mixed, count); frame += count; last = mixed[0];
      for (const event of native.events()) {
        assert.notEqual(event.type, 'fault', event.error ?? 'native fault');
        if (event.type === 'control') assert(event.applied, event.error ?? 'control rejected');
      }
    }
    return last;
  }
  try {
    assert.equal(native.compiledTake(0).selectionIndex, null);
    native.setMicrophone(true);
    native.start({ runId: 'capture-slices', bpm: song.chart.bpm, countInBars: 1, startBar: 1, endBar: 98, loop: false });
    for (const id of CONTROL_IDS) native.setChannel(id, { gain: id === 'R2' ? 1 : 0 });
    for (const [bar, count, expected] of [[20, 1, .11], [93, 1, .82], [96, 1, .82], [96, 3.75, 0], [97, 1, .82]]) {
      until(at(bar, count));
      const output = until(frame + 32);
      assert(output.every(sample => Math.abs(sample - expected) < 1e-6), `bar ${bar}:${count} expected ${expected}, received ${output[0]}`);
      const sourceBar = bar === 20 ? 11 : 82;
      const parent = song.takes.findIndex(take => take.voiceId === 'cowbell' && sourceBar >= take.begin.bar && sourceBar < (take.captureEnd?.bar ?? 0));
      const selected = song.selections.findIndex(selection => selection.takeIds.includes(song.takes[parent].id)
        && selection.window.kind === 'slice' && selection.window.beginCount === (sourceBar - song.takes[parent].begin.bar) * 4
        && selection.window.endCount === (sourceBar - song.takes[parent].begin.bar) * 4 + (bar === 96 ? 3.5 : 4));
      assert(selected >= 0);
      assert.equal(native.compiledTake(parent).selectionIndex, selected, `bar ${bar} reports its actual native playing view`);
      assert.equal(native.state().compiledTakes?.find(take => take.index === parent)?.selectionIndex, selected);

    }
    native.stop();
    assert(native.state().compiledTakes?.every(take => take.selectionIndex === null));
  } finally { native.dispose(); }
});
