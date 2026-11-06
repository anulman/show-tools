import { closeSync, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmdirSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Schema } from 'effect';
import { makeCatalogSnapshot, parseCatalogBody, parseCatalogStamp, sameCatalogBody, sameCatalogStamp } from './authority-model.js';
import type { CatalogSaveResult, CatalogSnapshot, CatalogStamp } from './authority-model.js';
import { readCanonicalCatalog } from './sql-reader.js';

type CapturedCatalog = ReturnType<typeof readCanonicalCatalog>;
type CapturedResult = { readonly kind: 'current' | 'conflict'; readonly catalog: CapturedCatalog };
const parsePath = Schema.decodeUnknownSync(Schema.NonEmptyString
  .check(Schema.makeFilter(path => !path.includes('\u0000') || 'Native catalog paths must not contain NUL'))
  .check(Schema.makeFilter(path => isAbsolute(path) || 'A native catalog requires an absolute filesystem path')));

function uri(filename: string, mode: 'ro' | 'rw'): string {
  return pathToFileURL(realpathSync.native(parsePath(filename))).href + '?mode=' + mode;
}

function snapshotDirectory(destination: string): string {
  const raw = parsePath(destination), leaf = basename(raw);
  if (!leaf || leaf === '.' || leaf === '..' || raw.endsWith(sep) || sep === '\\' && raw.endsWith('/'))
    throw new Error('A catalog snapshot requires a new directory name without a trailing separator or dot segment');
  return join(realpathSync.native(dirname(raw)), leaf);
}

function syncPath(filename: string): void {
  const descriptor = openSync(filename, 'r');
  try { fsyncSync(descriptor); }
  finally { closeSync(descriptor); }
}

function copiedCatalog(filename: string): CapturedCatalog {
  const database = new DatabaseSync(uri(filename, 'ro'), { readOnly: true });
  try { return readCanonicalCatalog({ all: sql => database.prepare(sql).all() }); }
  finally { database.close(); }
}

export class NativeCatalogAuthority {
  private constructor(private readonly database: DatabaseSync) {}

  static open(filename: string): NativeCatalogAuthority {
    const database = new DatabaseSync(uri(filename, 'rw'), { enableForeignKeyConstraints: true });
    try {
      if (typeof database.isTransaction !== 'boolean') throw new Error('Native catalog requires SQLite transaction-state support');
      database.exec('PRAGMA synchronous = FULL');
      const authority = new NativeCatalogAuthority(database);
      authority.transaction('BEGIN', () => ({ kind: 'current', catalog: authority.capture() }));
      return authority;
    } catch (error) { database.close(); throw error; }
  }

  private capture(): CapturedCatalog {
    return readCanonicalCatalog({ all: sql => this.database.prepare(sql).all() });
  }

  private transaction(begin: 'BEGIN' | 'BEGIN IMMEDIATE', operation: () => CapturedResult): CapturedResult {
    this.database.exec(begin);
    try {
      const result = operation();
      this.database.exec('COMMIT');
      return result;
    } catch (error) {
      if (this.database.isTransaction) {
        try { this.database.exec('ROLLBACK'); }
        catch (rollbackError) { throw new AggregateError([error, rollbackError], 'Catalog transaction and rollback failed'); }
      }
      throw error;
    }
  }

  async read(): Promise<CatalogSnapshot> {
    const { catalog } = this.transaction('BEGIN', () => ({ kind: 'current', catalog: this.capture() }));
    return makeCatalogSnapshot(catalog.stamp, catalog.body);
  }

  async replace(base: CatalogStamp, desired: unknown): Promise<CatalogSaveResult> {
    const expected = parseCatalogStamp(base), body = parseCatalogBody(desired);
    const result = this.transaction('BEGIN IMMEDIATE', () => {
      const current = this.capture();
      if (expected.catalogId !== current.stamp.catalogId || expected.generationId !== current.stamp.generationId)
        return { kind: 'conflict', catalog: current };
      if (sameCatalogBody(current.body, body)) return { kind: 'current', catalog: current };
      if (!sameCatalogStamp(expected, current.stamp)) return { kind: 'conflict', catalog: current };
      if (current.stamp.revision === Number.MAX_SAFE_INTEGER) throw new Error('Canonical catalog revision exhausted');
      const stamp = { ...current.stamp, revision: current.stamp.revision + 1 };
      this.database.exec('DELETE FROM sheet_bindings; DELETE FROM voice_effects; DELETE FROM voices;');
      const voice = this.database.prepare('INSERT INTO voices VALUES (?, ?, ?, ?, ?)');
      const effect = this.database.prepare('INSERT INTO voice_effects VALUES (?, ?, ?)');
      for (const item of body.voices) {
        voice.run(item.id, item.name, item.notes, item.characterId, item.avatarToken);
        for (const [ordinal, stage] of item.effects.entries()) effect.run(item.id, ordinal, JSON.stringify(stage));
      }
      const binding = this.database.prepare('INSERT INTO sheet_bindings VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const item of body.bindings) binding.run(item.spreadsheetId, item.sheetId, item.labelCell, item.sourceLabel,
        item.voiceId, item.cueRow?.labelCell ?? null, item.cueRow?.sourceLabel ?? null);
      this.database.prepare('UPDATE catalog_metadata SET revision = ? WHERE id = 1').run(stamp.revision);
      return { kind: 'current', catalog: { stamp, body } };
    });
    const snapshot = await makeCatalogSnapshot(result.catalog.stamp, result.catalog.body);
    return result.kind === 'current' ? { kind: 'current', snapshot } : { kind: 'conflict', current: snapshot };
  }

  async snapshot(destinationDirectory: string): Promise<{ readonly filename: string; readonly snapshot: CatalogSnapshot }> {
    const directory = snapshotDirectory(destinationDirectory), parent = dirname(directory);
    mkdirSync(directory, { mode: 0o700 });
    const filename = join(directory, 'catalog.sqlite');
    let staging: string | undefined;
    let published = false;
    try {
      staging = mkdtempSync(join(directory, '.catalog-snapshot-'));
      const temporary = join(staging, 'catalog.sqlite');
      this.database.prepare('VACUUM INTO ?').run(temporary);
      const captured = copiedCatalog(temporary);
      syncPath(temporary);
      const snapshot = await makeCatalogSnapshot(captured.stamp, captured.body);
      linkSync(temporary, filename);
      published = true;
      rmSync(staging, { recursive: true });
      staging = undefined;
      syncPath(directory);
      syncPath(parent);
      return { filename, snapshot };
    } catch (error) {
      try {
        if (staging !== undefined) rmSync(staging, { recursive: true });
        if (!published) rmdirSync(directory);
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Catalog snapshot failed and cleanup was incomplete');
      }
      throw error;
    }
  }

  close(): void { this.database.close(); }
}
