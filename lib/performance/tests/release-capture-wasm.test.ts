import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileSheetsSong, type SongMapping } from '../compiled-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { NativePerformance } from '../wasm-performance.js';
import { PF } from '../wasm-abi.js';
import { CONTROL_IDS } from '../model.js';

const wasm = await WebAssembly.compile(await readFile(new URL('../../../ui/practice/wasm/manual-clock.wasm', import.meta.url)));
const source = {
  sourceVersion: 1,
  spreadsheetId: 'abcdefghijklmnopqrstuv',
  sheetId: 102,
  sheetName: 'Word capture',
  range: 'A1:H6',
  values: [
    ['', 'Drunk Girls release capture'],
    ['', '120'],
    ['Section', '', 'Verse'],
    ['Bar', 'Lead-in', '1', '2', '3', '4', '5', '6'],
    ['AF - Girls'],
    ['R2', '', '', '4ru(drunk)', '1cx(drunk)+1ru(girls) 2cx(girls)', '4pp(drunk+girls)', '2pp(drunk+girls) 4pp(drunk+girls)', '3p(drunk)'],
  ],
  notes: {},
};
const mapping: SongMapping = {
  mappingVersion: 6, notationVersion: 'terse-v2', songId: 'word-capture',
  spreadsheetId: source.spreadsheetId, sheetId: 102, sheetName: source.sheetName,
  titleCell: 'B1', bpmCell: 'B2', sectionRow: 3, barRow: 4, leadInColumn: 2, startBar: 1, endBar: 6,
  meter: { numerator: 4, denominator: 4 },
  controls: [{ buttonId: 'R2', voiceId: 'girls', cueRow: 6, arrangementRow: 5, nameNoteCell: 'A6', playbackMode: 'one-shot' }],
  inputBindings: [{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R2'] } }],
  sourceBindings: [
    { buttonId: 'R2', sourceName: 'drunk', playbackMode: 'one-shot' },
    { buttonId: 'R2', sourceName: 'girls', playbackMode: 'one-shot', default: true },
  ],
  liveParts: [], cueWindow: { earlyMs: 25, lateMs: 25, ties: 'reject' },
  capturePolicies: [{ voiceId: 'girls', retention: 'variant', gain: 1 }],
  layerGroups: [], variantRules: [], variantReuses: [], overrides: [], deferredRows: [],
};

function engine(program: Float64Array, sampleRate: number) {
  let memory: WebAssembly.Memory;
  const instance = new WebAssembly.Instance(wasm, {
    env: { abort() { throw new Error('WASM aborted'); }, emscripten_notify_memory_growth() {} },
    wasi_snapshot_preview1: {
      fd_write(_fd: number, _vectors: number, _count: number, written: number) { new DataView(memory.buffer).setUint32(written, 0, true); return 0; },
      fd_close: () => 0, fd_seek: () => 0, proc_exit(code: number) { throw new Error(`WASM exited ${code}`); },
    },
  });
  assert(instance.exports.memory instanceof WebAssembly.Memory);
  memory = instance.exports.memory;
  if (typeof instance.exports._initialize === 'function') instance.exports._initialize();
  return new NativePerformance({
    api: instance.exports, sampleRate, mode: PF.PRACTICE, compiledProgram: Array.from(program), clickGain: 0,
    initialVoiceEffects: Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] })),
  });
}

function runAudio(native: NativePerformance, rate: number) {
  const beatFrames = rate / 2;
  let frame = 0;
  const faults: string[] = [];
  const render = (frames: number, input = 0) => {
    const output = [new Float32Array(frames), new Float32Array(frames)];
    native.process(new Float32Array(frames).fill(input), output, frames);
    frame += frames;
    for (const event of native.events()) if (event.type === 'fault') faults.push(event.error ?? 'Native audio fault');
    return output[0];
  };
  const until = (bar: number, beat: number, input = 0) => {
    const limit = frame + beatFrames * 32;
    while (frame < limit) {
      const state = native.state();
      if (state.phase === 'playing' && state.bar === bar && state.beat === beat) return;
      render(64, input);
    }
    assert.fail(`Transport did not reach ${bar}:${beat}. Faults: ${faults.join(', ')}`);
  };
  return { beatFrames, faults, render, until, frame: () => frame };
}

function physical(native: NativePerformance, session: number) {
  const bindingGeneration = native.inputRouting().bindingGeneration;
  native.inputAttach({ producer: 0, session, bindingGeneration, kind: 'physical', releasedMask: 63, heldMask: 0 });
  let sequence = 0;
  const edge = (value: 0 | 1, input = 0) => native.inputEvent({ producer: 0, session, bindingGeneration, sequence: ++sequence, input, value });
  return { edge, revoke: () => native.inputRevoke({ producer: 0, session }) };
}

async function compiledFixture() {
  const { xml } = await importSheetMusicXml({ source, mapping });
  const { song } = await readMusicXmlSong(xml);
  assert.equal(song.executable, true, JSON.stringify(song.diagnostics));
  return song;
}

for (const rate of [44100, 48000]) test(`release captures actual word lengths and beat-specific taps overlap at ${rate} Hz`, async () => {
  const song = await compiledFixture(), native = engine(encodeCompiledProgram(song), rate);
  const { beatFrames, faults, render, until, frame } = runAudio(native, rate);
  const { edge } = physical(native, 1);
  const bindingGeneration = native.inputRouting().bindingGeneration;
  native.inputAttach({ producer: 1, session: 2, bindingGeneration, kind: 'pointer', releasedMask: 223, heldMask: 0 });
  const foreignEdge = (sequence: number, value: 0 | 1) =>
    native.inputEvent({ producer: 1, session: 2, bindingGeneration, sequence, input: CONTROL_IDS.indexOf('R2'), value });
  const advance = (beats: number, amplitude = 0) => render(Math.round(beatFrames * beats), amplitude);
  try {
    native.setMicrophone(true);
    native.start({ runId: 'words', bpm: 120, countInBars: 0, startBar: 1, endBar: 6 });
    until(2, 3);
    advance(.72);
    edge(1);
    assert.deepEqual(native.state().recording, { id: 'R2', status: 'armed' });
    advance(.42);
    assert.equal(native.compiledTake(0).frames, 0, 'holding through the guide leaves capture armed');
    const firstStart = frame();
    edge(0);
    assert.deepEqual(native.state().recording, { id: 'R2', status: 'recording' });
    advance(1.02, .15);
    foreignEdge(1, 1); foreignEdge(2, 0);
    assert.equal(native.compiledTake(0).ready, false, 'another binding cannot cut this source');
    const firstFrames = frame() - firstStart;
    edge(1);
    assert.equal(native.compiledTake(0).frames, firstFrames, 'the cut follows the physical press');
    assert.deepEqual(native.state().recording, { id: 'R2', status: 'armed' });
    advance(.18);
    const secondStart = frame();
    edge(0);
    advance(1.08, .27);
    assert.equal(native.compiledTake(1).ready, false, 'passing the beat-2 guide does not commit');
    const secondFrames = frame() - secondStart;
    edge(1); edge(0);
    assert.equal(native.state().recording, null);
    assert.equal(native.compiledTake(1).frames, secondFrames);
    assert.notEqual(firstFrames, secondFrames);

    const tap = () => { edge(1); edge(0); };
    const hears = (level: number) => render(64).some(sample => Math.abs(sample - level) < .001);
    until(4, 3); advance(.70);
    tap();
    assert(hears(0), 'a press earlier than a quarter beat cannot play the first word');
    advance(.10);
    tap();
    assert(hears(.15), 'a press inside the early window plays the first word');
    tap();
    assert(hears(.15), 'another press in the first window plays neither word again');
    until(4, 4); advance(.50);
    tap();
    assert(hears(.15), 'a press between windows does not advance to the second word');
    advance(.27);
    tap();
    assert(hears(.42), 'the second word starts near its own beat while the first is sounding');
    until(5, 2); advance(.30);
    tap();
    assert(hears(0), 'a press more than a quarter beat late misses the first word of 2/3');
    until(5, 3); advance(.22);
    tap();
    assert(hears(.27), 'the second word stays on beat 3 even when beat 2 was missed');
    until(6, 2); advance(.80);
    tap();
    assert(hears(.15), 'an unpaired word hit has the same quarter-beat tolerance');
    assert.deepEqual(faults, []);
  } finally { native.dispose(); }
});

test('retiring the input cancels an armed or in-flight word without publishing it', async () => {
  const song = await compiledFixture(), native = engine(encodeCompiledProgram(song), 48000);
  const { until, render } = runAudio(native, 48000);
  const first = physical(native, 1);
  try {
    native.setMicrophone(true);
    native.start({ runId: 'words', bpm: 120, countInBars: 0, startBar: 1, endBar: 6 });
    until(2, 4);
    first.edge(1);
    assert.equal(native.state().recording?.status, 'armed');
    first.revoke();
    assert.equal(native.state().recording, null, 'retiring a held input does not release it musically');
    assert.equal(native.compiledTake(0).ready, false);
    const second = physical(native, 2);
    second.edge(1); second.edge(0);
    render(1200, .3);
    second.revoke();
    assert.equal(native.state().recording, null);
    assert.equal(native.compiledTake(0).ready, false);
  } finally { native.dispose(); }
});

for (const cancellation of ['stop', 'microphone loss', 'mushroom', 'deadline'] as const) {
  test(`a ${cancellation} cancels the unfinished second word and retains the first`, async () => {
    const song = await compiledFixture(), native = engine(encodeCompiledProgram(song), 48000);
    const { until, render } = runAudio(native, 48000);
    const { edge } = physical(native, 1);
    try {
      native.setMicrophone(true);
      native.start({ runId: 'words', bpm: 120, countInBars: 0, startBar: 1, endBar: 6 });
      until(2, 4);
      edge(1); edge(0);
      render(1200, .3);
      edge(1); edge(0);
      render(1200, .4);
      assert.equal(native.compiledTake(0).ready, true);
      if (cancellation === 'stop') native.stop();
      else if (cancellation === 'microphone loss') native.setMicrophone(false);
      else if (cancellation === 'mushroom') edge(1, 5);
      else until(4, 1, .4);
      assert.equal(native.state().recording, null);
      assert.equal(native.compiledTake(0).frames, 1200);
      assert.equal(native.compiledTake(1).ready, false);
    } finally { native.dispose(); }
  });
}

test('a release arm with a missing second store cannot compile into a runnable chart', async () => {
  const invalidSource = structuredClone(source);
  invalidSource.values[5][4] = '1cx(drunk)+1ru(girls)';
  const compiled = await compileSheetsSong(invalidSource, mapping);
  assert.equal(compiled.executable, false);
  assert(compiled.diagnostics.some(problem => problem.severity === 'error' && problem.source.a1 === 'E6'));
});
