import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { readMusicXmlSong } from '../../lib/performance/musicxml-song.js';
import { rehearsalMusicXml } from '../../songs/rehearsal.js';
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
    const chorus = { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: 1 };
    const expected = (backup: boolean) => Array.from({ length: 6 }, (_, profile) => ({
      profile, effects: profile === 4 ? [slap] : profile === 5 && backup ? [{ ...slap, wet: 1 }, chorus] : [],
    }));
    assert.deepEqual(profiles('dance-yrself-clean'), expected(true));
    assert.deepEqual(profiles('drunk-girls'), expected(false));
    assert.deepEqual(profiles('tribulations'), expected(false));
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('rehearsal catalog promotes timing-only Daft Punk and All I Want and preserves installed executable charts', async () => {
  const f = await fixture();
  try {
    const firstFour = [...f.spec.songs, { id: 'i-can-change', musicXml: resolve('songs/i-can-change.musicxml'), effects: f.effects }];
    const canonical = resolve('songs/all-i-want.musicxml');
    const document = await readMusicXmlSong(await readFile(canonical, 'utf8'));
    const rehearsal = join(f.directory, 'old-all-i-want.musicxml');
    await writeFile(rehearsal, await rehearsalMusicXml({ ...document, song: { ...document.song, executable: false } }));
    const daftPunk = resolve('songs/daft-punk.musicxml');
    const daftPunkDocument = await readMusicXmlSong(await readFile(daftPunk, 'utf8'));
    const daftPunkRehearsal = join(f.directory, 'old-daft-punk.musicxml');
    await writeFile(daftPunkRehearsal, await rehearsalMusicXml({ ...daftPunkDocument, song: { ...daftPunkDocument.song, executable: false } }));
    const four = join(f.directory, 'four');
    await buildSongCatalog({ ...f.spec, songs: firstFour }, four);
    const build = promisify(execFile);
    const upgrade = async (base: string, name: string) => {
      const out = join(f.directory, name);
      await build(process.execPath, ['--import', 'tsx', 'scripts/build-rehearsal-catalog.ts', '--base', base, '--out', out]);
      const { catalog, files } = await readSongCatalog(out);
      assert.equal(catalog.entries.length, 7);
      return { out, files };
    };
    const installed = await upgrade(four, 'installed');
    const allIWant = (files: Map<string, Buffer>) => files.get('songs/all-i-want/source.musicxml');
    const effects = (files: Map<string, Buffer>) => files.get('songs/all-i-want/effects.json');
    assert.deepEqual(allIWant(installed.files), await readFile(canonical));
    assert.deepEqual(installed.files.get('songs/daft-punk/source.musicxml'), await readFile(daftPunk));
    const prior = await readSongCatalog(installed.out);
    const specs = prior.catalog.entries.map(entry => ({ id: entry.id,
      musicXml: entry.id === 'all-i-want' ? rehearsal : entry.id === 'daft-punk' ? daftPunkRehearsal : join(installed.out, entry.path, 'source.musicxml'),
      effects: join(installed.out, entry.path, 'effects.json'),
    }));
    const legacy = join(f.directory, 'legacy');
    await buildSongCatalog({ ...f.spec, songs: specs }, legacy);
    const upgraded = await upgrade(legacy, 'upgraded');
    assert.deepEqual(allIWant(upgraded.files), allIWant(installed.files));
    assert.deepEqual(effects(upgraded.files), effects(installed.files));
    for (const entry of prior.catalog.entries.filter(entry => entry.id !== 'all-i-want')) {
      assert.deepEqual(upgraded.files.get(`${entry.path}/source.musicxml`), installed.files.get(`${entry.path}/source.musicxml`));
      assert.deepEqual(upgraded.files.get(`${entry.path}/effects.json`), installed.files.get(`${entry.path}/effects.json`));
    }
    const authored = join(f.directory, 'authored');
    await buildSongCatalog({ ...f.spec, songs: specs.map(spec => spec.id === 'all-i-want' ? { ...spec, musicXml: canonical, effects: f.effects } : spec) }, authored);
    assert.deepEqual(effects((await upgrade(authored, 'preserved')).files), f.dry);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
