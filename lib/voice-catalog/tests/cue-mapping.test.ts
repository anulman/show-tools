import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCatalogCueRows } from '../cue-mapping.js';
import { compileSheetsSong, decodeSongMapping } from '../../performance/compiled-song.js';
import { parseSongSource } from '../../performance/song-source.js';
import { parseCatalogDocument } from '../model.js';
import sourceInput from '../../../songs/dance-yrself-clean.source.json';
import mappingInput from '../../../songs/dance-yrself-clean.mapping.json';

const source = parseSongSource(sourceInput), mapping = decodeSongMapping(mappingInput);
const document = parseCatalogDocument({ version: 2, revision: 0,
  voices: [{ id: 'drums', name: 'Drums', characterId: null, notes: '', avatarToken: 'neutral', effects: [] }],
  bindings: [{ spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, labelCell: 'A10', sourceLabel: 'AF - Drums & Claps', voiceId: 'drums', cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }],
});
test('saved cue rows feed compiler input while retaining button, voice and capture-policy identity', async () => {
  const next = applyCatalogCueRows(document, source, mapping);
  assert.equal(next.controls.find(control => control.buttonId === 'R1')?.cueRow, 19);
  assert.equal(next.controls.find(control => control.buttonId === 'R2')?.cueRow, 19);
  assert.equal(next.controls.find(control => control.buttonId === 'R1')?.voiceId, 'drums-claps');
  assert.deepEqual(next.capturePolicies, mapping.capturePolicies);
  assert.equal(mapping.controls.find(control => control.buttonId === 'R1')?.cueRow, 18, 'existing mapping is immutable');
  const compiled = await compileSheetsSong(source, next);
  assert(compiled.cues.filter(cue => cue.voiceId === 'drums-claps').every(cue => /19$/.test(cue.source.a1)));
  assert(compiled.cues.some(cue => cue.voiceId === 'drums-claps'), 'compiler consumes the selected command row');
  // Existing compiler inspection remains responsible for related layer/variant policy consistency.
});
test('stale labels and worksheet mismatches stop compilation rather than applying another row', () => {
  assert.throws(() => applyCatalogCueRows(document, { ...source, sheetId: 999 }, mapping), /different worksheets/);
  for (const [cell, label] of [['A10', 'AF - Changed voice'], ['A19', 'Changed commands']]) {
    const values = source.values.map(row => [...row]); values[Number(cell.slice(1)) - 1][0] = label;
    assert.throws(() => applyCatalogCueRows(document, { ...source, values }, mapping), /changed/);
  }
  const otherSheet = { ...document, bindings: document.bindings.map(binding => ({ ...binding, sheetId: 999 })) };
  assert.equal(applyCatalogCueRows(otherSheet, source, mapping).controls.find(control => control.buttonId === 'R1')?.cueRow, 18);
});
test('a legacy unset cue connection preserves the loaded compiler mapping', () => {
  const unset = { ...document, bindings: document.bindings.map(binding => ({ ...binding, cueRow: null })) };
  assert.deepEqual(applyCatalogCueRows(unset, source, mapping), mapping);
});

test('rotation cue edits use the existing rotation mapping and never create a default-live control', () => {
  const backup = { ...document, bindings: document.bindings.map(binding => ({ ...binding, labelCell: 'A9', sourceLabel: 'AF - Backup Vocals' })) };
  assert.equal(applyCatalogCueRows(backup, source, mapping).rotationRule?.row, 19);
  const live = { ...document, bindings: document.bindings.map(binding => ({ ...binding, labelCell: 'A8', sourceLabel: 'AF - Vocals' })) };
  assert.throws(() => applyCatalogCueRows(live, source, mapping), /no command-row control/);
});
