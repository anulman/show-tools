import { Schema } from 'effect';
import { CatalogStampSchema, parseCatalogBody, type CatalogBody, type CatalogStamp } from './authority-model.js';
import { schemaSqlV3 } from './schema.js';

export interface CanonicalSqlReader {
  all(sql: string): readonly Record<string, unknown>[];
}

const decodeVersion = Schema.decodeUnknownSync(Schema.Struct({ user_version: Schema.Int }));
const decodeMetadata = Schema.decodeUnknownSync(Schema.Struct({
  id: Schema.Literal(1), revision: CatalogStampSchema.fields.revision,
  catalog_id: CatalogStampSchema.fields.catalogId, generation_id: CatalogStampSchema.fields.generationId,
}));
const decodeVoice = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, name: Schema.String, notes: Schema.String, character_id: Schema.NullOr(Schema.String), avatar_token: Schema.String }));
const decodeEffect = Schema.decodeUnknownSync(Schema.Struct({ voice_id: Schema.String, ordinal: Schema.Int, definition_json: Schema.String }));
const decodeBinding = Schema.decodeUnknownSync(Schema.Struct({ spreadsheet_id: Schema.String, sheet_id: Schema.Int, label_cell: Schema.String, source_label: Schema.String, voice_id: Schema.String, cue_label_cell: Schema.NullOr(Schema.String), cue_source_label: Schema.NullOr(Schema.String) }));

export function readCanonicalCatalog(reader: CanonicalSqlReader): { readonly stamp: CatalogStamp; readonly body: CatalogBody } {
  if (decodeVersion(reader.all('PRAGMA user_version')[0]).user_version !== 3) throw new Error('Canonical catalog requires schema version 3; migrate older libraries first');
  const actual = reader.all("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  const expected = schemaSqlV3.split(';').map(sql => sql.trim()).filter(sql => sql.startsWith('CREATE TABLE'));
  const normalize = (sql: string) => sql.replace(/\s+/g, ' ').trim().toLowerCase();
  if (actual.length !== expected.length || expected.some(sql => !actual.some(row => typeof row.sql === 'string' && normalize(row.sql) === normalize(sql)))
    || reader.all("SELECT name FROM sqlite_master WHERE type != 'table' AND name NOT LIKE 'sqlite_%'").length) throw new Error('Unsupported canonical catalog database schema');
  const integrity = reader.all('PRAGMA integrity_check');
  if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok' || reader.all('PRAGMA foreign_key_check').length) throw new Error('Canonical catalog database integrity check failed');
  const metadataRows = reader.all('SELECT id, revision, catalog_id, generation_id FROM catalog_metadata');
  if (metadataRows.length !== 1) throw new Error('Canonical catalog requires exactly one metadata row');
  const metadata = decodeMetadata(metadataRows[0]);
  const effects = reader.all('SELECT voice_id, ordinal, definition_json FROM voice_effects ORDER BY voice_id, ordinal').map(row => decodeEffect(row));
  const voices = reader.all('SELECT id, name, notes, character_id, avatar_token FROM voices ORDER BY id').map(row => decodeVoice(row)).map(row => {
    const stages = effects.filter(effect => effect.voice_id === row.id);
    if (stages.some((effect, ordinal) => effect.ordinal !== ordinal)) throw new Error(`Invalid effect order for voice ${row.id}`);
    return { id: row.id, name: row.name, notes: row.notes, characterId: row.character_id, avatarToken: row.avatar_token,
      effects: stages.map(effect => JSON.parse(effect.definition_json)) };
  });
  const bindings = reader.all('SELECT spreadsheet_id, sheet_id, label_cell, source_label, voice_id, cue_label_cell, cue_source_label FROM sheet_bindings').map(row => decodeBinding(row)).map(row => ({
    spreadsheetId: row.spreadsheet_id, sheetId: row.sheet_id, labelCell: row.label_cell, sourceLabel: row.source_label, voiceId: row.voice_id,
    cueRow: row.cue_label_cell === null ? null : { labelCell: row.cue_label_cell, sourceLabel: row.cue_source_label },
  }));
  return { stamp: { catalogId: metadata.catalog_id, generationId: metadata.generation_id, revision: metadata.revision }, body: parseCatalogBody({ voices, bindings }) };
}
