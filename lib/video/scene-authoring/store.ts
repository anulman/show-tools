import { closeSync, existsSync, fsyncSync, linkSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { Schema } from 'effect';
import {
  AuthoringStampSchema, SceneAuthoringError, contentDigest, parseChartFacts, parseIngestRequest, parseInputId, parseOperatorInput,
  parseSceneDocument, parseSnapshot, parseSongId, parseStageDefinition, parseStageId,
  parseStageRequest, parseStageSnapshot, parseStamp,
} from './model.js';
import type { AuthoringStamp, ChartFacts, OperatorInput, SceneDocument, SongSnapshot, StageSnapshot } from './model.js';

const applicationId = 0x53434e45;
const schema = `
CREATE TABLE scene_metadata (id INTEGER PRIMARY KEY CHECK(id = 1), schema_version INTEGER NOT NULL CHECK(schema_version = 1), database_id TEXT NOT NULL, generation_id TEXT NOT NULL) STRICT;
CREATE TABLE scene_songs (song_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision >= 0), document_json TEXT NOT NULL) STRICT;
CREATE TABLE scene_inputs (song_id TEXT NOT NULL REFERENCES scene_songs(song_id), input_id TEXT NOT NULL, input_json TEXT NOT NULL, PRIMARY KEY(song_id,input_id)) STRICT;
CREATE TABLE scene_stages (stage_id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision > 0), digest TEXT NOT NULL, definition_json TEXT NOT NULL, PRIMARY KEY(stage_id,revision)) STRICT;
CREATE TABLE scene_receipts (scope TEXT NOT NULL, operation_id TEXT NOT NULL, request_digest TEXT NOT NULL, result_json TEXT NOT NULL, PRIMARY KEY(scope,operation_id)) STRICT;
`;

const receiptSchema = Schema.Union([
  Schema.Struct({ kind:Schema.Literal('song-write'),revision:AuthoringStampSchema.fields.revision }),
  Schema.Struct({ kind:Schema.Literal('stage-write'),revision:AuthoringStampSchema.fields.revision.check(Schema.isGreaterThan(0)) }),
]);
type WriteReceipt = typeof receiptSchema.Type;
const decodeReceipt = Schema.decodeUnknownSync(receiptSchema,{ onExcessProperty:'error' });
const normalizeSql = (sql: string) => sql.replace(/\s+/g,' ').trim().toLowerCase();

function failure(code: string, message: string, locations: string[] = []): never {
  throw new SceneAuthoringError(code,message,locations);
}
function absolutePath(raw: string): string {
  if (!isAbsolute(raw) || raw.includes('\0') || raw.endsWith(sep) || basename(raw) === '.' || basename(raw) === '..')
    failure('INVALID_DATABASE_PATH','Use an absolute path without NUL, a trailing separator or a final dot segment',[raw]);
  return raw;
}
function fileUri(filename: string, mode: 'ro'|'rw'): string {
  return pathToFileURL(realpathSync.native(absolutePath(filename))).href + '?mode=' + mode;
}
function newPath(raw: string): string {
  absolutePath(raw);
  return join(realpathSync.native(dirname(raw)),basename(raw));
}
function stringColumn(row: Record<string, unknown> | undefined, name: string): string {
  const value = row?.[name];
  if (typeof value !== 'string') failure('INVALID_SCENE_STORE',`Invalid scene database column ${name}`);
  return value;
}
function jsonColumn(row: Record<string, unknown> | undefined, name: string): unknown {
  return JSON.parse(stringColumn(row,name));
}
function same(first: unknown, second: unknown): boolean { return contentDigest(first) === contentDigest(second); }
function syncPath(path: string): void {
  const descriptor = openSync(path,'r');
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

export class SceneInitializationError extends Error {
  readonly code = 'SCENE_INITIALIZATION_UNCERTAIN';
  constructor(readonly filename: string, cause: unknown) {
    super(`Scene initialization did not complete; database retained at ${filename}: ${cause instanceof Error ? cause.message : String(cause)}`,{ cause });
    this.name = 'SceneInitializationError';
  }
}

export class SceneAuthoringStore {
  private closed = false;
  private constructor(private readonly database: DatabaseSync) {}

  static initialize(filename: string): SceneAuthoringStore {
    absolutePath(filename);
    if (existsSync(filename)) return SceneAuthoringStore.open(filename);
    mkdirSync(dirname(filename),{ recursive:true, mode:0o700 });
    const physical = newPath(filename);
    if (['-wal','-shm','-journal'].some(suffix => existsSync(physical+suffix)))
      failure('EXISTING_DATABASE_SIDECARS','Refusing to create a scene store beside existing SQLite sidecars',[physical]);
    let descriptor: number;
    try { descriptor = openSync(physical,'wx',0o600); }
    catch (error) {
      if (existsSync(physical)) return SceneAuthoringStore.open(physical);
      throw error;
    }
    closeSync(descriptor);
    let database: DatabaseSync | undefined;
    try {
      database = new DatabaseSync(fileUri(physical,'rw'),{ enableForeignKeyConstraints:true });
      database.exec(`PRAGMA synchronous = FULL; PRAGMA application_id = ${applicationId}; PRAGMA user_version = 1; BEGIN IMMEDIATE;`);
      database.exec(schema);
      database.prepare('INSERT INTO scene_metadata VALUES (1,1,?,?)').run(randomUUID(),randomUUID());
      database.exec('COMMIT');
      const result = new SceneAuthoringStore(database);
      result.transaction('BEGIN',() => result.validateContents());
      return result;
    } catch (error) {
      try { database?.close(); }
      catch (closeError) { throw new SceneInitializationError(physical,new AggregateError([error,closeError],'Initialization and connection cleanup failed')); }
      if (error instanceof SceneAuthoringError) throw error;
      throw new SceneInitializationError(physical,error);
    }
  }

  static open(filename: string): SceneAuthoringStore {
    const uri = fileUri(filename,'ro');
    let readOnly: DatabaseSync | undefined;
    try {
      readOnly = new DatabaseSync(uri,{ readOnly:true });
      const reader = new SceneAuthoringStore(readOnly);
      reader.transaction('BEGIN',() => reader.validateContents());
    } catch (error) {
      if (error instanceof SceneAuthoringError) throw error;
      if (error instanceof SyntaxError || error instanceof Error && 'errcode' in error && (error.errcode === 11 || error.errcode === 26))
        failure('INVALID_SCENE_STORE',`Cannot validate scene database: ${error.message}`,[filename]);
      throw error;
    } finally { readOnly?.close(); }
    const database = new DatabaseSync(fileUri(filename,'rw'),{ enableForeignKeyConstraints:true });
    try {
      database.exec('PRAGMA synchronous = FULL');
      const store = new SceneAuthoringStore(database);
      store.transaction('BEGIN',() => store.validateContents());
      return store;
    } catch (error) { database.close(); throw error; }
  }

  private transaction<T>(begin: 'BEGIN'|'BEGIN IMMEDIATE', operation: () => T): T {
    this.database.exec(begin);
    try {
      this.validateSchema();
      const result = operation(); this.database.exec('COMMIT'); return result;
    } catch (error) {
      if (this.database.isTransaction) {
        try { this.database.exec('ROLLBACK'); }
        catch (rollbackError) { throw new AggregateError([error,rollbackError],'Scene transaction and rollback failed'); }
      }
      throw error;
    }
  }

  private identity(revision: unknown): AuthoringStamp {
    const metadata = this.database.prepare('SELECT * FROM scene_metadata WHERE id = 1').get();
    return parseStamp({ databaseId:metadata?.database_id, generationId:metadata?.generation_id, revision });
  }
  private assertIdentity(base: AuthoringStamp): void {
    const current = this.identity(base.revision);
    if (base.databaseId !== current.databaseId || base.generationId !== current.generationId)
      failure('STORE_IDENTITY_CONFLICT','The scene database identity or restore generation changed');
  }
  private assertRevision(expected: number, actual: number, location: string): void {
    if (expected !== actual) failure('REVISION_CONFLICT',`Expected revision ${expected}; current revision is ${actual}`,[location]);
  }
  private nextRevision(current: number): number {
    if (current === Number.MAX_SAFE_INTEGER) failure('REVISION_EXHAUSTED','Scene revision cannot advance safely');
    return current+1;
  }
  private validateSchema(): void {
    const objects = this.database.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    const expected = schema.split(';').map(sql => sql.trim()).filter(Boolean);
    if (objects.length !== expected.length || objects.some(row => row.type !== 'table')
      || expected.some(sql => !objects.some(row => typeof row.sql === 'string' && normalizeSql(row.sql) === normalizeSql(sql))))
      failure('UNSUPPORTED_SCENE_STORE_SCHEMA','Unsupported scene-authoring SQL schema or additional schema objects');
    if (this.database.prepare('PRAGMA application_id').get()?.application_id !== applicationId
      || this.database.prepare('PRAGMA user_version').get()?.user_version !== 1)
      failure('UNSUPPORTED_SCENE_STORE_SCHEMA','Unsupported scene-authoring database version');
  }

  private validateContents(): void {
    if (this.database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok'
      || this.database.prepare('PRAGMA foreign_key_check').all().length)
      failure('INVALID_SCENE_STORE','Scene database integrity checks failed');
    const metadata = this.database.prepare('SELECT * FROM scene_metadata').all();
    if (metadata.length !== 1 || metadata[0]?.schema_version !== 1) failure('INVALID_SCENE_STORE','Invalid scene database metadata');
    this.identity(0);
    for (const row of this.database.prepare('SELECT * FROM scene_songs').all()) {
      const songId = parseSongId(row.song_id);
      this.capture(songId);
    }
    for (const row of this.database.prepare('SELECT * FROM scene_inputs').all()) {
      parseSongId(row.song_id);
      const input = parseOperatorInput(jsonColumn(row,'input_json'));
      if (input.id !== row.input_id) failure('INVALID_SCENE_STORE','Stored input identity does not match its row');
    }
    for (const row of this.database.prepare('SELECT * FROM scene_stages').all()) this.stageFromRow(row);
    for (const row of this.database.prepare('SELECT * FROM scene_receipts').all()) this.validatedReceipt(row);
  }

  private validatedReceipt(row: Record<string,unknown>): WriteReceipt {
    const scope = stringColumn(row,'scope');
    parseInputId(row.operation_id);
    if (!/^[a-f0-9]{64}$/.test(stringColumn(row,'request_digest'))) failure('INVALID_SCENE_STORE','Invalid operation receipt digest');
    let receipt: WriteReceipt;
    try { receipt = decodeReceipt(jsonColumn(row,'result_json')); }
    catch (error) { failure('INVALID_SCENE_STORE',`Invalid compact operation receipt: ${error instanceof Error ? error.message : String(error)}`,[scope]); }
    if (scope.startsWith('song:')) {
      const songId = parseSongId(scope.slice(5));
      const current = this.database.prepare('SELECT revision FROM scene_songs WHERE song_id = ?').get(songId);
      if (receipt.kind !== 'song-write' || !current || receipt.revision > this.identity(current.revision).revision)
        failure('INVALID_SCENE_STORE','Song operation receipt does not match its scope or current revision',[scope]);
    } else if (scope.startsWith('stage:')) {
      const stageId = parseStageId(scope.slice(6));
      if (receipt.kind !== 'stage-write' || !this.database.prepare('SELECT 1 FROM scene_stages WHERE stage_id = ? AND revision = ?').get(stageId,receipt.revision))
        failure('INVALID_SCENE_STORE','Stage operation receipt does not identify an immutable stage version',[scope]);
    } else failure('INVALID_SCENE_STORE','Invalid operation receipt scope',[scope]);
    return receipt;
  }

  private capture(songId: string): SongSnapshot {
    const row = this.database.prepare('SELECT * FROM scene_songs WHERE song_id = ?').get(songId);
    const document = row ? parseSceneDocument(jsonColumn(row,'document_json')) : parseSceneDocument({ songId,chart:{ kind:'unbound' },scenes:[] });
    if (document.songId !== songId) failure('INVALID_SCENE_STORE','Stored song identity does not match its row',[songId]);
    const stamp = this.identity(row ? row.revision : 0);
    const inputs = this.database.prepare('SELECT input_json FROM scene_inputs WHERE song_id = ? ORDER BY input_id').all(songId)
      .map(item => parseOperatorInput(jsonColumn(item,'input_json')));
    const knownInputs = new Set(inputs.map(input => input.id));
    const stages = new Map<string,StageSnapshot>();
    for (const scene of document.scenes) {
      for (const id of scene.sourceInputIds) if (!knownInputs.has(id)) failure('INVALID_SCENE_STORE','Scene references a missing same-song input',[songId,scene.id,id]);
      if (scene.stage.kind === 'reference') {
        const stage = this.getStage(scene.stage.id,scene.stage.revision);
        if (stage) stages.set(`${stage.definition.id}:${stage.revision}`,stage);
      }
    }
    return parseSnapshot({ stamp,document,inputs,stages:[...stages.values()],review:{ kind:'draft' },runtime:{ kind:'not-admitted' } });
  }
  read(songId: string): SongSnapshot {
    const id = parseSongId(songId);
    return this.transaction('BEGIN',() => this.capture(id));
  }

  private receipt(scope: string, operationId: string, digest: string): WriteReceipt | undefined {
    const row = this.database.prepare('SELECT * FROM scene_receipts WHERE scope = ? AND operation_id = ?').get(scope,operationId);
    if (!row) return undefined;
    if (row.request_digest !== digest) failure('OPERATION_ID_CONFLICT','This operation ID was already used for different content',[scope,operationId]);
    return this.validatedReceipt(row);
  }
  private record(scope: string, operationId: string, digest: string, result: WriteReceipt): void {
    this.database.prepare('INSERT INTO scene_receipts VALUES (?,?,?,?)').run(scope,operationId,digest,JSON.stringify(result));
  }
  private writeSong(document: SceneDocument, revision: number): void {
    this.database.prepare('INSERT INTO scene_songs VALUES (?,?,?) ON CONFLICT(song_id) DO UPDATE SET revision=excluded.revision,document_json=excluded.document_json')
      .run(document.songId,revision,JSON.stringify(document));
  }
  ingest(input: unknown): { kind:'saved'|'unchanged'; snapshot:SongSnapshot; operationRevision:number } {
    const request = parseIngestRequest(input), digest = contentDigest(request), scope = 'song:'+request.songId;
    return this.transaction('BEGIN IMMEDIATE',() => {
      this.assertIdentity(request.base);
      const previous = this.receipt(scope,request.operationId,digest);
      if (previous !== undefined) return { kind:'unchanged',snapshot:this.capture(request.songId),operationRevision:previous.revision };
      const current = this.capture(request.songId);
      this.assertRevision(request.base.revision,current.stamp.revision,request.songId);
      let selected: OperatorInput;
      let newInput = false;
      if (request.input.kind === 'new') {
        selected = request.input.value;
        const existing = current.inputs.find(item => item.id === selected.id);
        if (existing && !same(existing,selected)) failure('IMMUTABLE_OPERATOR_INPUT','An input ID cannot replace its original operator text or origin',[request.songId,selected.id]);
        newInput = !existing;
      } else {
        const inputId = request.input.id;
        const existing = current.inputs.find(item => item.id === inputId);
        if (!existing) failure('UNKNOWN_OPERATOR_INPUT','The selected input does not exist in this song',[request.songId,request.input.id]);
        selected = existing;
      }
      const inputIds = new Set([...current.inputs.map(item => item.id),selected.id]);
      const scenes = new Map(current.document.scenes.map(scene => [scene.id,scene]));
      for (const scene of request.scenes) {
        const earlier = scenes.get(scene.id);
        const sourceInputIds = [...new Set([...(earlier?.sourceInputIds ?? []),...scene.sourceInputIds,selected.id])];
        for (const id of sourceInputIds) if (!inputIds.has(id)) failure('UNKNOWN_OPERATOR_INPUT','A scene source input is not stored in this song',[request.songId,scene.id,id]);
        scenes.set(scene.id,{ ...scene,sourceInputIds });
      }
      const document = parseSceneDocument({ ...current.document,scenes:[...scenes.values()] });
      const changed = newInput || !same(document,current.document);
      if (changed) {
        this.writeSong(document,this.nextRevision(current.stamp.revision));
        if (newInput) this.database.prepare('INSERT INTO scene_inputs VALUES (?,?,?)').run(request.songId,selected.id,JSON.stringify(selected));
      }
      const snapshot = this.capture(request.songId);
      this.record(scope,request.operationId,digest,{ kind:'song-write',revision:snapshot.stamp.revision });
      return { kind:changed?'saved':'unchanged',snapshot,operationRevision:snapshot.stamp.revision };
    });
  }

  bindChart(input: { songId:string; base:AuthoringStamp; chart:ChartFacts }): SongSnapshot {
    const songId = parseSongId(input.songId), base = parseStamp(input.base), chart = parseChartFacts(input.chart);
    if (songId !== chart.songId) failure('CHART_SONG_MISMATCH','The MusicXML chart belongs to another song',[songId,chart.songId]);
    return this.transaction('BEGIN IMMEDIATE',() => {
      this.assertIdentity(base);
      const current = this.capture(songId);
      this.assertRevision(base.revision,current.stamp.revision,songId);
      const document = parseSceneDocument({ ...current.document,chart:{ kind:'bound',...chart } });
      if (!same(document,current.document)) this.writeSong(document,this.nextRevision(current.stamp.revision));
      return this.capture(songId);
    });
  }

  private stageFromRow(row: Record<string,unknown>): StageSnapshot {
    const definition = parseStageDefinition(jsonColumn(row,'definition_json'));
    const stage = parseStageSnapshot({ definition,revision:row.revision,digest:row.digest });
    if (definition.id !== row.stage_id || contentDigest(definition) !== stage.digest) failure('INVALID_SCENE_STORE','Stored stage content does not match its identity or digest');
    return stage;
  }
  private getStage(id: string, revision?: number): StageSnapshot | null {
    const row = revision === undefined
      ? this.database.prepare('SELECT * FROM scene_stages WHERE stage_id = ? ORDER BY revision DESC LIMIT 1').get(id)
      : this.database.prepare('SELECT * FROM scene_stages WHERE stage_id = ? AND revision = ?').get(id,revision);
    return row ? this.stageFromRow(row) : null;
  }
  readStage(id: string, revision?: number): StageSnapshot | null {
    const stageId = parseStageId(id);
    if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) failure('INVALID_STAGE_REVISION','Stage revision must be a positive safe integer',[stageId]);
    return this.transaction('BEGIN',() => this.getStage(stageId,revision));
  }
  saveStage(input: unknown): StageSnapshot {
    const request = parseStageRequest(input), digest = contentDigest(request), id = request.definition.id, scope = 'stage:'+id;
    return this.transaction('BEGIN IMMEDIATE',() => {
      this.assertIdentity(request.base);
      const previous = this.receipt(scope,request.operationId,digest);
      if (previous !== undefined) {
        const original = this.getStage(id,previous.revision);
        if (!original) failure('INVALID_SCENE_STORE','Stage receipt refers to an absent immutable version',[id]);
        return original;
      }
      const current = this.getStage(id);
      this.assertRevision(request.base.revision,current?.revision ?? 0,id);
      let snapshot = current;
      const definitionDigest = contentDigest(request.definition);
      if (!current || current.digest !== definitionDigest) {
        const revision = this.nextRevision(current?.revision ?? 0);
        this.database.prepare('INSERT INTO scene_stages VALUES (?,?,?,?)').run(id,revision,definitionDigest,JSON.stringify(request.definition));
        snapshot = parseStageSnapshot({ definition:request.definition,revision,digest:definitionDigest });
      }
      if (!snapshot) failure('INVALID_SCENE_STORE','Stage save did not produce a snapshot',[id]);
      this.record(scope,request.operationId,digest,{ kind:'stage-write',revision:snapshot.revision });
      return snapshot;
    });
  }

  private snapshotDirectory(destination: string): string {
    const directory = newPath(destination);
    const main = this.database.prepare('PRAGMA database_list').all().find(row => row.name === 'main');
    const source = realpathSync.native(stringColumn(main,'file'));
    const sourceIdentity = statSync(source);
    const compare = (path: string) => process.platform === 'darwin' ? path.toLowerCase() : path;
    for (const suffix of ['','-journal','-wal','-shm']) {
      if (suffix && !compare(directory).endsWith(suffix)) continue;
      const candidate = suffix ? directory.slice(0,-suffix.length) : directory;
      const candidateIdentity = existsSync(candidate) ? statSync(candidate) : null;
      if (compare(candidate) === compare(source) || candidateIdentity
        && candidateIdentity.dev === sourceIdentity.dev && candidateIdentity.ino === sourceIdentity.ino) {
        failure('SNAPSHOT_DATABASE_NAMESPACE','Snapshot destination cannot occupy the live database or its SQLite sidecar namespace',[directory,source]);
      }
    }
    return directory;
  }

  snapshot(destinationDirectory: string): { filename:string } {
    const directory = this.snapshotDirectory(destinationDirectory), parent = dirname(directory);
    mkdirSync(directory,{ mode:0o700 });
    const filename = join(directory,'scene-authoring.sqlite');
    let staging: string | undefined;
    let published = false;
    try {
      staging = mkdtempSync(join(directory,'.scene-snapshot-'));
      const temporary = join(staging,'scene-authoring.sqlite');
      this.database.prepare('VACUUM INTO ?').run(temporary);
      const check = SceneAuthoringStore.open(temporary); check.close();
      syncPath(temporary); linkSync(temporary,filename); published=true;
      rmSync(staging,{ recursive:true }); staging=undefined;
      syncPath(directory); syncPath(parent);
      return { filename };
    } catch (error) {
      try {
        if (staging !== undefined) rmSync(staging,{ recursive:true });
        if (!published) rmdirSync(directory);
      } catch (cleanupError) { throw new AggregateError([error,cleanupError],'Scene snapshot failed and cleanup was incomplete'); }
      throw error;
    }
  }
  close(): void { if (!this.closed) { this.database.close(); this.closed=true; } }
}
