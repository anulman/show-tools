import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { parseCatalogDocument, type CatalogDocument } from '../model.js';
import { RevisionConflictError, VoiceCatalogSqlite } from '../sqlite.js';

const require = createRequire(import.meta.url);
const sql = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const sample: CatalogDocument = {
  version: 2, revision: 0,
  voices: [{ id: 'cowbell', name: 'Cowbell', notes: '', characterId: 'future-character', avatarToken: 'amber', effects: [
    { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 },
    { kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 },
  ] }],
  bindings: [{ spreadsheetId: 'sheet-one', sheetId: 0, labelCell: 'A11', sourceLabel: 'AF - Cowbell', voiceId: 'cowbell', cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }],
};

function modifiedBytes(bytes: Uint8Array, mutation: string): Uint8Array {
  const database = new sql.Database(bytes);
  try { database.run(mutation); return database.export(); }
  finally { database.close(); }
}

test('fresh catalog round trips ordered effects, unknown character IDs, JSON and SQLite backup', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    assert.deepEqual(catalog.snapshot(), { version: 2, revision: 0, voices: [], bindings: [] });
    const saved = catalog.replace(JSON.parse(JSON.stringify(sample)), 0);
    assert.equal(saved.revision, 1);
    assert.equal(saved.voices[0].characterId, 'future-character');
    const reopened = VoiceCatalogSqlite.open(sql, catalog.exportBytes());
    try { assert.deepEqual(reopened.snapshot(), saved); }
    finally { reopened.close(); }
    assert.deepEqual(parseCatalogDocument(JSON.parse(JSON.stringify(saved))), saved);
    assert.deepEqual(catalog.replace({ ...sample, revision: 800 }, 1), saved, 'imported revision does not override local history');
  } finally { catalog.close(); }
});

test('stale writes fail unchanged and actual changes increment revision', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    const saved = catalog.replace(sample, 0);
    assert.throws(() => catalog.replace({ ...sample, voices: [] }, 0));
    assert.throws(() => catalog.replace(sample, 0), RevisionConflictError);
    assert.deepEqual(catalog.snapshot(), saved);
    const updated = catalog.saveVoice({ ...saved.voices[0], name: 'Metal bell' }, 1);
    assert.equal(updated.revision, 2);
    assert.equal(updated.voices[0].name, 'Metal bell');
    assert.equal(catalog.bind({ ...sample.bindings[0], sourceLabel: 'AF - Bell' }, 2).revision, 3);
  } finally { catalog.close(); }
});

test('invalid identities, qualified bindings, effect bounds and limits never mutate a catalog', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    const saved = catalog.replace(sample, 0);
    const voice = sample.voices[0];
    const invalid: unknown[] = [
      { ...sample, voices: [voice, voice] },
      { ...sample, bindings: [sample.bindings[0], sample.bindings[0]] },
      { ...sample, bindings: [{ ...sample.bindings[0], voiceId: 'missing' }] },
      { ...sample, bindings: [{ ...sample.bindings[0], labelCell: 'a11' }] },
      { ...sample, voices: [{ ...voice, effects: Array.from({ length: 65 }, () => voice.effects[0]) }] },
      { ...sample, voices: [{ ...voice, effects: [{ kind: 'slapback', delayMs: 39, feedback: 0, wet: .2 }] }] },
      { ...sample, voices: [{ ...voice, effects: [{ kind: 'chorus', rateHz: Infinity, depthMs: 1, baseDelayMs: 20, wet: .2 }] }] },
      { ...sample, voices: [{ ...voice, notes: 'x'.repeat(4001) }] },
      { ...sample, revision: Number.MAX_SAFE_INTEGER + 1 },
    ];
    for (const document of invalid) {
      assert.throws(() => catalog.replace(document, 1));
      assert.deepEqual(catalog.snapshot(), saved);
    }
  } finally { catalog.close(); }
});

test('same source cell in different sheets or spreadsheets remains distinct', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    const binding = sample.bindings[0];
    assert.equal(catalog.replace({ ...sample, bindings: [binding, { ...binding, sheetId: 1 }, { ...binding, spreadsheetId: 'another' }] }, 0).bindings.length, 3);
  } finally { catalog.close(); }
});

test('SQL failure after deletion rolls all voice, effect, binding and revision changes back', () => {
  const original = VoiceCatalogSqlite.create(sql);
  original.replace(sample, 0);
  const bytes = modifiedBytes(original.exportBytes(), "CREATE TRIGGER fail_binding BEFORE INSERT ON sheet_bindings BEGIN SELECT RAISE(ABORT, 'injected insert failure'); END;");
  original.close();
  const catalog = VoiceCatalogSqlite.open(sql, bytes);
  try {
    const before = catalog.snapshot();
    assert.throws(() => catalog.saveVoice({ ...before.voices[0], name: 'Fail' }, 1), /injected insert failure/);
    assert.deepEqual(catalog.snapshot(), before);
  } finally { catalog.close(); }
});

test('unknown versions, foreign key damage, invalid effect order/bounds and corrupt bytes fail closed', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  catalog.replace(sample, 0);
  const bytes = catalog.exportBytes();
  catalog.close();
  for (const mutation of [
    'PRAGMA user_version = 99',
    'PRAGMA user_version = 0',
    "UPDATE sheet_bindings SET voice_id = 'missing'",
    'UPDATE voice_effects SET ordinal = ordinal + 10',
    "UPDATE voice_effects SET definition_json = '{}'",
    'DROP TABLE voices',
    'ALTER TABLE voices ADD COLUMN incompatible TEXT',
  ]) assert.throws(() => VoiceCatalogSqlite.open(sql, modifiedBytes(bytes, mutation)), mutation);
  assert.throws(() => VoiceCatalogSqlite.open(sql, new Uint8Array([1, 2, 3])));
});

test('an empty version-zero SQLite database migrates to version two', () => {
  const database = new sql.Database();
  const bytes = database.export();
  database.close();
  const catalog = VoiceCatalogSqlite.open(sql, bytes);
  try { assert.equal(catalog.snapshot().revision, 0); }
  finally { catalog.close(); }
});


test('native FX boundary values and the full 64-stage graph round trip', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    const effects = [
      { kind: 'slapback', delayMs: 40, feedback: 0, wet: 0 },
      { kind: 'slapback', delayMs: 250, feedback: .7, wet: 1 },
      { kind: 'chorus', rateHz: .05, depthMs: 0, baseDelayMs: 10, wet: 0 },
      { kind: 'chorus', rateHz: 5, depthMs: 9, baseDelayMs: 40, wet: 1 },
    ];
    const saved = catalog.replace({ ...sample, voices: [{ ...sample.voices[0], effects: Array.from({ length: 64 }, (_, index) => effects[index % effects.length]) }] }, 0);
    assert.equal(saved.voices[0].effects.length, 64);
    const reopened = VoiceCatalogSqlite.open(sql, catalog.exportBytes());
    try { assert.deepEqual(reopened.snapshot(), saved); }
    finally { reopened.close(); }
    for (const badEffect of [
      { ...effects[0], feedback: .701 }, { ...effects[0], wet: -1 },
      { ...effects[2], depthMs: 9.01 }, { ...effects[2], rateHz: 0 }, { ...effects[2], baseDelayMs: 41 },
    ]) {
      assert.throws(() => catalog.saveVoice({ ...sample.voices[0], effects: [badEffect] }, 1));
      assert.deepEqual(catalog.snapshot(), saved);
    }
  } finally { catalog.close(); }
});

test('published version-one SQLite and JSON libraries migrate without losing saved data', () => {
  const legacy = new sql.Database();
  legacy.run(`
    CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL CHECK(revision >= 0));
    INSERT INTO catalog_metadata VALUES (1, 9);
    CREATE TABLE voices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL, character_id TEXT, avatar_token TEXT NOT NULL);
    CREATE TABLE voice_effects (voice_id TEXT NOT NULL REFERENCES voices(id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 63), definition_json TEXT NOT NULL, PRIMARY KEY(voice_id, ordinal));
    CREATE TABLE sheet_bindings (spreadsheet_id TEXT NOT NULL, sheet_id INTEGER NOT NULL CHECK(sheet_id >= 0), label_cell TEXT NOT NULL, source_label TEXT NOT NULL, voice_id TEXT NOT NULL REFERENCES voices(id), PRIMARY KEY(spreadsheet_id, sheet_id, label_cell));
    PRAGMA user_version = 1;
  `);
  const voice = { ...sample.voices[0], notes: 'Keep my saved settings' };
  legacy.run('INSERT INTO voices VALUES (?, ?, ?, ?, ?)', [voice.id, voice.name, voice.notes, voice.characterId, voice.avatarToken]);
  for (const [index, effect] of voice.effects.entries()) legacy.run('INSERT INTO voice_effects VALUES (?, ?, ?)', [voice.id, index, JSON.stringify(effect)]);
  legacy.run('INSERT INTO sheet_bindings VALUES (?, ?, ?, ?, ?)', ['sheet-one', 0, 'A11', 'AF - Cowbell', voice.id]);
  const bytes = legacy.export(); legacy.close();
  const catalog = VoiceCatalogSqlite.open(sql, bytes);
  try {
    const migrated = catalog.snapshot();
    assert.equal(migrated.version, 2); assert.equal(migrated.revision, 9);
    assert.deepEqual(migrated.voices, [voice]);
    assert.deepEqual(migrated.bindings, [{ ...sample.bindings[0], cueRow: null }]);
    const { cueRow: _cue, ...oldBinding } = sample.bindings[0];
    assert.deepEqual(parseCatalogDocument({ version: 1, revision: 9, voices: [voice], bindings: [oldBinding] }), migrated);
    const saved = catalog.bind({ ...migrated.bindings[0], cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }, 9);
    const reopened = VoiceCatalogSqlite.open(sql, catalog.exportBytes());
    try { assert.deepEqual(reopened.snapshot(), saved); }
    finally { reopened.close(); }
    assert.equal(saved.revision, 10);
  } finally { catalog.close(); }
});

test('cue row input is validated before mutation and stays in its qualified sheet binding', () => {
  const catalog = VoiceCatalogSqlite.create(sql);
  try {
    const saved = catalog.replace(sample, 0);
    assert.throws(() => catalog.bind({ ...saved.bindings[0], cueRow: { labelCell: 'A0', sourceLabel: 'R1' } }, saved.revision));
    assert.deepEqual(catalog.snapshot(), saved);
    const other = catalog.bind({ ...saved.bindings[0], sheetId: 7, cueRow: { labelCell: 'A19', sourceLabel: 'Other sheet commands' } }, saved.revision);
    assert.equal(other.bindings.find(binding => binding.sheetId === 0)?.cueRow?.sourceLabel, 'R2');
    assert.equal(other.bindings.find(binding => binding.sheetId === 7)?.cueRow?.sourceLabel, 'Other sheet commands');
  } finally { catalog.close(); }
});
