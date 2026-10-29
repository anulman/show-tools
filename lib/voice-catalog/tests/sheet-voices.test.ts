import test from 'node:test';
import assert from 'node:assert/strict';
import { compileSong } from '../../performance/compiled-song.js';
import type { CompiledSong } from '../../performance/compiled-song.js';
import { parseSongSource } from '../../performance/song-source.js';
import type { SongSource } from '../../performance/song-source.js';
import sourceInput from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.mapping.json';
import { bindingMatches, discoverSheetVoices } from '../sheet-voices.js';

const source = parseSongSource(sourceInput);
const compiled = await compileSong(source, mapping);
function changed(change: (values: string[][]) => void): SongSource {
  const values = source.values.map(row => [...row]); change(values);
  return { ...source, values };
}

test('DYC discovers six source-managed voices plus Bass and Drums without native profile inference', () => {
  const rows = discoverSheetVoices(compiled, source);
  assert.deepEqual(rows.map(row => [row.labelCell, row.name, row.managed, row.profile]), [
    ['A8', 'Vocals', true, 4], ['A9', 'Backup Vocals', true, 5],
    ['A10', 'Drums & Claps', true, 2], ['A11', 'Cowbell', true, 3],
    ['A12', 'Bing Bong', true, 1], ['A13', 'Whistle', true, 0],
    ['A14', 'Bass', false, null], ['A15', 'Drums', false, null],
  ]);
  assert(rows.slice(0, 6).every(row => row.partId !== null));
  assert(rows.slice(6).every(row => row.partId === null));
  assert(!rows.some(row => ['Knob', 'R1', 'R2', 'L1', 'L2', 'Key', 'Meter', 'Start time', 'Local BPM'].includes(row.name)));
});

test('new AF labels are managed outside the original six and outside the reference voice block', () => {
  const extra = changed(values => { values[15][0] = ' AF - Drone '; values.push(['AF - Far voice']); });
  const rows = discoverSheetVoices(compiled, { ...extra, range: extra.range.replace(/\d+$/, String(extra.values.length)) });
  assert.equal(rows.length, 10);
  for (const name of ['Drone', 'Far voice']) {
    const row = rows.find(item => item.name === name); assert(row);
    assert.equal(row.managed, true); assert.equal(row.profile, null); assert.equal(row.partId, null);
  }
});

test('duplicate display names preserve distinct qualified cell identity and never borrow a profile by name', () => {
  const rows = discoverSheetVoices(compiled, changed(values => { values[13][0] = 'AF - Vocals'; }));
  const names = rows.filter(row => row.name === 'Vocals');
  assert.equal(names.length, 2); assert.notEqual(names[0].key, names[1].key);
  assert.equal(names[0].profile, 4); assert.equal(names[1].profile, null);
  assert.equal(names[1].labelCell, 'A14');
});

test('literal arrangement cues use native bar columns and source cell addresses', () => {
  const rows = discoverSheetVoices(compiled, source);
  const drums = rows.find(row => row.labelCell === 'A15'); assert(drums);
  assert.deepEqual(drums.cues.find(cue => cue.bar === 76), { bar: 76, text: '4e&a]', cell: 'BZ15' });
  assert.equal(drums.cues.find(cue => cue.bar === 1), undefined);
  const whistle = rows.find(row => row.labelCell === 'A13'); assert(whistle);
  assert.deepEqual(whistle.cues.find(cue => cue.bar === 45), { bar: 45, text: '-', cell: 'AU13' });
});

test('cropped source ranges preserve global label and cue coordinates', () => {
  const shifted: CompiledSong = { ...compiled,
    parts: compiled.parts.map(part => ({ ...part, source: { ...part.source, a1: part.source.a1.replace(/^A/, 'C') } })),
    chart: { ...compiled.chart, bars: compiled.chart.bars.map(bar => ({ ...bar, column: bar.column + 2 })) },
  };
  const cropped: SongSource = { ...source, range: 'C8:H15', values: source.values.slice(7, 15).map(row => row.slice(0, 6)) };
  const rows = discoverSheetVoices(shifted, cropped);
  assert.deepEqual(rows.map(row => row.labelCell), ['C8', 'C9', 'C10', 'C11', 'C12', 'C13', 'C14', 'C15']);
  assert.equal(rows[0].profile, 4);
  const drums = rows.find(row => row.labelCell === 'C10'); assert(drums);
  assert.deepEqual(drums.cues.find(cue => cue.bar === 1), { bar: 1, text: '-', cell: 'E10' });
});

test('bindings require exact source label and qualified worksheet/cell identity', () => {
  const row = discoverSheetVoices(compiled, source)[0]; assert(row);
  const binding = { spreadsheetId: row.spreadsheetId, sheetId: row.sheetId, labelCell: row.labelCell, sourceLabel: row.sourceLabel };
  assert.equal(bindingMatches(row, binding), true);
  for (const change of [{ spreadsheetId: `${row.spreadsheetId}-other` }, { sheetId: row.sheetId + 1 },
    { labelCell: 'A9' }, { sourceLabel: 'AF - Renamed' }, { sourceLabel: `${row.sourceLabel} ` }]) {
    assert.equal(bindingMatches(row, { ...binding, ...change }), false);
  }
  const renamed = discoverSheetVoices(compiled, changed(values => { values[7][0] = 'AF - Renamed'; }))[0]; assert(renamed);
  assert.equal(renamed.key, row.key); assert.equal(bindingMatches(renamed, binding), false);
});

test('compiled-only discovery exposes known source parts with no fabricated arrangement cues', () => {
  const rows = discoverSheetVoices(compiled);
  assert.equal(rows.length, 6); assert(rows.every(row => row.managed && row.cues.length === 0));
  assert.deepEqual(rows.map(row => row.partId), compiled.parts.map(part => part.id));
  assert.throws(() => discoverSheetVoices(compiled, { ...source, sheetId: source.sheetId + 1 }), /different worksheet/);
});

test('command row discovery follows exact compiled voice IDs rather than voice names', async () => {
  const { discoverCueRows, loadedCommandRows } = await import('../sheet-voices.js');
  const candidates = discoverCueRows(compiled, source);
  assert(candidates.some(row => row.labelCell === 'A18' && row.sourceLabel === 'R1'));
  assert(candidates.some(row => row.labelCell === 'A17' && row.sourceLabel === 'Knob'));
  assert(!candidates.some(row => ['B1', 'A31', 'A44', 'A45'].includes(row.labelCell)), 'title, parts table and legend are not chart command rows');
  assert.deepEqual(loadedCommandRows(compiled, 'drums-claps'), [18]);
  assert.deepEqual(loadedCommandRows(compiled, 'whistle'), [20]);
  assert.deepEqual(loadedCommandRows(compiled, 'backup-vocals'), [17]);
  assert.deepEqual(loadedCommandRows(compiled, 'vocals'), []);
  assert.deepEqual(loadedCommandRows(compiled, 'Drums & Claps'), []);
  assert.deepEqual(discoverCueRows(compiled), [], 'compiled-only input cannot fabricate source row labels');
  assert.throws(() => discoverCueRows(compiled, { ...source, sheetId: source.sheetId + 1 }));
});
