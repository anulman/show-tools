import { Schema } from 'effect';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { CatalogStampSchema, makeCatalogSnapshot, type CatalogStamp, type CatalogSnapshot } from './authority-model.js';
import { metadataSqlV3 } from './schema.js';
import { readCanonicalCatalog } from './sql-reader.js';
import { VoiceCatalogSqlite } from './sqlite.js';

type CatalogIdentity = Pick<CatalogStamp, 'catalogId' | 'generationId'>;
const decodeIdentity = Schema.decodeUnknownSync(Schema.Struct({ catalogId: CatalogStampSchema.fields.catalogId, generationId: CatalogStampSchema.fields.generationId }));
const decodeBytes = Schema.decodeUnknownSync(Schema.instanceOf(Uint8Array));
const decodeVersion = Schema.decodeUnknownSync(Schema.Struct({ user_version: Schema.Int }));

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
  return readCanonicalCatalog({ all: sql => rows(database, sql) });
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
