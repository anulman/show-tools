import { Schema } from 'effect';
import type { Database, SqlJsStatic, SqlValue } from 'sql.js';
import { canonicalCatalog, parseCatalogDocument, parseSheetBinding, parseVoice, type CatalogDocument } from './model.js';

const schemaSql = `
CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL CHECK(revision >= 0));
INSERT INTO catalog_metadata VALUES (1, 0);
CREATE TABLE voices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL, character_id TEXT, avatar_token TEXT NOT NULL);
CREATE TABLE voice_effects (voice_id TEXT NOT NULL REFERENCES voices(id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 63), definition_json TEXT NOT NULL, PRIMARY KEY(voice_id, ordinal));
CREATE TABLE sheet_bindings (spreadsheet_id TEXT NOT NULL, sheet_id INTEGER NOT NULL CHECK(sheet_id >= 0), label_cell TEXT NOT NULL, source_label TEXT NOT NULL, voice_id TEXT NOT NULL REFERENCES voices(id), PRIMARY KEY(spreadsheet_id, sheet_id, label_cell));
PRAGMA user_version = 1;`;
const decodeVoiceRow = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, name: Schema.String, notes: Schema.String, character_id: Schema.NullOr(Schema.String), avatar_token: Schema.String }));
const decodeEffectRow = Schema.decodeUnknownSync(Schema.Struct({ voice_id: Schema.String, ordinal: Schema.Int, definition_json: Schema.String }));
const decodeBindingRow = Schema.decodeUnknownSync(Schema.Struct({ spreadsheet_id: Schema.String, sheet_id: Schema.Int, label_cell: Schema.String, source_label: Schema.String, voice_id: Schema.String }));
const decodeRevisionRow = Schema.decodeUnknownSync(Schema.Struct({ revision: Schema.Int }));
const decodeVersionRow = Schema.decodeUnknownSync(Schema.Struct({ user_version: Schema.Int }));

export class RevisionConflictError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Voice library changed: expected revision ${expectedRevision}, found ${actualRevision}. Reload before saving.`);
    this.name = 'RevisionConflictError';
  }
}

export class VoiceCatalogSqlite {
  private constructor(private readonly database: Database) {}

  static create(sql: SqlJsStatic): VoiceCatalogSqlite { return VoiceCatalogSqlite.open(sql); }

  static open(sql: SqlJsStatic, bytes?: Uint8Array): VoiceCatalogSqlite {
    const database = new sql.Database(bytes);
    const catalog = new VoiceCatalogSqlite(database);
    try {
      database.run('PRAGMA foreign_keys = ON');
      const version = decodeVersionRow(catalog.rows('PRAGMA user_version')[0]).user_version;
      if (version === 0 && catalog.rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").length === 0) {
        database.run('BEGIN');
        try { database.run(schemaSql); database.run('COMMIT'); }
        catch (error) { database.run('ROLLBACK'); throw error; }
      } else if (version !== 1) throw new Error(`Unsupported voice library database version: ${version}`);
      catalog.validateSchema();
      const integrity = catalog.rows('PRAGMA integrity_check');
      if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Voice library database integrity check failed');
      if (catalog.rows('PRAGMA foreign_key_check').length) throw new Error('Voice library has invalid foreign keys');
      catalog.snapshot();
      return catalog;
    } catch (error) { database.close(); throw error; }
  }

  private validateSchema(): void {
    const actual = this.rows("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
    const expected = schemaSql.split(';').map(sql => sql.trim()).filter(sql => sql.startsWith('CREATE TABLE'));
    const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (actual.length !== expected.length || expected.some(sql => !actual.some(row => typeof row.sql === 'string' && normalize(row.sql) === normalize(sql)))) {
      throw new Error('Unsupported voice library database schema');
    }
  }

  private rows(sql: string): Record<string, SqlValue>[] {
    const statement = this.database.prepare(sql);
    try {
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) rows.push(statement.getAsObject());
      return rows;
    } finally { statement.free(); }
  }

  snapshot(): CatalogDocument {
    const metadata = this.rows('SELECT revision FROM catalog_metadata WHERE id = 1');
    if (metadata.length !== 1 || this.rows('SELECT id FROM catalog_metadata').length !== 1) throw new Error('Invalid voice library metadata');
    const effectRows = this.rows('SELECT voice_id, ordinal, definition_json FROM voice_effects ORDER BY voice_id, ordinal').map(row => decodeEffectRow(row));
    const voices = this.rows('SELECT id, name, notes, character_id, avatar_token FROM voices ORDER BY id').map(row => decodeVoiceRow(row)).map(row => {
      const effects = effectRows.filter(effect => effect.voice_id === row.id);
      if (effects.some((effect, index) => effect.ordinal !== index)) throw new Error(`Invalid effect order for voice ${row.id}`);
      return { id: row.id, name: row.name, notes: row.notes, characterId: row.character_id, avatarToken: row.avatar_token, effects: effects.map(effect => JSON.parse(effect.definition_json)) };
    });
    const voiceIds = new Set(voices.map(voice => voice.id));
    if (effectRows.some(effect => !voiceIds.has(effect.voice_id))) throw new Error('Effect references unknown voice');
    const bindings = this.rows('SELECT spreadsheet_id, sheet_id, label_cell, source_label, voice_id FROM sheet_bindings').map(row => decodeBindingRow(row)).map(row => ({ spreadsheetId: row.spreadsheet_id, sheetId: row.sheet_id, labelCell: row.label_cell, sourceLabel: row.source_label, voiceId: row.voice_id }));
    return canonicalCatalog(parseCatalogDocument({ version: 1, revision: decodeRevisionRow(metadata[0]).revision, voices, bindings }));
  }

  replace(input: unknown, expectedRevision: number): CatalogDocument {
    const incoming = canonicalCatalog(parseCatalogDocument(input));
    const current = this.snapshot();
    if (expectedRevision !== current.revision) throw new RevisionConflictError(expectedRevision, current.revision);
    if (JSON.stringify({ ...incoming, revision: 0 }) === JSON.stringify({ ...current, revision: 0 })) return current;
    const next = parseCatalogDocument({ ...incoming, revision: current.revision + 1 });
    this.database.run('BEGIN');
    try {
      this.database.run('DELETE FROM sheet_bindings; DELETE FROM voice_effects; DELETE FROM voices;');
      this.insert('INSERT INTO voices VALUES (?, ?, ?, ?, ?)', next.voices.map(voice => [voice.id, voice.name, voice.notes, voice.characterId, voice.avatarToken]));
      this.insert('INSERT INTO voice_effects VALUES (?, ?, ?)', next.voices.flatMap(voice => voice.effects.map((effect, ordinal) => [voice.id, ordinal, JSON.stringify(effect)])));
      this.insert('INSERT INTO sheet_bindings VALUES (?, ?, ?, ?, ?)', next.bindings.map(binding => [binding.spreadsheetId, binding.sheetId, binding.labelCell, binding.sourceLabel, binding.voiceId]));
      this.database.run('UPDATE catalog_metadata SET revision = ? WHERE id = 1', [next.revision]);
      this.database.run('COMMIT');
    } catch (error) { this.database.run('ROLLBACK'); throw error; }
    return this.snapshot();
  }

  saveVoice(input: unknown, expectedRevision: number): CatalogDocument {
    const voice = parseVoice(input);
    const current = this.snapshot();
    return this.replace({ ...current, voices: [...current.voices.filter(old => old.id !== voice.id), voice] }, expectedRevision);
  }

  bind(input: unknown, expectedRevision: number): CatalogDocument {
    const binding = parseSheetBinding(input);
    const current = this.snapshot();
    return this.replace({ ...current, bindings: [...current.bindings.filter(old => old.spreadsheetId !== binding.spreadsheetId || old.sheetId !== binding.sheetId || old.labelCell !== binding.labelCell), binding] }, expectedRevision);
  }

  private insert(sql: string, values: SqlValue[][]): void {
    const statement = this.database.prepare(sql);
    try { for (const parameters of values) { statement.run(parameters); } }
    finally { statement.free(); }
  }

  exportBytes(): Uint8Array {
    const bytes = this.database.export();
    this.database.run('PRAGMA foreign_keys = ON');
    return bytes;
  }
  close(): void { this.database.close(); }
}
