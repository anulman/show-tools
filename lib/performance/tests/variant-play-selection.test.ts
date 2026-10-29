import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSong } from '../compiled-song.js';
import type { SongMapping, CompiledSong } from '../compiled-song.js';
import type { SongSource } from '../song-source.js';
import dycSource from '../../../songs/dance-yrself-clean.source.json';
import dycMapping from '../../../songs/dance-yrself-clean.mapping.json';

function fixture(retention: 'variant' | 'layer'): { source: SongSource; mapping: SongMapping } {
  const values = Array.from({ length: 24 }, () => Array<string>(10).fill(''));
  values[0][1] = 'Play selection fixture'; values[1][5] = '120'; values[3][2] = 'A';
  values[4] = ['Bar', '', '1', '2', '3', '4', '5', '6', '7', '8'];
  values[17][1] = 'rb'; values[17][2] = 'crb'; values[17][3] = 'cb';
  values[17][5] = 'p'; values[17][6] = 'pb'; values[17][8] = '2pe';
  values[9] = retention === 'variant'
    ? ['', '', '1', '2', '', "1'", "2'", "1'", "1'", '']
    : ['', '', '-', '-', '', "-'", "-'", "-'", "-'", ''];
  return {
    source: { sourceVersion: 1, spreadsheetId: 'abcdefghijklmnopqrstuv', sheetId: 101, sheetName: 'Fixture', range: 'A1:J24', values,
      notes: { A18: 'Voice', A19: 'Other two', A20: 'Other one', A21: 'Other three' } },
    mapping: {
      mappingVersion: 4, notationVersion: 'dyc-v1', songId: 'play-selection', spreadsheetId: 'abcdefghijklmnopqrstuv',
      sheetId: 101, sheetName: 'Fixture', titleCell: 'B1', bpmCell: 'F2', sectionRow: 4, barRow: 5, leadInColumn: 2,
      startBar: 1, endBar: 8, meter: { numerator: 4, denominator: 4 },
      controls: [
        { buttonId: 'R1', voiceId: 'voice', cueRow: 18, arrangementRow: 10, nameNoteCell: 'A18' },
        { buttonId: 'R2', voiceId: 'other-two', cueRow: 19, arrangementRow: 11, nameNoteCell: 'A19' },
        { buttonId: 'L1', voiceId: 'other-one', cueRow: 20, arrangementRow: 13, nameNoteCell: 'A20' },
        { buttonId: 'L2', voiceId: 'other-three', cueRow: 21, arrangementRow: 12, nameNoteCell: 'A21' },
      ],
      liveParts: [], cueWindow: { earlyMs: 25, lateMs: 25, ties: 'reject' },
      capturePolicies: [{ voiceId: 'voice', retention, gain: 1 }],
      layerGroups: retention === 'layer' ? [{ id: 'layers', voiceId: 'voice', armCells: ['B18', 'C18'] }] : [],
      variantRules: retention === 'variant' ? [{ voiceId: 'voice', row: 10, fromBar: 3, sampledOnly: true }] : [],
      overrides: [], deferredRows: [],
    },
  };
}

function selectedTakeIds(song: CompiledSong, a1: string): readonly string[] {
  const cue = song.cues.find(cue => cue.source.a1 === a1);
  assert(cue, a1);
  assert.equal(cue.kind, 'play');
  const selection = song.selections.find(selection => selection.id === cue.selectionId);
  assert(selection, a1);
  return selection.takeIds;
}

test('DYC manual play cues resume the written Cowbell variant rather than the last capture', async () => {
  const values = dycSource.values.map(row => [...row]);
  for (const column of [21, 37, 53, 61]) values[18][column] = 'p';
  const song = await compileSong({ ...dycSource, values }, dycMapping);
  assert(song.executable, JSON.stringify(song.diagnostics));
  for (const a1 of ['V19', 'AL19', 'BB19', 'BJ19']) {
    const cue = song.cues.find(cue => cue.source.a1 === a1);
    assert(cue, a1);
    const bar = cue.execution.kind === 'next-bar' ? cue.bar + 1 : cue.bar;
    const written = song.playback.find(playback => playback.voiceId === cue.voiceId && playback.bar === bar);
    assert(written, a1);
    assert.equal(cue.selectionId, written.selectionId, `${a1} resumes the phrase written at bar ${bar}`);
  }
});

test('now and beat play cues use the current bar while next-bar play uses its execution bar', async () => {
  const input = fixture('variant');
  const song = await compileSong(input.source, input.mapping);
  assert(song.executable, JSON.stringify(song.diagnostics));
  const first = song.takes[0];
  assert(first);
  for (const a1 of ['F18', 'G18', 'I18']) assert.deepEqual(selectedTakeIds(song, a1), [first.id], a1);
  const nextBar = song.cues.find(cue => cue.source.a1 === 'G18');
  assert.equal(nextBar?.bar, 5);
  assert.equal(song.playback.find(playback => playback.bar === 5)?.selectionId, 'voice/selection-2');
  assert.equal(nextBar?.execution.kind, 'next-bar');
});

test('play cues without a written variant preserve the latest cumulative layered selection', async () => {
  const input = fixture('layer');
  const song = await compileSong(input.source, input.mapping);
  assert(song.executable, JSON.stringify(song.diagnostics));
  assert.equal(song.playback.length, 0);
  const both = song.takes.map(take => take.id);
  assert.equal(both.length, 2);
  for (const a1 of ['F18', 'G18', 'I18']) assert.deepEqual(selectedTakeIds(song, a1), both, a1);
});

test('written variants still reject a take whose capture has not committed', async () => {
  const input = fixture('variant');
  const values = input.source.values.map(row => [...row]);
  values[9][3] = "2'";
  const mapping = { ...input.mapping, variantRules: input.mapping.variantRules.map(rule => ({ ...rule, fromBar: 2 })) };
  const song = await compileSong({ ...input.source, values }, mapping);
  assert.equal(song.executable, false);
  assert(song.diagnostics.some(diagnostic => diagnostic.code === 'unknown-variant' && diagnostic.source.a1 === 'D10'));
  assert(!song.playback.some(playback => playback.voiceId === 'voice' && playback.bar === 2));
});
