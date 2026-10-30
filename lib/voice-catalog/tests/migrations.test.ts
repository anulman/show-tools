import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { canonicalBodyJson } from '../authority-model.js';
import { migrateCatalog, readMigratedCatalog, restoreCatalog } from '../migrations.js';
import { VoiceCatalogSqlite } from '../sqlite.js';
import { schemaSqlV1 } from '../schema.js';
import type { CatalogDocument } from '../model.js';

const require = createRequire(import.meta.url);
const sql = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const identity = { catalogId: 'operator-library', generationId: 'initial-generation' };
const document: CatalogDocument = { version: 2, revision: 17,
  voices: [
    { id: 'v/cowbell', name: 'Cowbell', notes: 'Keep the quiet first hit.\nTwo layers 🔔', characterId: 'future-unavailable-character', avatarToken: 'amber',
      effects: [{ kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 }, { kind: 'slapback', delayMs: 140, feedback: .2, wet: .4 }] },
    { id: 'v/drums', name: 'Drums & Claps', notes: '', characterId: null, avatarToken: 'neutral', effects: [] },
  ],
  bindings: [
    { spreadsheetId: 'source-one', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell', voiceId: 'v/cowbell', cueRow: { labelCell: 'A19', sourceLabel: 'R2' } },
    { spreadsheetId: 'source-two', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell elsewhere', voiceId: 'v/cowbell', cueRow: null },
    { spreadsheetId: 'source-one', sheetId: 102, labelCell: 'A11', sourceLabel: 'AF - Drums & Claps', voiceId: 'v/drums', cueRow: { labelCell: 'A18', sourceLabel: 'R1' } },
  ],
};

function versionTwo(): Uint8Array {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    catalog.replace(document, 0);
    const database = new sql.Database(catalog.exportBytes());
    try { database.run('UPDATE catalog_metadata SET revision = ?', [document.revision]); return database.export(); }
    finally { database.close(); }
  } finally { catalog.close(); }
}

function changed(bytes: Uint8Array, mutation: string): Uint8Array {
  const database = new sql.Database(bytes);
  try { database.run(mutation); return database.export(); }
  finally { database.close(); }
}

test('version-two migration preserves all authoring data and revision with canonical identity inside SQLite', async () => {
  const original = versionTwo(), before = original.slice();
  const migrated = migrateCatalog(sql, original, identity);
  assert.deepEqual(original, before, 'migration must not mutate the only existing backup');
  const snapshot = await readMigratedCatalog(sql, migrated);
  assert.deepEqual(snapshot.stamp, { ...identity, revision: 17 });
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(canonicalBodyJson(snapshot.body), canonicalBodyJson(document));
  assert.deepEqual(snapshot.body.voices[0].effects, document.voices[0].effects);
  assert.equal(snapshot.body.voices[0].characterId, 'future-unavailable-character');
  assert.equal(snapshot.body.bindings.length, 3);
  assert.deepEqual(await readMigratedCatalog(sql, migrated.slice()), snapshot, 'reopened bytes must retain exactly the same canonical view');
  assert.throws(() => VoiceCatalogSqlite.open(sql, migrated), /Unsupported voice library database version/, 'old runtime readers fail clearly');
});

test('version-one migration chains through cue-row migration without changing identities or effect order', async () => {
  const database = new sql.Database();
  database.run(schemaSqlV1);
  const voice = document.voices[0];
  database.run('UPDATE catalog_metadata SET revision = 9');
  database.run('INSERT INTO voices VALUES (?, ?, ?, ?, ?)', [voice.id, voice.name, voice.notes, voice.characterId, voice.avatarToken]);
  for (const [ordinal, effect] of voice.effects.entries()) database.run('INSERT INTO voice_effects VALUES (?, ?, ?)', [voice.id, ordinal, JSON.stringify(effect)]);
  database.run('INSERT INTO sheet_bindings VALUES (?, ?, ?, ?, ?)', ['source-one', 101, 'A11', 'AF - Cowbell', voice.id]);
  const original = database.export(); database.close();
  const migrated = await readMigratedCatalog(sql, migrateCatalog(sql, original, identity));
  assert.equal(migrated.stamp.revision, 9);
  assert.deepEqual(migrated.body.voices, [voice]);
  assert.deepEqual(migrated.body.bindings, [{ ...document.bindings[0], cueRow: null }]);
});

test('canonical reader accepts only the migrated schema and migration cannot silently retag a canonical library', async () => {
  const legacy = versionTwo(), current = migrateCatalog(sql, legacy, identity);
  await assert.rejects(readMigratedCatalog(sql, legacy), /requires schema version 3/);
  assert.throws(() => migrateCatalog(sql, current, { ...identity, catalogId: 'other-library' }), /version 1 or 2/);
  for (const bytes of [new Uint8Array(), new Uint8Array([1, 2, 3]), changed(legacy, 'PRAGMA user_version = 99'), changed(legacy, 'PRAGMA user_version = 0')]) {
    const original = bytes.slice();
    assert.throws(() => migrateCatalog(sql, bytes, identity));
    assert.deepEqual(bytes, original);
  }
});

test('invalid legacy input fails without changing its source bytes or creating a partially migrated result', () => {
  const valid = versionTwo();
  for (const mutation of [
    "UPDATE sheet_bindings SET voice_id = 'missing'",
    'UPDATE voice_effects SET ordinal = ordinal + 5',
    "UPDATE voice_effects SET definition_json = '{}'",
    'ALTER TABLE voices ADD COLUMN unknown_data TEXT',
    "CREATE TRIGGER unexpected_behavior AFTER UPDATE ON voices BEGIN SELECT 1; END;",
    'UPDATE catalog_metadata SET revision = 9007199254740992',
  ]) {
    const input = changed(valid, mutation), original = input.slice();
    assert.throws(() => migrateCatalog(sql, input, identity), mutation);
    assert.deepEqual(input, original, mutation);
  }
  for (const selected of [{ catalogId: '', generationId: 'first' }, { catalogId: 'one', generationId: '' }]) assert.throws(() => migrateCatalog(sql, valid, selected));
});

test('canonical reader rejects damaged metadata, domain records and schema instead of silently repairing them', async () => {
  const current = migrateCatalog(sql, versionTwo(), identity);
  for (const mutation of [
    'PRAGMA user_version = 2',
    'DELETE FROM catalog_metadata',
    "PRAGMA ignore_check_constraints = ON; UPDATE catalog_metadata SET catalog_id = ''",
    "PRAGMA ignore_check_constraints = ON; UPDATE catalog_metadata SET generation_id = ''",
    'UPDATE catalog_metadata SET revision = 9007199254740992',
    'UPDATE voice_effects SET ordinal = ordinal + 10',
    "UPDATE voices SET avatar_token = 'invalid'",
    'ALTER TABLE catalog_metadata ADD COLUMN old_extra TEXT',
    'CREATE TABLE other (id INTEGER)',
  ]) await assert.rejects(readMigratedCatalog(sql, changed(current, mutation)), mutation);
});

test('maximum safe revision migrates without increment or numeric loss', async () => {
  const legacy = changed(versionTwo(), 'UPDATE catalog_metadata SET revision = 9007199254740991');
  const result = await readMigratedCatalog(sql, migrateCatalog(sql, legacy, identity));
  assert.equal(result.stamp.revision, Number.MAX_SAFE_INTEGER);
});

test('restore retains the backed-up body and repeated revision while changing its generation fence', async () => {
  const backup = migrateCatalog(sql, versionTwo(), identity), original = backup.slice();
  const before = await readMigratedCatalog(sql, backup);
  const restoredBytes = restoreCatalog(sql, backup);
  assert.deepEqual(backup, original);
  const restored = await readMigratedCatalog(sql, restoredBytes);
  assert.equal(restored.stamp.catalogId, before.stamp.catalogId);
  assert.equal(restored.stamp.revision, before.stamp.revision);
  assert.notEqual(restored.stamp.generationId, before.stamp.generationId);
  assert.equal(restored.digest, before.digest);
  assert.deepEqual(restored.body, before.body);
  const another = await readMigratedCatalog(sql, restoreCatalog(sql, backup));
  assert.notEqual(another.stamp.generationId, restored.stamp.generationId);
  assert.notEqual(another.stamp.generationId, before.stamp.generationId);
  assert.throws(() => restoreCatalog(sql, versionTwo()), /requires schema version 3/);
});

test('migrated fixture opens in native SQLite and a consistent snapshot restores in a fresh process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-migration-'));
  const filename = join(directory, 'catalog.sqlite'), backupPath = join(directory, 'backup.sqlite');
  try {
    const migrated = migrateCatalog(sql, versionTwo(), identity);
    const expected = await readMigratedCatalog(sql, migrated);
    await writeFile(filename, migrated);
    const native = new DatabaseSync(filename);
    try {
      assert.equal(native.prepare('PRAGMA user_version').get()?.user_version, 3);
      assert.equal(native.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      assert.equal(native.prepare('SELECT generation_id FROM catalog_metadata').get()?.generation_id, identity.generationId);
      native.prepare('VACUUM INTO ?').run(backupPath);
      native.prepare('UPDATE voices SET name = ? WHERE id = ?').run('Later live change', document.voices[0].id);
    } finally { native.close(); }
    const check = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      const database = new DatabaseSync(process.argv[1], { readOnly: true });
      try {
        console.log(JSON.stringify({ integrity: database.prepare('PRAGMA integrity_check').get(), metadata: database.prepare('SELECT revision, catalog_id, generation_id FROM catalog_metadata').get(), voice: database.prepare('SELECT name FROM voices WHERE id = ?').get('v/cowbell') }));
      } finally { database.close(); }
    `, backupPath], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stderr);
    assert.deepEqual(JSON.parse(check.stdout), { integrity: { integrity_check: 'ok' }, metadata: { revision: 17, catalog_id: identity.catalogId, generation_id: identity.generationId }, voice: { name: 'Cowbell' } });
    const backup = new Uint8Array(await readFile(backupPath));
    assert.deepEqual(await readMigratedCatalog(sql, backup), expected, 'consistent snapshot retains pre-edit data and effect/cue ordering');
    const restored = await readMigratedCatalog(sql, restoreCatalog(sql, backup));
    assert.deepEqual(restored.body, expected.body);
    assert.equal(restored.stamp.revision, expected.stamp.revision);
    assert.notEqual(restored.stamp.generationId, expected.stamp.generationId);
    const live = await readMigratedCatalog(sql, new Uint8Array(await readFile(filename)));
    assert.equal(live.body.voices[0].name, 'Later live change');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
