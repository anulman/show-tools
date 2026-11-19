import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import { decodeCompiledSong } from '../performance/compiled-song.js';
import { compiledProgramBytes } from '../performance/compiled-native.js';
import { DEFAULT_BUTTON_BINDINGS, decodeInputBindings, type InputBindings } from '../performance/input-bindings.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../performance/musicxml-song.js';
import { stableMusicXmlJson } from '../performance/score-xml.js';
import { encodeInitialProfiles } from './commands.js';
import { validateInstalledPackage } from './prepare.js';
import type { InstalledSong } from './song-catalog.js';

const applicationId = 0x53544249;
const legacyDefinitions = [
  'CREATE TABLE song_binding_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), schema_version INTEGER NOT NULL CHECK(schema_version = 1)) STRICT',
  'CREATE TABLE song_input_bindings (song_id TEXT PRIMARY KEY NOT NULL, source_digest TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), bindings_json TEXT NOT NULL) STRICT',
];
const metadataV2 = 'CREATE TABLE song_binding_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), schema_version INTEGER NOT NULL CHECK(schema_version = 2)) STRICT';
const globalBindingsTable = 'CREATE TABLE global_input_bindings (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL CHECK(revision >= 1), bindings_json TEXT NOT NULL) STRICT';
const definitions = [metadataV2, legacyDefinitions[1], globalBindingsTable];
const id = Schema.NonEmptyString.check(Schema.isMaxLength(256), Schema.isPattern(/^[^\x00-\x1f\x7f]+$/));
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const revision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const storedBindingFields = { revision: revision.check(Schema.isGreaterThan(0)), bindings_json: Schema.String };
const decodeRecord = Schema.decodeUnknownSync(Schema.Struct({ song_id: id, source_digest: digest, ...storedBindingFields }));
const decodeGlobalRecord = Schema.decodeUnknownSync(Schema.Struct(storedBindingFields));
const decodePath = Schema.decodeUnknownSync(Schema.NonEmptyString.check(Schema.makeFilter(value =>
  isAbsolute(value) && !value.includes('\0') && !value.endsWith('/') || 'An absolute file path is required')));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface ButtonBindingRecord {
  readonly revision: number;
  readonly bindings: InputBindings;
}
export interface PreparedSongBindings {
  readonly songId: string;
  readonly sourceDigest: string;
  readonly bindings: InputBindings;
  readonly musicXml: string;
  readonly manifest: Buffer;
  readonly packet: Buffer;
  readonly effects: Buffer;
  readonly installed: ReturnType<typeof validateInstalledPackage>;
  readonly packageDigest: string;
}

function canonicalPath(filename: string): string {
  const path = decodePath(filename), name = basename(path);
  if (name === '.' || name === '..') throw new Error('A file name is required');
  return join(realpathSync.native(dirname(path)), name);
}
function privateFile(filename: string): void {
  const info = lstatSync(filename);
  if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077))
    throw new Error('Song binding databases must be caller-owned single-link regular files with mode 600');
}
function syncPath(filename: string): void {
  const fd = openSync(filename, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
function bindingRecord(value: unknown): ButtonBindingRecord {
  const parsed = decodeGlobalRecord(value);
  return { revision: parsed.revision, bindings: decodeInputBindings(JSON.parse(parsed.bindings_json)) };
}
function validateDatabase(database: DatabaseSync) {
  const app = Schema.decodeUnknownSync(Schema.Struct({ application_id: Schema.Int }))(database.prepare('PRAGMA application_id').get());
  if (app.application_id !== applicationId) throw new Error('Not a song binding authority database');
  const tables = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String, sql: Schema.String })))(
    database.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  const matches = (schema: readonly string[]) =>
    tables.length === schema.length && schema.every(expected => tables.some(table => normalized(table.sql) === normalized(expected)));
  const version = matches(definitions) ? 2 : matches(legacyDefinitions) ? 1 : undefined;
  if (!version) throw new Error('Unsupported song binding database schema');
  const metadata = database.prepare('SELECT id, schema_version FROM song_binding_metadata').all();
  if (stableMusicXmlJson(metadata) !== stableMusicXmlJson([{ id: 1, schema_version: version }])) throw new Error('Unsupported song binding schema version');
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (stableMusicXmlJson(integrity) !== stableMusicXmlJson([{ integrity_check: 'ok' }])) throw new Error('Song binding database integrity check failed');
  const legacy = database.prepare('SELECT song_id, source_digest, revision, bindings_json FROM song_input_bindings ORDER BY song_id').all()
    .map(value => { const parsed = decodeRecord(value); return { songId: parsed.song_id, ...bindingRecord(parsed) }; });
  const records = version === 1 ? legacy : database.prepare('SELECT revision, bindings_json FROM global_input_bindings').all().map(bindingRecord);
  return { version, records, legacy };
}

export async function prepareSongBindings(entry: InstalledSong, input: unknown): Promise<PreparedSongBindings> {
  const bindings = decodeInputBindings(input);
  const compiled = entry.installed.song.compiled;
  if (!compiled) throw new Error('Installed song has no canonical compiled program');
  const [sourceBytes, effects] = await Promise.all([
    readFile(join(dirname(entry.paths.manifest), 'source.musicxml')),
    readFile(entry.paths.effects),
  ]);
  if (hash(effects) !== entry.hashes.effectsSha256) throw new Error('Installed effects changed after catalog validation');
  const document = await readMusicXmlSong(sourceBytes.toString('utf8'));
  if (document.song.id !== entry.id || stableMusicXmlJson(document.song) !== stableMusicXmlJson(compiled))
    throw new Error('Canonical source.musicxml does not match the installed song; install a matched chart package before editing bindings');
  const changed = decodeCompiledSong({ ...document.song, inputBindings: bindings });
  const musicXml = await writeMusicXmlSong({ song: changed, report: document.report,
    ...(document.source === null ? {} : { source: document.source }),
    ...(document.mapping === null ? {} : { mapping: document.mapping }),
    ...(document.voices === null ? {} : { voices: document.voices }) });
  const canonical = await readMusicXmlSong(musicXml);
  const acknowledged = decodeInputBindings(canonical.song.inputBindings);
  const packet = Buffer.from(compiledProgramBytes(canonical.song));
  const configurations: unknown = JSON.parse(effects.toString('utf8'));
  const manifest = Buffer.from(JSON.stringify({ id: entry.id, description: entry.installed.song.description,
    compiled: canonical.song, practice: entry.installed.song.practice, takeCount: canonical.song.takes.length,
    packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(configurations)) }));
  const installed = validateInstalledPackage(manifest, packet, configurations);
  return { songId: entry.id, sourceDigest: compiled.source.digest, bindings: acknowledged, musicXml,
    manifest, packet, effects, installed,
    packageDigest: hash(Buffer.from(JSON.stringify({ format: 'show-tools-authored-song-v1',
      sourceSha256: hash(Buffer.from(musicXml)), manifestSha256: hash(manifest), packetSha256: hash(packet), effectsSha256: hash(effects) }))) };
}

export class SongBindingAuthority {
  private constructor(private readonly database: DatabaseSync) {}

  static open(filename: string): SongBindingAuthority {
    const path = canonicalPath(filename);
    let created = false;
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      closeSync(fd); created = true;
    } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
    privateFile(path);
    const database = new DatabaseSync(path);
    try {
      database.exec('PRAGMA synchronous = FULL; PRAGMA busy_timeout = 3000');
      database.exec('BEGIN IMMEDIATE');
      try {
        if (created) {
          database.exec(`PRAGMA application_id = ${applicationId}; ${definitions.join(';')}; INSERT INTO song_binding_metadata VALUES (1, 2)`);
        } else {
          const { version, legacy } = validateDatabase(database);
          if (version === 1) {
            database.exec(`DROP TABLE song_binding_metadata; ${metadataV2}; INSERT INTO song_binding_metadata VALUES (1, 2); ${globalBindingsTable}`);
            const dyc = legacy.find(record => record.songId === 'dance-yrself-clean');
            if (dyc) database.prepare('INSERT INTO global_input_bindings VALUES (1, ?, ?)')
              .run(dyc.revision, JSON.stringify(dyc.bindings));
          }
        }
        database.exec('COMMIT');
      } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
      return new SongBindingAuthority(database);
    } catch (error) { database.close(); throw error; }
  }

  read(): ButtonBindingRecord {
    const value = this.database.prepare('SELECT revision, bindings_json FROM global_input_bindings WHERE id = 1').get();
    return value ? bindingRecord(value) : { revision: 0, bindings: DEFAULT_BUTTON_BINDINGS };
  }

  save(input: InputBindings, expectedRevision: number): ButtonBindingRecord {
    const expected = Schema.decodeUnknownSync(revision)(expectedRevision);
    const bindings = decodeInputBindings(input);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const current = this.read();
      if (current.revision !== expected) throw new Error('Button assignments changed; reload the current assignment before saving');
      if (expected === Number.MAX_SAFE_INTEGER) throw new Error('Button assignment revision exhausted');
      const next = expected + 1;
      this.database.prepare('INSERT INTO global_input_bindings VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, bindings_json = excluded.bindings_json')
        .run(next, JSON.stringify(bindings));
      const saved = this.read();
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void { this.database.close(); }
}

export const openSongBindingAuthority = (filename: string) => SongBindingAuthority.open(filename);

export function backupSongBindings(source: string, destination: string) {
  const original = canonicalPath(source), filename = canonicalPath(destination);
  privateFile(original);
  const parent = dirname(filename);
  const staging = mkdtempSync(join(parent, '.song-binding-backup-'));
  const database = new DatabaseSync(original, { readOnly: true });
  let published = false;
  try {
    database.exec('PRAGMA busy_timeout = 3000');
    const temporary = join(staging, 'bindings.sqlite');
    database.prepare('VACUUM INTO ?').run(temporary);
    chmodSync(temporary, 0o600);
    const records = verifySongBindingBackup(temporary);
    syncPath(temporary);
    linkSync(temporary, filename); published = true; syncPath(parent);
    return { filename, records };
  } finally {
    database.close();
    rmSync(staging, { recursive: true });
    if (published) syncPath(parent);
  }
}

export function verifySongBindingBackup(filename: string): readonly ButtonBindingRecord[] {
  const path = canonicalPath(filename); privateFile(path);
  const database = new DatabaseSync(path, { readOnly: true });
  try { return validateDatabase(database).records; } finally { database.close(); }
}

export function restoreSongBindingBackup(source: string, destination: string): readonly ButtonBindingRecord[] {
  const original = canonicalPath(source), target = canonicalPath(destination);
  verifySongBindingBackup(original);
  copyFileSync(original, target, constants.COPYFILE_EXCL);
  chmodSync(target, 0o600); syncPath(target); syncPath(dirname(target));
  return verifySongBindingBackup(target);
}
