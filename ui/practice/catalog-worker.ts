/// <reference lib="webworker" />
import { Schema } from 'effect';
import initSqlJs, { type SqlJsStatic } from 'sql.js';

declare const self: DedicatedWorkerGlobalScope;
import { VoiceCatalogSqlite, RevisionConflictError } from '../../lib/voice-catalog/sqlite.js';
import { CatalogRequestSchema, CatalogResponseSchema, type CatalogRequest, type CatalogResponse } from './catalog-client.js';

const storeName = 'catalog';
const recordKey = 'current';
const DurableRecordSchema = Schema.Struct({
  revision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  bytes: Schema.instanceOf(Uint8Array),
});
const decodeRecord = Schema.decodeUnknownSync(DurableRecordSchema);
type DurableRecord = typeof DurableRecordSchema.Type;

export function openCatalogDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open('show-tools-voice-catalog', 1);
    let rejected = false;
    request.onupgradeneeded = () => { request.result.createObjectStore(storeName); };
    request.onerror = () => reject(new Error('Could not open the local voice library.', { cause: request.error }));
    request.onblocked = () => { rejected = true; reject(new Error('Voice library upgrade is blocked by another tab. Close other practice desk tabs and reload.')); };
    request.onsuccess = () => {
      const database = request.result;
      if (rejected) { database.close(); return; }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

export function readDurableCatalog(database: IDBDatabase): Promise<DurableRecord | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(recordKey);
    let record: DurableRecord | undefined;
    let failure: unknown;
    request.onsuccess = () => {
      try { record = request.result === undefined ? undefined : decodeRecord(request.result); }
      catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve(record);
    transaction.onabort = () => reject(new Error('Could not read the local voice library.', { cause: failure ?? transaction.error }));
    transaction.onerror = () => { failure ??= transaction.error; };
  });
}

export function persistDurableCatalog(database: IDBDatabase, record: DurableRecord, expectedRevision: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, 'readwrite', { durability: 'strict' });
    const store = transaction.objectStore(storeName);
    const request = store.get(recordKey);
    let failure: unknown;
    request.onsuccess = () => {
      try {
        const current = request.result === undefined ? undefined : decodeRecord(request.result);
        const actualRevision = current?.revision ?? 0;
        if (actualRevision !== expectedRevision) throw new RevisionConflictError(expectedRevision, actualRevision);
        store.put(record, recordKey);
      } catch (error) { failure = error; transaction.abort(); }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(failure instanceof RevisionConflictError ? failure : new Error('Voice library was not saved. Local storage rejected the write.', { cause: failure ?? transaction.error }));
    transaction.onerror = () => { failure ??= transaction.error; };
  });
}

export class DurableVoiceCatalog {
  private constructor(private readonly sql: SqlJsStatic, private readonly database: IDBDatabase, private catalog: VoiceCatalogSqlite) {}

  static async open(sql: SqlJsStatic, database: IDBDatabase): Promise<DurableVoiceCatalog> {
    const record = await readDurableCatalog(database);
    const catalog = VoiceCatalogSqlite.open(sql, record?.bytes);
    if (record && catalog.snapshot().revision !== record.revision) { catalog.close(); throw new Error('Voice library storage revision does not match its database.'); }
    return new DurableVoiceCatalog(sql, database, catalog);
  }

  private async refresh(): Promise<void> {
    const record = await readDurableCatalog(this.database);
    const next = VoiceCatalogSqlite.open(this.sql, record?.bytes);
    if (record && next.snapshot().revision !== record.revision) { next.close(); throw new Error('Voice library storage revision does not match its database.'); }
    this.catalog.close();
    this.catalog = next;
  }

  async handle(request: CatalogRequest): Promise<CatalogResponse> {
    await this.refresh();
    if (request.command === 'snapshot') return { id: request.id, ok: true, command: 'snapshot', document: this.catalog.snapshot() };
    if (request.command === 'export') return { id: request.id, ok: true, command: 'export', bytes: new Uint8Array(this.catalog.exportBytes()) };
    const before = this.catalog.exportBytes();
    try {
      const document = this.catalog.replace(request.document, request.expectedRevision);
      await persistDurableCatalog(this.database, { revision: document.revision, bytes: new Uint8Array(this.catalog.exportBytes()) }, request.expectedRevision);
      return { id: request.id, ok: true, command: 'replace', document };
    } catch (error) {
      this.catalog.close();
      this.catalog = VoiceCatalogSqlite.open(this.sql, before);
      if (error instanceof RevisionConflictError) await this.refresh();
      throw error;
    }
  }

  close(): void { this.catalog.close(); this.database.close(); }
}

if (typeof self !== 'undefined' && typeof document === 'undefined') {
  const worker = self;
  const decodeRequest = Schema.decodeUnknownSync(CatalogRequestSchema);
  const decodeResponse = Schema.decodeUnknownSync(CatalogResponseSchema);
  let catalog: Promise<DurableVoiceCatalog> | undefined;
  let queue = Promise.resolve();
  worker.onmessage = (event: MessageEvent<unknown>) => {
    queue = queue.then(async () => {
      let request: CatalogRequest;
      try { request = decodeRequest(event.data); }
      catch (error) { worker.reportError(new Error('Invalid voice library request.', { cause: error })); return; }
      try {
        catalog ??= (async () => {
          const sql = await initSqlJs({ locateFile: () => new URL('./wasm/sql-wasm.wasm', import.meta.url).href });
          const database = await openCatalogDatabase(indexedDB);
          try { return await DurableVoiceCatalog.open(sql, database); }
          catch (error) { database.close(); throw error; }
        })();
        const response = decodeResponse(await (await catalog).handle(request));
        worker.postMessage(response);
      } catch (error) {
        const response: CatalogResponse = { id: request.id, ok: false, message: error instanceof Error ? error.message : 'Voice library operation failed.', conflict: error instanceof RevisionConflictError };
        worker.postMessage(response);
      }
    }).catch(error => worker.reportError(error));
  };
}
