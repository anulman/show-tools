import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { NativePerformance } from '../../../lib/performance/wasm-performance.js';
import { compiledCaptureFixture } from '../../../lib/performance/tests/fixtures/compiled-capture.js';
import { encodeCompiledProgram } from '../../../lib/performance/compiled-native.js';
import { voiceSampleArchive, selectedSampleArchive, sampleFileName } from '../sample-downloads.js';
import { decodeTakeAudio } from '../../../lib/performance/take-audio.js';
import tribulations from '../../../songs/tribulations.js';

async function captured(rate: number) {
  const compiled = await compiledCaptureFixture();
  let memory: WebAssembly.Memory;
  const { instance } = await WebAssembly.instantiate(await readFile(new URL('../wasm/manual-clock.wasm', import.meta.url)), {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: { fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; }, fd_close: () => 0, fd_seek: () => 0, proc_exit() { throw new Error('WASM exited'); } },
  });
  assert(instance.exports.memory instanceof WebAssembly.Memory); memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  const native = new NativePerformance({ api: instance.exports, sampleRate: rate, mode: 2, compiledProgram: Array.from(encodeCompiledProgram(compiled)), clickGain: 0 });
  native.setMicrophone(true);
  native.start({ runId: 'sample-download-test', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false });
  native.control({ id: 'R1' }, 'arm');
  const process = () => native.process(new Float32Array(128).fill(.25), [new Float32Array(128), new Float32Array(128)], 128);
  while (native.state().bar !== 1) process();
  native.control({ id: 'R1' }, 'commit-arm');
  while (native.state().bar !== 2) process();
  native.control({ id: 'R1' }, 'commit');
  while (native.state().bar !== 3) process();
  native.stop();
  return { compiled, native };
}

for (const rate of [8000, 48000]) test(`actual captured samples download as separate float WAVs at ${rate} Hz`, async () => {
  const { compiled, native } = await captured(rate);
  try {
    const archive = unzipSync(await voiceSampleArchive(compiled, 'drums', native.state(), { takeAudioToken: () => native.takeAudioToken(), takeAudio: async request => native.takeAudio(request) }));
    const metadata = JSON.parse(strFromU8(archive['samples.json']));
    assert.equal(metadata.kind, 'captured-voice-samples'); assert.equal(metadata.samples.length, 2);
    const wav = archive[metadata.samples[0].file], header = new DataView(wav.buffer, wav.byteOffset, wav.length);
    assert.equal(strFromU8(wav.subarray(0, 4)), 'RIFF'); assert.equal(header.getUint16(20, true), 3);
    assert.equal(strFromU8(wav.subarray(38, 42)), 'fact'); assert.equal(header.getUint32(46, true), native.compiledTake(0).frames);
    assert.equal(header.getUint32(24, true), rate); assert.equal(header.getUint16(22, true), 2);
    assert.equal(wav.length, 58 + native.compiledTake(0).frames * 8);
    for (let offset = 58; offset < wav.length; offset += 4) assert.equal(header.getFloat32(offset, true), .25);
    assert.deepEqual(metadata.samples[0].capture, compiled.takes[0]);
    assert.deepEqual(metadata.selections, compiled.selections.filter(value => value.voiceId === 'drums'));
    await assert.rejects(voiceSampleArchive(compiled, 'cowbell', native.state(), { takeAudioToken: () => '', takeAudio: async () => new Uint8Array() }), /no captured/);
    assert.throws(() => native.takeAudio({ take: 0, offset: 2 ** 32, frames: 1, token: native.takeAudioToken() }), /invalid/);
    assert.throws(() => native.takeAudio({ take: 0, offset: native.compiledTake(0).frames, frames: 1, token: native.takeAudioToken() }), /range exceeds/);
    const before = native.takeAudioToken();
    native.start({ runId: 'new-run', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false }); native.stop();
    assert.throws(() => native.takeAudio({ take: 0, offset: 0, frames: 1, token: before }), /changed/);
    await assert.rejects(voiceSampleArchive(compiled, 'drums', native.state(), {
      takeAudioToken: () => native.takeAudioToken(), takeAudio: async request => {
        const bytes = native.takeAudio(request);
        native.start({ runId: 'intervening-run', bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false }); native.stop();
        return bytes;
      },
    }), /changed during download/);
  } finally { native.dispose(); }
});

test('invalid chunks and unsafe filename characters are rejected or bounded', () => {
  assert.throws(() => decodeTakeAudio(new Uint8Array(12)), /dimensions/);
  assert.equal(sampleFileName('../../Drums / Claps'), 'Drums-Claps');
});


test('a combined ZIP reads each selected capture once and includes only those voices', async () => {
  const song = tribulations.compiled;
  assert(song);
  const requests: number[] = [];
  const state = { phase: 'ended' as const, runId: 'combined', compiledTakes: [0, 1, 4].map(index => ({
    index, ready: true, frames: 2, period: 2, playback: 'idle' as const, sourceEndFrames: null, selectionIndex: null,
  })) };
  let token = 'take-generation';
  const takeAudio = async ({ take, frames }: { take: number; frames: number }) => {
    requests.push(take);
    const bytes = new Uint8Array(12 + frames * 8), data = new DataView(bytes.buffer);
    data.setUint32(0, 48000, true); data.setUint32(4, 2, true); data.setUint32(8, frames, true);
    return bytes;
  };
  const source = { takeAudioToken: () => token, takeAudio };
  const archive = unzipSync(await selectedSampleArchive(song, ['pad', 'morse', 'pad'], state, source));
  assert.deepEqual(requests, [0, 1]);
  const manifest = JSON.parse(strFromU8(archive['samples.json']));
  assert.equal(manifest.kind, 'captured-samples');
  assert.deepEqual(manifest.voiceIds, ['pad', 'morse']);
  assert.deepEqual(manifest.samples.map((sample: { capture: { voiceId: string } }) => sample.capture.voiceId), ['pad', 'morse']);
  assert.deepEqual(Object.keys(archive), ['01-pad.wav', '02-morse.wav', 'samples.json']);
  assert(manifest.selections.every((selection: { voiceId: string }) => ['pad', 'morse'].includes(selection.voiceId)));

  requests.length = 0;
  const large = { ...state, compiledTakes: state.compiledTakes.map(take => ({ ...take, frames: 9_000_000 })) };
  await assert.rejects(selectedSampleArchive(song, ['pad', 'morse'], large, source), /128 MiB/);
  assert.deepEqual(requests, [], 'reject an oversized selection before reading any PCM');
  await assert.rejects(selectedSampleArchive(song, [], state, source), /select|captured/i);
  assert.deepEqual(requests, [], 'empty selection reads no PCM');

  await assert.rejects(selectedSampleArchive(song, ['pad', 'morse'], state, { ...source, takeAudio: async request => {
    const chunk = await takeAudio(request);
    if (request.take === 1) token = 'different-generation';
    return chunk;
  } }), /changed during download/);
  assert.deepEqual(requests, [0, 1], 'a session replacement between voices cannot publish a mixed ZIP');
});
