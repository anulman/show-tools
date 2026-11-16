import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Effect } from 'effect';
import { compileSheetsSong } from '../../performance/compiled-song.js';
import { compiledProgramBytes } from '../../performance/compiled-native.js';
import { terseCaptureInput } from '../../performance/tests/fixtures/terse-capture.js';
import { encodeInitialProfiles } from '../commands.js';
import { validateInstalledPackage } from '../prepare.js';
import { loadInstalledSongCatalog } from '../song-catalog.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const dryFixtureProfiles = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));

async function packageFixture(root: string, id: string, title = id) {
  const { source, mapping } = terseCaptureInput();
  const values = source.values.map((row, index) => index === 0 ? row.map((value, column) => column === 1 ? title : value) : row);
  const compiled = await compileSheetsSong({ ...source, values }, { ...mapping, songId: id });
  assert.equal(compiled.executable, true);
  const packet = Buffer.from(compiledProgramBytes(compiled));
  const effects = Buffer.from(JSON.stringify(dryFixtureProfiles));
  const manifest = Buffer.from(JSON.stringify({ id, description: 'Explicit synthetic catalog fixture', compiled,
    practice: { startBar: 1, endBar: compiled.chart.bars.length }, takeCount: compiled.takes.length,
    packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(dryFixtureProfiles)) }));
  const path = join(root, id);
  await mkdir(path);
  await Promise.all([writeFile(join(path, 'manifest.json'), manifest), writeFile(join(path, 'song.pfp'), packet),
    writeFile(join(path, 'effects.json'), effects)]);
  return { id, path, manifest, packet, effects };
}

test('loads every explicit installed package and preserves catalog order and chosen initial song', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packages = await Promise.all(['one', 'two', 'three'].map(id => packageFixture(root, id, `Title ${id}`)));
  const entries = packages.map(({ id, path }) => ({ id, path }));
  const catalog = await Effect.runPromise(loadInstalledSongCatalog({ entries, initialSongId: 'two' }));
  assert.deepEqual(catalog.choices.map(({ id, title }) => ({ id, title })), entries.map(({ id }) => ({ id, title: `Title ${id}` })));
  assert.equal(catalog.initialSongId, 'two');
  for (const fixture of packages) {
    const song = catalog.get(fixture.id);
    assert.deepEqual(song.hashes, { manifestSha256: hash(fixture.manifest), packetSha256: hash(fixture.packet), effectsSha256: hash(fixture.effects) });
    assert.deepEqual(song.installed, validateInstalledPackage(fixture.manifest, fixture.packet, dryFixtureProfiles));
    assert.match(song.packageDigest, /^[a-f0-9]{64}$/);
    assert.equal(catalog.choices.find(choice => choice.id === fixture.id)?.packageDigest, song.packageDigest);
    assert(Object.isFrozen(song));
    assert(Object.isFrozen(song.hashes));
  }
  assert.throws(() => catalog.get('missing'), /Unknown installed song ID/);
  assert(Object.isFrozen(catalog));
  assert(Object.isFrozen(catalog.choices));
  assert(catalog.choices.every(Object.isFrozen));
});

test('rejects invalid catalog configuration without falling back to an entry', async () => {
  const entry = { id: 'one', path: '/nonexistent/catalog' };
  for (const input of [
    { entries: [], initialSongId: 'one' },
    { entries: [entry, entry], initialSongId: 'one' },
    { entries: [entry], initialSongId: 'missing' },
    { entries: [{ ...entry, id: '' }], initialSongId: 'one' },
    { entries: [{ ...entry, path: 'relative' }], initialSongId: 'one' },
    { entries: [{ ...entry, path: '/invalid\0path' }], initialSongId: 'one' },
    { entries: [{ ...entry, unexpected: true }], initialSongId: 'one' },
    { entries: [entry], initialSongId: 'one', unexpected: true },
  ]) await assert.rejects(Effect.runPromise(loadInstalledSongCatalog(input)), /SongCatalogError/);
});

test('rejects a configured ID that contradicts the actual validated package', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await packageFixture(root, 'one');
  await assert.rejects(Effect.runPromise(loadInstalledSongCatalog({ entries: [{ id: 'another', path: fixture.path }], initialSongId: 'another' })),
    /Installed song ID mismatch: expected another, found one/);
});

test('a broken noninitial package prevents publishing the entire catalog', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const one = await packageFixture(root, 'one');
  const two = await packageFixture(root, 'two');
  const packet = Buffer.from(two.packet);
  packet[packet.length - 1] ^= 1;
  await writeFile(join(two.path, 'song.pfp'), packet);
  await assert.rejects(Effect.runPromise(loadInstalledSongCatalog({ entries: [one, two].map(({ id, path }) => ({ id, path })), initialSongId: 'one' })),
    /Package digest mismatch/);
});

test('missing or malformed effects are rejected rather than replaced with defaults', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await packageFixture(root, 'one');
  const options = { entries: [{ id: fixture.id, path: fixture.path }], initialSongId: fixture.id };
  await unlink(join(fixture.path, 'effects.json'));
  await assert.rejects(Effect.runPromise(loadInstalledSongCatalog(options)), /ENOENT/);
  await writeFile(join(fixture.path, 'effects.json'), 'not JSON');
  await assert.rejects(Effect.runPromise(loadInstalledSongCatalog(options)), /SongCatalogError/);
  await writeFile(join(fixture.path, 'effects.json'), '[]');
  await assert.rejects(Effect.runPromise(loadInstalledSongCatalog(options)), /SongCatalogError/);
});

test('digests bind exact effects and manifest bytes while prepared packages remain captured snapshots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-catalog-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await packageFixture(root, 'one');
  const options = { entries: [{ id: fixture.id, path: fixture.path }], initialSongId: fixture.id };
  const first = (await Effect.runPromise(loadInstalledSongCatalog(options))).get('one');
  const repeated = (await Effect.runPromise(loadInstalledSongCatalog(options))).get('one');
  assert.equal(first.packageDigest, repeated.packageDigest);
  const originalOperation = Buffer.from(first.installed.operation);
  const originalTitle = first.title;
  await writeFile(join(fixture.path, 'effects.json'), JSON.stringify(dryFixtureProfiles, null, 2));
  const effectsChanged = (await Effect.runPromise(loadInstalledSongCatalog(options))).get('one');
  assert.notEqual(effectsChanged.packageDigest, first.packageDigest);
  assert.notEqual(effectsChanged.hashes.effectsSha256, first.hashes.effectsSha256);
  assert.deepEqual(effectsChanged.installed.operation, originalOperation);
  await writeFile(join(fixture.path, 'manifest.json'), `${fixture.manifest.toString('utf8')}\n`);
  const manifestChanged = (await Effect.runPromise(loadInstalledSongCatalog(options))).get('one');
  assert.notEqual(manifestChanged.packageDigest, effectsChanged.packageDigest);
  assert.notEqual(manifestChanged.hashes.manifestSha256, first.hashes.manifestSha256);
  await unlink(join(fixture.path, 'song.pfp'));
  assert.deepEqual(first.installed.operation, originalOperation);
  assert.equal(first.title, originalTitle);
  assert.equal(first.hashes.packetSha256, hash(fixture.packet));
  assert.equal(first.paths.packet, join(await realpath(fixture.path), 'song.pfp'));
  assert.equal((await readFile(first.paths.effects)).equals(fixture.effects), false);
});
