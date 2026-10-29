import test from 'node:test';
import assert from 'node:assert/strict';
import type { CatalogDocument, Voice } from '../model.js';
import type { SheetVoiceRow } from '../sheet-voices.js';
import { sheetVoiceKey } from '../sheet-voices.js';
import { reconcileCatalog, resolveVoice, withVoice } from '../session.js';

const empty: CatalogDocument = { version: 1, revision: 7, voices: [], bindings: [] };
function row(labelCell: string, sourceLabel: string, other: Partial<SheetVoiceRow> = {}): SheetVoiceRow {
  const value = { spreadsheetId: 'spreadsheet-one', sheetId: 101, sheetName: 'Song one', labelCell, sourceLabel,
    name: sourceLabel.replace(/^AF\s*-\s*/, ''), managed: true, profile: null, partId: null, cues: [], ...other };
  return { ...value, key: sheetVoiceKey(value) };
}
function ids() { let index = 0; return () => `voice-${++index}`; }
const defaults: ReadonlyMap<number, Voice['effects']> = new Map([
  [4, [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]],
]);

test('reconciliation seeds separate stable voices, applies only explicitly mapped profile defaults and never assigns characters', () => {
  const rows = [row('A8', 'AF - Vocals', { profile: 4, partId: 'vocals' }), row('A14', 'Bass', { managed: false }), row('A16', 'AF - Another voice')];
  const saved = reconcileCatalog(empty, rows, defaults, ids());
  assert.equal(saved.voices.length, 3); assert.equal(saved.bindings.length, 3); assert.equal(saved.revision, 7);
  assert(saved.voices.every(voice => voice.characterId === null && voice.avatarToken === 'neutral' && voice.notes === ''));
  assert.deepEqual(resolveVoice(saved, rows[0])?.effects, defaults.get(4));
  assert.deepEqual(resolveVoice(saved, rows[1])?.effects, []); assert.deepEqual(resolveVoice(saved, rows[2])?.effects, []);
  assert.notEqual(resolveVoice(saved, rows[0])?.effects, defaults.get(4));
  assert.equal(reconcileCatalog(saved, rows, defaults, () => { throw new Error('Existing bindings must not allocate new IDs'); }), saved);
  assert.deepEqual(empty, { version: 1, revision: 7, voices: [], bindings: [] });
});

test('changed source labels stay unresolved until an explicit binding replacement', () => {
  const original = row('A8', 'AF - Vocals', { profile: 4 });
  const saved = reconcileCatalog(empty, [original], defaults, ids());
  const changed = row('A8', 'AF - Harmony', { profile: 4 });
  assert.equal(reconcileCatalog(saved, [changed], defaults, () => { throw new Error('A stale label is not a new row'); }), saved);
  assert.equal(resolveVoice(saved, changed), undefined);
  const voice = saved.voices[0]; assert(voice);
  const updated = withVoice(saved, { ...voice, name: 'Harmony', effects: [] }, { ...saved.bindings[0], sourceLabel: changed.sourceLabel });
  assert.equal(updated.revision, saved.revision);
  assert.equal(resolveVoice(updated, changed)?.name, 'Harmony'); assert.deepEqual(resolveVoice(updated, changed)?.effects, []);
  assert.equal(resolveVoice(saved, changed), undefined); assert.equal(saved.voices[0].name, 'Vocals');
});

test('same names and rows in different worksheets never merge implicitly', () => {
  const rows = [row('A8', 'AF - Vocals'), row('A9', 'AF - Vocals'), row('A8', 'AF - Vocals', { sheetId: 102 })];
  const saved = reconcileCatalog(empty, rows, defaults, ids());
  assert.equal(new Set(saved.voices.map(voice => voice.id)).size, 3);
  assert.equal(new Set(rows.map(item => resolveVoice(saved, item)?.id)).size, 3);
});

test('a voice can be explicitly connected to another qualified row without deleting either voice', () => {
  const first = row('A8', 'AF - Vocals'), second = row('A9', 'AF - Backup Vocals');
  const saved = reconcileCatalog(empty, [first, second], defaults, ids());
  const voice = resolveVoice(saved, second); assert(voice);
  const binding = saved.bindings.find(item => item.labelCell === first.labelCell); assert(binding);
  const rebound = withVoice(saved, voice, { ...binding, voiceId: voice.id });
  assert.equal(rebound.voices.length, 2); assert.equal(rebound.bindings.length, 2);
  assert.equal(resolveVoice(rebound, first)?.id, voice.id); assert.equal(resolveVoice(rebound, second)?.id, voice.id);
  assert.notEqual(resolveVoice(saved, first)?.id, voice.id);
  assert.equal(withVoice(saved, saved.voices[0], saved.bindings[0]), saved, 'identical save preserves the document');
});

test('invalid IDs, graphs and binding references leave the original document untouched', () => {
  const rows = [row('A8', 'AF - Vocals'), row('A9', 'AF - Vocals')];
  assert.throws(() => reconcileCatalog(empty, rows, defaults, () => 'duplicate'), /unique identity/);
  const saved = reconcileCatalog(empty, rows, defaults, ids());
  const before = JSON.stringify(saved), voice = saved.voices[0]; assert(voice);
  assert.throws(() => withVoice(saved, voice, { ...saved.bindings[0], voiceId: 'other' }), /reference the saved voice/);
  assert.throws(() => withVoice(saved, { ...voice, effects: [{ kind: 'slapback', delayMs: 999, feedback: 0, wet: .25 }] }));
  assert.equal(JSON.stringify(saved), before); assert.equal(empty.voices.length, 0);
});
