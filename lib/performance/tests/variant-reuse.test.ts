import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSheetsSong, decodeCompiledSong, inspectCompiledSong } from '../compiled-song.js';
import { encodeCompiledProgram } from '../compiled-native.js';
import { PF } from '../wasm-abi.js';
import source from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.mapping.json';

test('DYC shortened Cowbells reuse one prefix view and restore the full take in adjacent bars', async () => {
  const song = await compileSheetsSong(source, mapping);
  assert.equal(song.executable, true);
  const take = song.takes.find(take => song.cues.find(cue => cue.id === take.armCueId)?.source.a1 === 'CE19');
  assert(take);
  assert.deepEqual(take.begin, { bar: 82, beat: 0 });
  assert.deepEqual(take.captureEnd, { bar: 83, beat: 0 });
  assert.deepEqual(take.loopEnd, { bar: 83, beat: 0 });
  const shortened = song.selections.filter(selection => selection.window.kind === 'prefix');
  assert.equal(shortened.length, 1);
  assert.deepEqual(shortened[0].takeIds, [take.id]);
  assert.deepEqual(shortened[0].window, { kind: 'prefix', endCount: 3.5 });
  const selected = (bar: number) => song.selections.find(selection => selection.id === song.playback.find(play => play.bar === bar && play.voiceId === take.voiceId)?.selectionId);
  for (const bar of [96, 164]) assert.equal(selected(bar)?.id, shortened[0].id);
  for (const bar of [97, 165]) assert.equal(selected(bar)?.window.kind, 'full');
  assert.equal(song.takes.filter(take => take.voiceId === 'cowbell').length, 6);
  const commit = song.cues.find(cue => cue.id === take.commitCueId);
  assert.equal(song.selections.find(selection => selection.id === commit?.selectionId)?.window.kind, 'full');
  const table = encodeCompiledProgram(song);
  assert.deepEqual(Array.from(table.slice(-4)), [PF.COMPILED_WINDOW_MAGIC, 1, song.selections.indexOf(shortened[0]), 3.5]);
  assert.match(inspectCompiledSong(song), /SOURCE WINDOW.*0\.\.3\.5 counts, exclusive/);
});

test('retained-take reuses reject stale cells, wrong voices, unavailable sources, duplicate cells and invalid endpoints', async () => {
  const original = mapping.variantReuses[0];
  const cases = [
    { reuse: { ...original, notation: 'changed' }, code: 'stale-variant-reuse' },
    { reuse: { ...original, sourceArmCell: 'F21' }, code: 'variant-reuse-source' },
    { reuse: { ...original, sourceArmCell: 'missing' }, code: 'variant-reuse-source' },
    { reuse: { ...original, cell: 'C11', notation: source.values[10][2] }, code: 'variant-reuse-target' },
    ...[0, -1, 4, 4.5, 1 / 7].map(endCount => ({ reuse: { ...original, endCount }, code: 'variant-reuse-window' })),
  ];
  for (const { reuse, code } of cases) {
    const song = await compileSheetsSong(source, { ...mapping, variantReuses: [reuse, mapping.variantReuses[1]] });
    assert.equal(song.executable, false, JSON.stringify(reuse));
    assert(song.diagnostics.some(diagnostic => diagnostic.code === code), JSON.stringify(song.diagnostics));
  }
  const duplicate = await compileSheetsSong(source, { ...mapping, variantReuses: [...mapping.variantReuses, original] });
  assert(duplicate.diagnostics.some(diagnostic => diagnostic.code === 'duplicate-variant-reuse'));
  const early = await compileSheetsSong(source, { ...mapping, variantRules: mapping.variantRules.map(rule => ({ ...rule, fromBar: 1 })),
    variantReuses: [{ ...original, cell: 'V11', notation: source.values[10][21] }] });
  assert(early.diagnostics.some(diagnostic => diagnostic.code === 'variant-reuse-source'));
});

test('compiled imports require declared windows and reject forged prefix resources', async () => {
  const song = await compileSheetsSong(source, mapping);
  const prefixIndex = song.selections.findIndex(selection => selection.window.kind === 'prefix');
  const selections = (window: unknown) => song.selections.map((selection, index) => index === prefixIndex ? { ...selection, window } : selection);
  for (const endCount of [0, -1, 4, 1 / 7, Infinity]) {
    assert.throws(() => decodeCompiledSong({ ...song, selections: selections({ kind: 'prefix', endCount }) }));
  }
  assert.throws(() => decodeCompiledSong({ ...song, selections: selections(undefined) }));
  assert.throws(() => decodeCompiledSong({ ...song, schemaVersion: 4 }));
  await assert.rejects(() => compileSheetsSong(source, { ...mapping, mappingVersion: 4 }));
  const prefix = song.selections[prefixIndex];
  const take = song.takes.find(take => take.id === prefix.takeIds[0]);
  assert(take);
  assert.throws(() => decodeCompiledSong({ ...song, cues: song.cues.map(cue => cue.id === take.commitCueId ? { ...cue, selectionId: prefix.id } : cue) }), /capture graph/);
  assert.throws(() => decodeCompiledSong({ ...song, selections: song.selections.map((selection, index) => index === prefixIndex
    ? { ...prefix, takeIds: [prefix.takeIds[0], song.takes[0].id], gains: [1, 1] } : selection) }));
});
