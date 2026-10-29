import { Schema } from 'effect';
import { CatalogDocumentSchema, parseCatalogDocument, type CatalogDocument } from '../../lib/voice-catalog/model.js';

const revision = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }));
const requestId = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }));
export const CatalogRequestSchema = Schema.Union([
  Schema.Struct({ id: requestId, command: Schema.Literal('snapshot') }),
  Schema.Struct({ id: requestId, command: Schema.Literal('replace'), document: CatalogDocumentSchema, expectedRevision: revision }),
  Schema.Struct({ id: requestId, command: Schema.Literal('export') }),
]);
export const CatalogResponseSchema = Schema.Union([
  Schema.Struct({ id: requestId, ok: Schema.Literal(true), command: Schema.Literals(['snapshot', 'replace']), document: CatalogDocumentSchema }),
  Schema.Struct({ id: requestId, ok: Schema.Literal(true), command: Schema.Literal('export'), bytes: Schema.instanceOf(Uint8Array) }),
  Schema.Struct({ id: requestId, ok: Schema.Literal(false), message: Schema.NonEmptyString, conflict: Schema.Boolean }),
]);
export type CatalogRequest = typeof CatalogRequestSchema.Type;
export type CatalogResponse = typeof CatalogResponseSchema.Type;
export interface CatalogClient {
  snapshot(): Promise<CatalogDocument>;
  replace(document: CatalogDocument, expectedRevision: number): Promise<CatalogDocument>;
  exportBytes(): Promise<Uint8Array>;
  close(): void;
}
export class CatalogClientConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'CatalogClientConflictError'; }
}

export async function createCatalogClient(): Promise<CatalogClient> {
  const worker = new Worker(new URL('./catalog-worker.js', document.baseURI), { type: 'module' });
  let nextId = 1;
  let unavailable: Error | undefined;
  const pending = new Map<number, { resolve(response: CatalogResponse): void; reject(error: Error): void }>();
  const decodeResponse = Schema.decodeUnknownSync(CatalogResponseSchema);
  function stop(error: Error): void {
    if (unavailable) return;
    unavailable = error;
    worker.terminate();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  worker.onmessage = (event: MessageEvent<unknown>) => {
    try {
      const response = decodeResponse(event.data);
      const request = pending.get(response.id);
      if (!request) throw new Error('Voice library returned an unexpected response.');
      pending.delete(response.id);
      if (!response.ok) request.reject(response.conflict ? new CatalogClientConflictError(response.message) : new Error(response.message));
      else request.resolve(response);
    } catch (error) { stop(new Error('Voice library response could not be read.', { cause: error })); }
  };
  worker.onerror = event => { event.preventDefault(); stop(new Error(`Voice library worker failed${event.message ? `: ${event.message}` : '.'}`)); };
  worker.onmessageerror = () => stop(new Error('Voice library worker response could not be transferred.'));
  function request(message: CatalogRequest): Promise<CatalogResponse> {
    if (unavailable) return Promise.reject(unavailable);
    return new Promise((resolve, reject) => {
      pending.set(message.id, { resolve, reject });
      try { worker.postMessage(message); }
      catch (error) { pending.delete(message.id); reject(new Error('Voice library request could not be sent.', { cause: error })); }
    });
  }
  const client: CatalogClient = {
    async snapshot() {
      const response = await request({ id: nextId++, command: 'snapshot' });
      if (!response.ok || response.command !== 'snapshot') throw new Error('Unexpected voice library snapshot response.');
      return response.document;
    },
    async replace(document, expectedRevision) {
      const message = Schema.decodeUnknownSync(CatalogRequestSchema)({ id: nextId++, command: 'replace', document: parseCatalogDocument(document), expectedRevision });
      const response = await request(message);
      if (!response.ok || response.command !== 'replace') throw new Error('Unexpected voice library save response.');
      return response.document;
    },
    async exportBytes() {
      const response = await request({ id: nextId++, command: 'export' });
      if (!response.ok || response.command !== 'export') throw new Error('Unexpected voice library backup response.');
      return response.bytes;
    },
    close() { stop(new Error('Voice library client is closed.')); },
  };
  try { await client.snapshot(); return client; }
  catch (error) { client.close(); throw error; }
}
