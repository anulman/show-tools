import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { exportMusicXmlWithVoices } from '../musicxml-authoring.js';
import { musicXmlSourceView } from '../musicxml-source-view.js';
import { parseCatalogDocument } from '../../voice-catalog/model.js';

const voices = parseCatalogDocument({ version: 2, revision: 0, voices: [{ id: 'v', name: 'Voice', notes: '', characterId: 'saved-character', avatarToken: 'neutral', effects: [] }], bindings: [] });

test('staged MusicXML keeps its saved voices until that exact document is loaded for editing', async () => {
  const document = await readMusicXmlSong(await readFile('songs/dance-yrself-clean.musicxml', 'utf8'));
  const xml = await writeMusicXmlSong({ song: document.song, report: document.report, voices });
  const original = await readMusicXmlSong(xml);
  let reads = 0;
  const snapshot = async () => { reads++; return { ...voices, voices: [{ ...voices.voices[0], characterId: 'local-edit' }] }; };
  assert.equal(await exportMusicXmlWithVoices(xml, undefined, snapshot), xml);
  assert.equal(reads, 0);
  const edited = await exportMusicXmlWithVoices(xml, original.song.source.digest, snapshot);
  assert.equal(reads, 1);
  assert.equal((await readMusicXmlSong(edited)).voices?.voices[0].characterId, 'local-edit');
});

test('a source view rejects oversized provenance before allocating dense worksheet rows', async () => {
  const document = await readMusicXmlSong(await readFile('songs/dance-yrself-clean.musicxml', 'utf8'));
  const report = { ...document.report, parts: [{ ...document.report.parts[0], labelCell: 'A999999999' }] };
  assert.throws(() => musicXmlSourceView({ ...document, report }), /coordinate range/);
});
