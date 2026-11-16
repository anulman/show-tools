import { createHash } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, fsyncSync, linkSync, lstatSync, mkdtempSync, openSync, realpathSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Schema } from 'effect';
import { decodeCompiledSong } from '../performance/compiled-song.js';
import { compiledProgramBytes } from '../performance/compiled-native.js';
import { decodeInputBindings, type InputBindings } from '../performance/input-bindings.js';
import { readMusicXmlSong, writeMusicXmlSong } from '../performance/musicxml-song.js';
import { stableMusicXmlJson } from '../performance/score-xml.js';
import { encodeInitialProfiles } from './commands.js';
import { validateInstalledPackage } from './prepare.js';
import type { InstalledSong } from './song-catalog.js';

const applicationId = 0x53544249;
const definitions = [
  'CREATE TABLE song_binding_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), schema_version INTEGER NOT NULL CHECK(schema_version = 1)) STRICT',
  'CREATE TABLE song_input_bindings (song_id TEXT PRIMARY KEY NOT NULL, source_digest TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision >= 1), bindings_json TEXT NOT NULL) STRICT',
];
const id = Schema.NonEmptyString.check(Schema.isMaxLength(256), Schema.isPattern(/^[^\x00-\x1f\x7f]+$/));
const digest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const revision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const decodeRecord = Schema.decodeUnknownSync(Schema.Struct({ song_id: id, source_digest: digest,
  revision: revision.check(Schema.isGreaterThan(0)), bindings_json: Schema.String }));
const decodePath = Schema.decodeUnknownSync(Schema.NonEmptyString.check(Schema.makeFilter(value =>
  isAbsolute(value) && !value.includes('\0') && !value.endsWith('/') || 'An absolute file path is required')));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export interface SongBindingRecord {
  readonly songId: string;
  readonly sourceDigest: string;
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
function row(value: unknown): SongBindingRecord {
  const parsed = decodeRecord(value);
  return { songId: parsed.song_id, sourceDigest: parsed.source_digest, revision: parsed.revision,
    bindings: decodeInputBindings(JSON.parse(parsed.bindings_json)) };
}
function validateDatabase(database: DatabaseSync): readonly SongBindingRecord[] {
  const app = Schema.decodeUnknownSync(Schema.Struct({ application_id: Schema.Int }))(database.prepare('PRAGMA application_id').get());
  if (app.application_id !== applicationId) throw new Error('Not a song binding authority database');
  const tables = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ name: Schema.String, sql: Schema.String })))(
    database.prepare("SELECT name, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all());
  const normalized = (sql: string) => sql.replace(/\s+/g, ' ').trim();
  if (tables.length !== definitions.length || !definitions.every(expected => tables.some(table => normalized(table.sql) === normalized(expected))))
    throw new Error('Unsupported song binding database schema');
  const metadata = database.prepare('SELECT id, schema_version FROM song_binding_metadata').all();
  if (stableMusicXmlJson(metadata) !== stableMusicXmlJson([{ id: 1, schema_version: 1 }])) throw new Error('Unsupported song binding schema version');
  const integrity = database.prepare('PRAGMA integrity_check').all();
  if (stableMusicXmlJson(integrity) !== stableMusicXmlJson([{ integrity_check: 'ok' }])) throw new Error('Song binding database integrity check failed');
  return database.prepare('SELECT song_id, source_digest, revision, bindings_json FROM song_input_bindings ORDER BY song_id').all().map(row);
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
      if (created) {
        database.exec('BEGIN IMMEDIATE');
        try {
          database.exec(`PRAGMA application_id = ${applicationId}; ${definitions.join(';')}; INSERT INTO song_binding_metadata VALUES (1, 1)`);
          database.exec('COMMIT');
        } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
      }
      validateDatabase(database);
      return new SongBindingAuthority(database);
    } catch (error) { database.close(); throw error; }
  }

  read(entry: InstalledSong): SongBindingRecord {
    const songId = Schema.decodeUnknownSync(id)(entry.id);
    const compiled = entry.installed.song.compiled;
    if (!compiled) throw new Error('Installed song has no canonical compiled program');
    const sourceDigest = Schema.decodeUnknownSync(digest)(compiled.source.digest);
    const value = this.database.prepare('SELECT song_id, source_digest, revision, bindings_json FROM song_input_bindings WHERE song_id = ?').get(songId);
    if (!value) return { songId, sourceDigest, revision: 0, bindings: decodeInputBindings(compiled.inputBindings ?? []) };
    const current = row(value);
    if (current.sourceDigest !== sourceDigest) throw new Error(`Saved bindings for ${songId} belong to another chart revision; explicitly migrate or reset them before loading this chart`);
    return current;
  }

  save(candidate: PreparedSongBindings, expectedRevision: number): SongBindingRecord {
    const songId = Schema.decodeUnknownSync(id)(candidate.songId);
    const sourceDigest = Schema.decodeUnknownSync(digest)(candidate.sourceDigest);
    const expected = Schema.decodeUnknownSync(revision)(expectedRevision);
    const bindings = decodeInputBindings(candidate.bindings);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const value = this.database.prepare('SELECT song_id, source_digest, revision, bindings_json FROM song_input_bindings WHERE song_id = ?').get(songId);
      const current = value ? row(value) : undefined;
      if (current && current.sourceDigest !== sourceDigest) throw new Error('Saved bindings belong to another chart revision; explicit migration is required');
      if ((current?.revision ?? 0) !== expected) throw new Error('Song bindings changed; reload the current assignment before saving');
      if (expected === Number.MAX_SAFE_INTEGER) throw new Error('Song binding revision exhausted');
      const next = expected + 1;
      this.database.prepare('INSERT INTO song_input_bindings (song_id, source_digest, revision, bindings_json) VALUES (?, ?, ?, ?) ON CONFLICT(song_id) DO UPDATE SET source_digest = excluded.source_digest, revision = excluded.revision, bindings_json = excluded.bindings_json')
        .run(songId, sourceDigest, next, JSON.stringify(bindings));
      const saved = row(this.database.prepare('SELECT song_id, source_digest, revision, bindings_json FROM song_input_bindings WHERE song_id = ?').get(songId));
      this.database.exec('COMMIT');
      return saved;
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }

  backup(destination: string): { readonly filename: string; readonly records: readonly SongBindingRecord[] } {
    const filename = canonicalPath(destination), parent = dirname(filename);
    const staging = mkdtempSync(join(parent, '.song-binding-backup-'));
    let published = false;
    try {
      const temporary = join(staging, 'bindings.sqlite');
      this.database.prepare('VACUUM INTO ?').run(temporary);
      chmodSync(temporary, 0o600);
      const records = verifySongBindingBackup(temporary);
      syncPath(temporary);
      linkSync(temporary, filename); published = true; syncPath(parent);
      return { filename, records };
    } finally {
      rmSync(staging, { recursive: true });
      if (published) syncPath(parent);
    }
  }

  close(): void { this.database.close(); }
}

export const openSongBindingAuthority = (filename: string) => SongBindingAuthority.open(filename);

export function verifySongBindingBackup(filename: string): readonly SongBindingRecord[] {
  const path = canonicalPath(filename); privateFile(path);
  const database = new DatabaseSync(path, { readOnly: true });
  try { return validateDatabase(database); } finally { database.close(); }
}

export function restoreSongBindingBackup(source: string, destination: string): readonly SongBindingRecord[] {
  const original = canonicalPath(source), target = canonicalPath(destination);
  verifySongBindingBackup(original);
  copyFileSync(original, target, constants.COPYFILE_EXCL);
  chmodSync(target, 0o600); syncPath(target); syncPath(dirname(target));
  return verifySongBindingBackup(target);
}
