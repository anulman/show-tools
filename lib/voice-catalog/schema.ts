export const schemaSqlV1 = `
CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL CHECK(revision >= 0));
INSERT INTO catalog_metadata VALUES (1, 0);
CREATE TABLE voices (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, notes TEXT NOT NULL, character_id TEXT, avatar_token TEXT NOT NULL);
CREATE TABLE voice_effects (voice_id TEXT NOT NULL REFERENCES voices(id), ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 0 AND 63), definition_json TEXT NOT NULL, PRIMARY KEY(voice_id, ordinal));
CREATE TABLE sheet_bindings (spreadsheet_id TEXT NOT NULL, sheet_id INTEGER NOT NULL CHECK(sheet_id >= 0), label_cell TEXT NOT NULL, source_label TEXT NOT NULL, voice_id TEXT NOT NULL REFERENCES voices(id), PRIMARY KEY(spreadsheet_id, sheet_id, label_cell));
PRAGMA user_version = 1;`;
const bindingSqlV1 = schemaSqlV1.split(';').map(sql => sql.trim()).find(sql => sql.startsWith('CREATE TABLE sheet_bindings'));
if (!bindingSqlV1) throw new Error('Missing binding schema');
export const bindingSqlV2 = `CREATE TABLE sheet_bindings (spreadsheet_id TEXT NOT NULL, sheet_id INTEGER NOT NULL CHECK(sheet_id >= 0), label_cell TEXT NOT NULL, source_label TEXT NOT NULL, voice_id TEXT NOT NULL REFERENCES voices(id), cue_label_cell TEXT, cue_source_label TEXT, CHECK((cue_label_cell IS NULL) = (cue_source_label IS NULL)), PRIMARY KEY(spreadsheet_id, sheet_id, label_cell))`;
export const schemaSqlV2 = schemaSqlV1.replace(bindingSqlV1, bindingSqlV2).replace('user_version = 1', 'user_version = 2');
export const metadataSqlV3 = 'CREATE TABLE catalog_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL CHECK(revision >= 0), catalog_id TEXT NOT NULL CHECK(length(catalog_id) > 0), generation_id TEXT NOT NULL CHECK(length(generation_id) > 0))';
export const schemaSqlV3 = schemaSqlV2.replace(/CREATE TABLE catalog_metadata[^;]+;/, `${metadataSqlV3};`)
  .replace('INSERT INTO catalog_metadata VALUES (1, 0);', '').replace('user_version = 2', 'user_version = 3');
