import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildSongCatalog, readSongCatalog } from '../build-song-catalog.js';

const songIds = ['dance-yrself-clean', 'drunk-girls', 'tribulations'];
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'song-catalog-test-'));
  const effects = join(directory, 'explicit-test-effects.json');
  const dry = Buffer.from(JSON.stringify(Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }))));
  await writeFile(effects, dry);
  const spec = { schemaVersion: 1, initialSongId: songIds[0], songs: songIds.map(id => ({ id, musicXml: resolve('songs', `${id}.musicxml`), effects })) };
  return { directory, effects, dry, spec, output: join(directory, 'catalog') };
}

test('canonical MusicXML roundtrip, all three native packages, and exact source/effects bytes', async () => {
  const f = await fixture();
  try {
    await buildSongCatalog(f.spec, f.output);
    const first = await readSongCatalog(f.output);
    assert.equal(first.catalog.entries.length, 3);
    for (const id of songIds) {
      assert.deepEqual(first.files.get(`songs/${id}/effects.json`), f.dry);
      assert.deepEqual(first.files.get(`songs/${id}/source.musicxml`), await readFile(resolve('songs', `${id}.musicxml`)));
    }
    const second = join(f.directory, 'second');
    await buildSongCatalog(f.spec, second);
    assert.deepEqual((await readSongCatalog(second)).files, first.files);
    await assert.rejects(buildSongCatalog(f.spec, f.output), /already exists/);
    assert.deepEqual((await readSongCatalog(f.output)).files, first.files);
    const catalog = JSON.parse((await readFile(join(f.output, 'catalog.json'))).toString());
    catalog.entries[0].path = '../outside';
    await writeFile(join(f.output, 'catalog.json'), JSON.stringify(catalog));
    await assert.rejects(readSongCatalog(f.output), /unsafe catalog path/);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('duplicate IDs, mismatched identities, unsafe IDs and invalid effects paths fail closed', async () => {
  const f = await fixture();
  try {
    const only = f.spec.songs[0]!;
    await assert.rejects(buildSongCatalog({ ...f.spec, songs: [only, only] }, f.output), /Duplicate/);
    await assert.rejects(buildSongCatalog({ ...f.spec, songs: [{ ...only, id: '../escape' }] }, f.output));
    await assert.rejects(buildSongCatalog({ ...f.spec, songs: [{ ...only, id: 'other' }] }, f.output), /identity mismatch/);
    await assert.rejects(buildSongCatalog({ ...f.spec, songs: [{ ...only, effects: 'missing-file' }] }, f.output));
    await assert.rejects(readFile(join(f.output, 'catalog.json')), { code: 'ENOENT' });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('omitting a song effects file packages the named vocal defaults', async () => {
  const f = await fixture();
  try {
    await buildSongCatalog({ ...f.spec, songs: f.spec.songs.map(({ id, musicXml }) => ({ id, musicXml })) }, f.output);
    const { files } = await readSongCatalog(f.output);
    const profiles = (id: string) => JSON.parse(files.get(`songs/${id}/effects.json`)!.toString());
    const slap = { kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 };
    const chorus = { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 };
    const expected = (backup: boolean) => Array.from({ length: 6 }, (_, profile) => ({
      profile, effects: profile === 4 ? [slap] : profile === 5 && backup ? [slap, chorus] : [],
    }));
    assert.deepEqual(profiles('dance-yrself-clean'), expected(true));
    assert.deepEqual(profiles('drunk-girls'), expected(false));
    assert.deepEqual(profiles('tribulations'), expected(false));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
