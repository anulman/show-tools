import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { Effect } from 'effect';
import { decodeInputBindings } from '../../performance/input-bindings.js';
import { compiledProgramBytes } from '../../performance/compiled-native.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../../performance/musicxml-song.js';
import { importSheetMusicXml } from '../../performance/sheet-musicxml.js';
import { terseCaptureInput } from '../../performance/tests/fixtures/terse-capture.js';
import { externalWavFixture } from '../../performance/tests/fixtures/external-asset.js';
import { encodeInitialProfiles } from '../commands.js';
import { loadInstalledSongCatalog } from '../song-catalog.js';
import { prepareSongBindings, SongBindingAuthority, restoreSongBindingBackup, verifySongBindingBackup } from '../song-bindings.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bindings = decodeInputBindings([{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1', 'R2'] } },
  { controlId: 'pedal', target: { kind: 'tempo' } }, { controlId: 'mushroom', target: { kind: 'panic' } }]);

async function packageFixture(root: string, external = false) {
  const imported = await importSheetMusicXml(terseCaptureInput());
  const original = await readMusicXmlSong(imported.xml);
  const asset = externalWavFixture();
  const xml = await writeMusicXmlSong({ song: { ...original.song,
    ...(external ? { externalSamples: [{ slot: 0, voiceId: 'tambourine', begin: { bar: 2, beat: 0 }, end: { bar: 4, beat: 0 }, asset: asset.asset }] } : {}) },
    report: original.report, ...(original.source ? { source: original.source } : {}), ...(original.mapping ? { mapping: original.mapping } : {}),
    voices: { version: 2, revision: 1, voices: [{ id: 'fixture-voice', name: 'Fixture voice', notes: 'Preserve this authoring', characterId: 'fixture-avatar', avatarToken: 'blue',
      effects: [{ kind: 'chorus', rateHz: .5, depthMs: 3, baseDelayMs: 20, wet: .2 }] }], bindings: [] } });
  const document = await readMusicXmlSong(xml);
  const configurations = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: profile === 0 ? [{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .3 }] : [] }));
  const packet = Buffer.from(compiledProgramBytes(document.song));
  const effects = Buffer.from(JSON.stringify(configurations));
  const manifest = Buffer.from(JSON.stringify({ id: document.song.id, description: 'Qualified synthetic fixture', compiled: document.song,
    practice: { startBar: 1, endBar: 10 }, takeCount: document.song.takes.length,
    packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(configurations)) }));
  const path = join(root, 'package'); await mkdir(path);
  await Promise.all([writeFile(join(path, 'source.musicxml'), xml), writeFile(join(path, 'manifest.json'), manifest),
    writeFile(join(path, 'song.pfp'), packet), writeFile(join(path, 'effects.json'), effects)]);
  const catalog = await Effect.runPromise(loadInstalledSongCatalog({ entries: [{ id: document.song.id, path }], initialSongId: document.song.id }));
  return { entry: catalog.get(document.song.id), document, xml, effects, asset, path };
}

test('canonical preparation preserves notation, archive, voice metadata, effects and verified external WAVs', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await packageFixture(root, true);
  const result = await prepareSongBindings(fixture.entry, bindings);
  const canonical = await readMusicXmlSong(result.musicXml);
  assert.deepEqual(canonical.song.inputBindings, bindings);
  assert.deepEqual(canonical.source, fixture.document.source);
  assert.deepEqual(canonical.mapping, fixture.document.mapping);
  assert.deepEqual(canonical.voices, fixture.document.voices);
  assert.deepEqual(canonical.song.chart, fixture.document.song.chart);
  assert.equal(result.sourceDigest, fixture.document.song.source.digest);
  assert.notEqual(canonical.song.source.digest, result.sourceDigest);
  assert.deepEqual(result.effects, fixture.effects);
  assert.deepEqual(result.installed.song.compiled?.inputBindings, bindings);
  assert.equal(result.installed.assets.length, 1);
  assert.equal(result.installed.assets[0].readUInt16LE(), 15);
  assert.deepEqual(result.installed.assets[0].subarray(10), fixture.asset.bytes);
  assert.deepEqual(result.packet, Buffer.from(compiledProgramBytes(canonical.song)));
  const repeated = await prepareSongBindings(fixture.entry, bindings);
  assert.equal(repeated.musicXml, result.musicXml);
  assert.deepEqual(repeated.manifest, result.manifest);
  assert.equal(repeated.packageDigest, result.packageDigest);
});

test('real SQLite authority persists exact assignments and rejects a stale concurrent writer', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { entry } = await packageFixture(root);
  const path = join(root, 'authoring.sqlite');
  const first = SongBindingAuthority.open(path), second = SongBindingAuthority.open(path);
  try {
    assert.deepEqual(first.read(entry).bindings, []);
    assert.equal(first.read(entry).revision, 0);
    const candidate = await prepareSongBindings(entry, bindings);
    const saved = first.save(candidate, 0);
    assert.equal(saved.revision, 1);
    assert.deepEqual(second.read(entry), saved);
    assert.throws(() => second.save(candidate, 0), /changed; reload/);
    assert.equal(second.read(entry).revision, 1);
    const changed = await prepareSongBindings(entry, [{ controlId: 'yellow', target: { kind: 'cue-rows', rows: ['L1'] } }]);
    assert.equal(second.save(changed, 1).revision, 2);
    assert.deepEqual(first.read(entry).bindings, changed.bindings);
    assert.throws(() => first.save(changed, -1));
    assert.equal(first.read(entry).revision, 2);
  } finally { second.close(); first.close(); }
  const reopened = SongBindingAuthority.open(path);
  try { assert.equal(reopened.read(entry).revision, 2); } finally { reopened.close(); }
});

test('invalid or ambiguous assignments fail before any authored row changes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { entry } = await packageFixture(root);
  const authority = SongBindingAuthority.open(join(root, 'authoring.sqlite'));
  try {
    for (const input of [
      [{ controlId: 'unknown', target: { kind: 'tempo' } }],
      [{ controlId: 'blue', target: { kind: 'cue-rows', rows: [] } }],
      [{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1'] } }, { controlId: 'yellow', target: { kind: 'cue-rows', rows: ['R1'] } }],
      [{ controlId: 'blue', target: { kind: 'tempo' } }, { controlId: 'blue', target: { kind: 'panic' } }],
      [{ controlId: 'blue', target: { kind: 'tempo' }, inferred: true }],
    ]) await assert.rejects(prepareSongBindings(entry, input));
    assert.equal(authority.read(entry).revision, 0);
    const candidate = await prepareSongBindings(entry, bindings);
    assert.throws(() => authority.save({ ...candidate, bindings: [{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1', 'R1'] } }] }, 0));
    assert.equal(authority.read(entry).revision, 0);
  } finally { authority.close(); }
});

test('missing, changed or mismatched package source never silently rebases an authored chart', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const fixture = await packageFixture(root);
  const authority = SongBindingAuthority.open(join(root, 'authoring.sqlite'));
  try {
    await unlink(join(fixture.path, 'source.musicxml'));
    await assert.rejects(prepareSongBindings(fixture.entry, bindings), /ENOENT/);
    await writeFile(join(fixture.path, 'source.musicxml'), fixture.xml.replace('<work-title>Terse native fixture</work-title>', '<work-title>Changed chart</work-title>'));
    await assert.rejects(prepareSongBindings(fixture.entry, bindings), /does not match/);
    await writeFile(join(fixture.path, 'source.musicxml'), fixture.xml);
    await writeFile(join(fixture.path, 'effects.json'), JSON.stringify([]));
    await assert.rejects(prepareSongBindings(fixture.entry, bindings), /effects changed/);
    assert.equal(authority.read(fixture.entry).revision, 0);
    await writeFile(join(fixture.path, 'effects.json'), fixture.effects);
    const candidate = await prepareSongBindings(fixture.entry, bindings);
    authority.save(candidate, 0);
    const compiled = fixture.entry.installed.song.compiled;
    assert(compiled);
    const changedEntry = { ...fixture.entry, installed: { ...fixture.entry.installed, song: { ...fixture.entry.installed.song, compiled: { ...compiled, source: { ...compiled.source, digest: '0'.repeat(64) } } } } };
    assert.throws(() => authority.read(changedEntry), /another chart revision/);
    assert.throws(() => authority.save({ ...candidate, sourceDigest: '0'.repeat(64) }, 1), /another chart revision/);
    assert.equal(authority.read(fixture.entry).revision, 1);
  } finally { authority.close(); }
});

test('consistent backup reopens independently and restore is create-only', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { entry } = await packageFixture(root);
  const authority = SongBindingAuthority.open(join(root, 'authoring.sqlite'));
  try {
    const original = authority.save(await prepareSongBindings(entry, bindings), 0);
    const filename = join(root, 'snapshot.sqlite');
    assert.deepEqual(authority.backup(filename).records, [original]);
    assert.deepEqual(verifySongBindingBackup(filename), [original]);
    const before = await readFile(filename);
    assert.throws(() => authority.backup(filename), /EEXIST/);
    assert.deepEqual(await readFile(filename), before);
    const restored = join(root, 'restored.sqlite');
    assert.deepEqual(restoreSongBindingBackup(filename, restored), [original]);
    const copy = SongBindingAuthority.open(restored);
    try { assert.deepEqual(copy.read(entry), original); } finally { copy.close(); }
    assert.throws(() => restoreSongBindingBackup(filename, restored), /EEXIST/);
    authority.save(await prepareSongBindings(entry, []), 1);
    assert.deepEqual(verifySongBindingBackup(filename), [original], 'later writes do not change a completed backup');
  } finally { authority.close(); }
});

test('foreign schemas, unsafe files and corrupted authoring fail closed without overwriting them', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const foreign = join(root, 'foreign.sqlite');
  const database = new DatabaseSync(foreign); database.exec('CREATE TABLE unrelated (id INTEGER)'); database.close(); await chmod(foreign, 0o600);
  const original = await readFile(foreign);
  assert.throws(() => SongBindingAuthority.open(foreign), /Not a song binding authority/);
  assert.deepEqual(await readFile(foreign), original);
  const valid = join(root, 'valid.sqlite'); SongBindingAuthority.open(valid).close();
  const link = join(root, 'link.sqlite'); await symlink(valid, link);
  assert.throws(() => SongBindingAuthority.open(link), /single-link regular/);
  await chmod(valid, 0o644); assert.throws(() => SongBindingAuthority.open(valid), /mode 600/); await chmod(valid, 0o600);
  const tamper = new DatabaseSync(valid); tamper.exec('CREATE TABLE surprise (id INTEGER)'); tamper.close();
  assert.throws(() => SongBindingAuthority.open(valid), /Unsupported.*schema/);
});

test('corrupt saved bindings prevent read and backup rather than publishing a partial snapshot', async t => {
  const root = await mkdtemp(join(tmpdir(), 'song-binding-')); t.after(() => rm(root, { recursive: true, force: true }));
  const { entry } = await packageFixture(root);
  const filename = join(root, 'authoring.sqlite'), authority = SongBindingAuthority.open(filename);
  try {
    authority.save(await prepareSongBindings(entry, bindings), 0);
    const editor = new DatabaseSync(filename);
    try { editor.prepare('UPDATE song_input_bindings SET bindings_json = ?').run('[{"controlId":"not-a-control","target":{"kind":"tempo"}}]'); }
    finally { editor.close(); }
    assert.throws(() => authority.read(entry));
    const destination = join(root, 'invalid-snapshot.sqlite');
    assert.throws(() => authority.backup(destination));
    await assert.rejects(readFile(destination), /ENOENT/);
    assert.throws(() => verifySongBindingBackup(filename));
  } finally { authority.close(); }
});
