import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeInputAttach, decodeInputBindings, decodeInputEvent, inputBindingRows,
  physicalControlLightId } from '../input-bindings.js';
import { readFile } from 'node:fs/promises';
import { compileSheetsSong, decodeCompiledSong, decodeSongMapping } from '../compiled-song.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { INPUT_PACKET_MAGIC } from '../model.js';
import { PF } from '../wasm-abi.js';
import { build } from 'esbuild';

const fixtureBindings = decodeInputBindings([
  { controlId: 'blue', target: { kind: 'cue-rows', rows: ['L1', 'R1'] } },
  { controlId: 'yellow', target: { kind: 'tempo' } },
  { controlId: 'mushroom', target: { kind: 'panic' } },
]);
async function canonicalFixture() {
  return readMusicXmlSong(await readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8'));
}

test('physical bindings stay unbound by default and lower only explicitly selected rows', () => {
  assert.deepEqual(inputBindingRows(decodeInputBindings([])), []);
  const bindings = decodeInputBindings([
    { controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1', 'L1'] } },
    { controlId: 'yellow', target: { kind: 'tempo' } },
  ]);
  assert.deepEqual(inputBindingRows(bindings), [[0, 0, 5], [1, 1, 0]]);
  assert.equal(physicalControlLightId('blue'), 257);
  assert.equal(physicalControlLightId('yellow'), 258);
});

test('duplicate IDs, row aliases and host facts cannot become canonical musical bindings', () => {
  const one = { controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1'] } };
  for (const bindings of [
    [one, one], [one, { ...one, controlId: 'yellow' }],
    [{ ...one, target: { kind: 'cue-rows', rows: [] } }],
    [{ ...one, target: { kind: 'cue-rows', rows: ['R1', 'R1'] } }],
    [{ ...one, keyCode: 1 }], [{ ...one, sdkChannel: 0 }],
    [{ ...one, target: { kind: 'panic', rows: ['R1'] } }],
  ]) assert.throws(() => decodeInputBindings(bindings));
});

test('initial masks reject contradictory state and axis bits while sequence numbers may jump', () => {
  const attach = { producer: 0, session: 1, bindingGeneration: 1, kind: 'physical', releasedMask: 3, heldMask: 0 };
  assert.equal(decodeInputAttach(attach).releasedMask, 3);
  assert.throws(() => decodeInputAttach({ ...attach, heldMask: 1 }));
  assert.throws(() => decodeInputAttach({ ...attach, releasedMask: 64 }));
  assert.throws(() => decodeInputAttach({ ...attach, kind: 'keyboard', releasedMask: 32 }));
  for (const sequence of [1, 100]) assert.equal(decodeInputEvent({ producer: 0, session: 1,
    bindingGeneration: 1, sequence, input: 0, value: 1 }).sequence, sequence);
  assert.throws(() => decodeInputEvent({ producer: 0, session: 1, bindingGeneration: 1, sequence: 0, input: 0, value: 1 }));
});

test('explicit input bindings survive archive-free MusicXML and change its semantic digest', async () => {
  const original = await canonicalFixture();
  assert.equal(original.song.inputBindings, undefined);
  const song = decodeCompiledSong({ ...original.song, inputBindings: fixtureBindings });
  const xml = await writeMusicXmlSong({ song, report: original.report });
  const restored = await readMusicXmlSong(xml);
  assert.equal(restored.source, null);
  assert.equal(restored.mapping, null);
  assert.deepEqual(restored.song.inputBindings, fixtureBindings);
  assert.notEqual(restored.song.source.digest, original.song.source.digest);
  assert.equal(await writeMusicXmlSong({ song: restored.song, report: restored.report }), xml);
  const changed = await readMusicXmlSong(await writeMusicXmlSong({ report: restored.report,
    song: { ...restored.song, inputBindings: decodeInputBindings([{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1'] } }]) } }));
  assert.notEqual(changed.song.source.digest, restored.song.source.digest);
  const unbound = await readMusicXmlSong(await writeMusicXmlSong({ song: { ...original.song, inputBindings: [] }, report: original.report }));
  assert.deepEqual(unbound.song.inputBindings, []);
  const forbidden = { ...song, inputBindings: [{ ...fixtureBindings[0], sdkChannel: 0 }] };
  await assert.rejects(writeMusicXmlSong({ song: forbidden, report: original.report }));
});

test('native packet seven carries only explicit physical targets after existing extensions', async () => {
  const { song } = await canonicalFixture();
  const absent = encodeCompiledProgram(song);
  assert.equal(absent.includes(INPUT_PACKET_MAGIC), false);
  const empty = encodeCompiledProgram({ ...song, inputBindings: [] });
  const bound = encodeCompiledProgram({ ...song, inputBindings: fixtureBindings });
  assert.equal(empty[1], PF.COMPILED_VERSION);
  assert.equal(bound[1], PF.COMPILED_VERSION);
  assert.deepEqual([...empty.slice(-2)], [INPUT_PACKET_MAGIC, 0]);
  assert.deepEqual([...bound.slice(-11)], [INPUT_PACKET_MAGIC, 3, 0, 0, 5, 1, 1, 0, 5, 2, 0]);
  assert.deepEqual([...bound.slice(0, -11)], [...empty.slice(0, -2)]);
  const duplicate = { ...song, inputBindings: [fixtureBindings[0], fixtureBindings[0]] };
  assert.throws(() => encodeCompiledProgram(duplicate));
});

test('Sheets mapping preserves musical bindings and rejects installation facts or row aliases', async () => {
  const [sourceText, mappingText] = await Promise.all(['source', 'cutover.mapping'].map(suffix =>
    readFile(new URL(`../../../songs/dance-yrself-clean.${suffix}.json`, import.meta.url), 'utf8')));
  const source: unknown = JSON.parse(sourceText);
  const mapping = decodeSongMapping(JSON.parse(mappingText));
  assert.equal((await compileSheetsSong(source, mapping)).inputBindings, undefined);
  const bound = await compileSheetsSong(source, { ...mapping, inputBindings: fixtureBindings });
  assert.deepEqual(bound.inputBindings, fixtureBindings);
  for (const inputBindings of [
    [{ ...fixtureBindings[0], sdkChannel: 0 }],
    [{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1'] } }, { controlId: 'yellow', target: { kind: 'cue-rows', rows: ['R1'] } }],
  ]) assert.throws(() => decodeSongMapping({ ...mapping, inputBindings }));
  assert.throws(() => decodeCompiledSong({ ...bound, inputBindings: [{ ...fixtureBindings[0], rawCode: 15 }] }));
});

test('worklet input registry bundles without the Effect runtime', async () => {
  const result = await build({ entryPoints: [new URL('../model.ts', import.meta.url).pathname], bundle: true,
    write: false, metafile: true, platform: 'browser', format: 'esm' });
  assert.equal(Object.keys(result.metafile.inputs).some(path => /node_modules\/effect\//.test(path)), false);
});
