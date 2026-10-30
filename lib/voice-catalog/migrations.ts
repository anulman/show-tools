import { Schema } from 'effect';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { CatalogStampSchema, makeCatalogSnapshot, parseCatalogBody, type CatalogStamp, type CatalogSnapshot } from './authority-model.js';
import { metadataSqlV3, schemaSqlV3 } from './schema.js';
import { VoiceCatalogSqlite } from './sqlite.js';

type CatalogIdentity = Pick<CatalogStamp, 'catalogId' | 'generationId'>;
const decodeIdentity = Schema.decodeUnknownSync(Schema.Struct({ catalogId: CatalogStampSchema.fields.catalogId, generationId: CatalogStampSchema.fields.generationId }));
const decodeBytes = Schema.decodeUnknownSync(Schema.instanceOf(Uint8Array));
const decodeVersion = Schema.decodeUnknownSync(Schema.Struct({ user_version: Schema.Int }));
const decodeMetadata = Schema.decodeUnknownSync(Schema.Struct({
  id: Schema.Literal(1), revision: CatalogStampSchema.fields.revision,
  catalog_id: CatalogStampSchema.fields.catalogId, generation_id: CatalogStampSchema.fields.generationId,
}));
const decodeVoice = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, name: Schema.String, notes: Schema.String, character_id: Schema.NullOr(Schema.String), avatar_token: Schema.String }));
const decodeEffect = Schema.decodeUnknownSync(Schema.Struct({ voice_id: Schema.String, ordinal: Schema.Int, definition_json: Schema.String }));
const decodeBinding = Schema.decodeUnknownSync(Schema.Struct({ spreadsheet_id: Schema.String, sheet_id: Schema.Int, label_cell: Schema.String, source_label: Schema.String, voice_id: Schema.String, cue_label_cell: Schema.NullOr(Schema.String), cue_source_label: Schema.NullOr(Schema.String) }));

function rows(database: Database, sql: string): Record<string, SqlValue>[] {
  const statement = database.prepare(sql);
  try {
    const result: Record<string, SqlValue>[] = [];
    while (statement.step()) result.push(statement.getAsObject());
    return result;
  } finally { statement.free(); }
}

function readVersion(database: Database): number {
  return decodeVersion(rows(database, 'PRAGMA user_version')[0]).user_version;
}

function readCurrent(database: Database) {
  if (readVersion(database) !== 3) throw new Error('Canonical catalog requires schema version 3; migrate older libraries first');
  const actual = rows(database, "SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const expected = schemaSqlV3.split(';').map(sql => sql.trim()).filter(sql => sql.startsWith('CREATE TABLE'));
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (actual.length !== expected.length || expected.some(sql => !actual.some(row => typeof row.sql === 'string' && normalize(row.sql) === normalize(sql)))
    || rows(database, "SELECT name FROM sqlite_master WHERE type != 'table' AND name NOT LIKE 'sqlite_%'").length) throw new Error('Unsupported canonical catalog database schema');
  const integrity = rows(database, 'PRAGMA integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || rows(database, 'PRAGMA foreign_key_check').length) throw new Error('Canonical catalog database integrity check failed');
  const metadataRows = rows(database, 'SELECT id, revision, catalog_id, generation_id FROM catalog_metadata');
  if (metadataRows.length !== 1) throw new Error('Canonical catalog requires exactly one metadata row');
  const metadata = decodeMetadata(metadataRows[0]);
  const effects = rows(database, 'SELECT voice_id, ordinal, definition_json FROM voice_effects ORDER BY voice_id, ordinal').map(row => decodeEffect(row));
  const voices = rows(database, 'SELECT id, name, notes, character_id, avatar_token FROM voices ORDER BY id').map(row => decodeVoice(row)).map(row => {
    const stages = effects.filter(effect => effect.voice_id === row.id);
    if (stages.some((effect, ordinal) => effect.ordinal !== ordinal)) throw new Error(`Invalid effect order for voice ${row.id}`);
    return { id: row.id, name: row.name, notes: row.notes, characterId: row.character_id, avatarToken: row.avatar_token,
      effects: stages.map(effect => JSON.parse(effect.definition_json)) };
  });
  const bindings = rows(database, 'SELECT spreadsheet_id, sheet_id, label_cell, source_label, voice_id, cue_label_cell, cue_source_label FROM sheet_bindings').map(row => decodeBinding(row)).map(row => ({
    spreadsheetId: row.spreadsheet_id, sheetId: row.sheet_id, labelCell: row.label_cell, sourceLabel: row.source_label, voiceId: row.voice_id,
    cueRow: row.cue_label_cell === null ? null : { labelCell: row.cue_label_cell, sourceLabel: row.cue_source_label },
  }));
  return { stamp: { catalogId: metadata.catalog_id, generationId: metadata.generation_id, revision: metadata.revision }, body: parseCatalogBody({ voices, bindings }) };
}

export function migrateCatalog(sql: SqlJsStatic, bytes: Uint8Array, identity: CatalogIdentity): Uint8Array {
  const selected = decodeIdentity(identity);
  const source = new sql.Database(decodeBytes(bytes));
  try {
    if (![1, 2].includes(readVersion(source))) throw new Error('Migration requires a version 1 or 2 voice library');
  } finally { source.close(); }
  const legacy = VoiceCatalogSqlite.open(sql, bytes);
  let migrated: Uint8Array;
  let revision: number;
  try { revision = legacy.snapshot().revision; migrated = legacy.exportBytes(); }
  finally { legacy.close(); }
  const database = new sql.Database(migrated);
  try {
    database.run('PRAGMA foreign_keys = ON; BEGIN');
    try {
      database.run(`DROP TABLE catalog_metadata; ${metadataSqlV3}`);
      database.run('INSERT INTO catalog_metadata VALUES (1, ?, ?, ?)', [revision, selected.catalogId, selected.generationId]);
      database.run('PRAGMA user_version = 3');
      readCurrent(database);
      database.run('COMMIT');
    } catch (error) { database.run('ROLLBACK'); throw error; }
    return database.export();
  } finally { database.close(); }
}

export async function readMigratedCatalog(sql: SqlJsStatic, bytes: Uint8Array): Promise<CatalogSnapshot> {
  const database = new sql.Database(decodeBytes(bytes));
  try {
    const current = readCurrent(database);
    return await makeCatalogSnapshot(current.stamp, current.body);
  } finally { database.close(); }
}

export function restoreCatalog(sql: SqlJsStatic, bytes: Uint8Array): Uint8Array {
  const database = new sql.Database(decodeBytes(bytes));
  try {
    const current = readCurrent(database);
    const identity = { catalogId: current.stamp.catalogId, generationId: crypto.randomUUID() };
    if (identity.generationId === current.stamp.generationId) throw new Error('Restoring a catalog requires a fresh generation identity');
    database.run('BEGIN');
    try {
      database.run('UPDATE catalog_metadata SET generation_id = ? WHERE id = 1', [identity.generationId]);
      readCurrent(database);
      database.run('COMMIT');
    } catch (error) { database.run('ROLLBACK'); throw error; }
    return database.export();
  } finally { database.close(); }
}
