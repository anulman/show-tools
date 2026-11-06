import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotSongVoices, mergeSongVoices } from '../song-snapshot.js';
import { discoverSheetVoices } from '../sheet-voices.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../../performance/musicxml-song.js';
import { musicXmlSourceView } from '../../performance/musicxml-source-view.js';
import { readFile } from 'node:fs/promises';
import { withVoice } from '../session.js';
import { parseCatalogDocument } from '../model.js';

const empty = parseCatalogDocument({ version: 2, revision: 0, voices: [], bindings: [] });
async function fixture() {
  const document = await readMusicXmlSong(await readFile('songs/dance-yrself-clean.musicxml', 'utf8'));
  return { document, rows: discoverSheetVoices(document.song, musicXmlSourceView(document)) };
}

test('song snapshots retain eight voices, effects and characters through MusicXML without archived Sheets data', async () => {
  const { document, rows } = await fixture();
  assert.equal(rows.length, 8);
  let snapshot = snapshotSongVoices(empty, rows, new Map());
  const voice = snapshot.voices[0];
  snapshot = withVoice(snapshot, { ...voice, characterId: 'test-character', effects: [{ kind: 'chorus', rateHz: 1, depthMs: 3, baseDelayMs: 20, wet: .3 }] });
  const xml = await writeMusicXmlSong({ song: document.song, report: document.report, voices: snapshot });
  const decoded = await readMusicXmlSong(xml);
  assert.equal(decoded.source, null);
  assert.deepEqual(decoded.voices, snapshot);
  assert.equal(discoverSheetVoices(decoded.song, musicXmlSourceView(decoded)).length, 8);
  assert.deepEqual(snapshotSongVoices(empty, rows, new Map()), snapshotSongVoices(empty, rows, new Map()));
});

test('loading song voices preserves unrelated library bindings and rejects other-song bindings', async () => {
  const { rows } = await fixture();
  const snapshot = snapshotSongVoices(empty, rows, new Map());
  const unrelated = parseCatalogDocument({ version: 2, revision: 7, voices: [{ ...snapshot.voices[0], id: 'unrelated', name: 'Other song' }],
    bindings: [{ ...snapshot.bindings[0], voiceId: 'unrelated', sheetId: 999 }] });
  const merged = mergeSongVoices(unrelated, snapshot, rows);
  assert.deepEqual(merged.voices.find(voice => voice.id === 'unrelated'), unrelated.voices[0]);
  assert.deepEqual(merged.bindings.find(binding => binding.sheetId === 999), unrelated.bindings[0]);
  assert.equal(merged.bindings.length, 9);
  assert.deepEqual(mergeSongVoices(merged, snapshot, rows), merged);
  assert.throws(() => mergeSongVoices(unrelated, unrelated, rows), /another song/);
});

test('song imports never overwrite a colliding voice used by another song', async () => {
  const { rows } = await fixture();
  const snapshot = snapshotSongVoices(empty, rows, new Map());
  const voice = { ...snapshot.voices[0], characterId: 'other-character' };
  const unrelated = parseCatalogDocument({ version: 2, revision: 0, voices: [voice],
    bindings: [{ ...snapshot.bindings.find(binding => binding.voiceId === voice.id), voiceId: voice.id, sheetId: 999 }] });
  const exported = snapshotSongVoices(unrelated, rows, new Map());
  assert.ok(exported.voices.every(item => item.id !== voice.id), 'Exported defaults avoid unrelated reserved identities.');
  const merged = mergeSongVoices(unrelated, snapshot, rows);
  assert.deepEqual(merged.voices.find(item => item.id === voice.id), voice);
  assert.deepEqual(mergeSongVoices(merged, snapshot, rows), merged);
});
