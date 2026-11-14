import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCompiledSong } from '../compiled-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { terseCaptureInput } from './fixtures/terse-capture.js';

async function fixture() {
  const input = terseCaptureInput(); const imported = await importSheetMusicXml(input);
  const document = await readMusicXmlSong(imported.xml);
  const noteBanks = [{ buttonId: 'R2', toleranceMs: 25, notes: [{ slot: 0, at: { bar: 3, beat: 0 } }], capture: { profile: 0, slots: [0, 1, 2, 3, 4, 5, 6, 7] } }] satisfies NonNullable<typeof document.song.noteBanks>;
  return { ...document, song: decodeCompiledSong({ ...document.song, noteBanks }) };
}

test('source capture order roundtrips independently of chart melody order in standalone canonical XML', async () => {
  const document = await fixture();
  const xml = await writeMusicXmlSong({ song: document.song, report: document.report });
  const restored = await readMusicXmlSong(xml);
  assert.equal(restored.source, null);
  assert.deepEqual(restored.song.noteBanks, document.song.noteBanks);
  assert.deepEqual(restored.song.noteBanks?.[0].capture?.slots, [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(restored.song.noteBanks?.[0].notes.map(note => note.slot), [0]);
});

test('capture order rejects duplicate source slots, other bank ownership and external assets', async () => {
  const { song } = await fixture(); const bank = song.noteBanks?.[0]; assert(bank);
  for (const capture of [{ profile: 6, slots: [0] }, { profile: 0, slots: [0, 0] }, { profile: 0, slots: [0, 64] }, { profile: 0, slots: [1] }])
    assert.throws(() => decodeCompiledSong({ ...song, noteBanks: [{ ...bank, capture }] }), /capture order/);
  assert.throws(() => decodeCompiledSong({ ...song, noteBanks: [bank, { ...bank, buttonId: 'L1' }] }), /ownership/);
  assert.throws(() => decodeCompiledSong({ ...song, externalSamples: [{ slot: 1, voiceId: 'fixture-external', begin: { bar: 1, beat: 0 }, end: { bar: 3, beat: 0 } }] }), /ownership/);
});
