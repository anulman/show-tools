import { Schema } from 'effect';
import { CatalogDocumentSchema, canonicalCatalog, parseCatalogDocument } from './model.js';

const BodySchema = Schema.Struct({
  voices: CatalogDocumentSchema.fields.voices,
  bindings: CatalogDocumentSchema.fields.bindings,
});
export type CatalogBody = typeof BodySchema.Type;

export const CatalogStampSchema = Schema.Struct({
  catalogId: Schema.NonEmptyString,
  generationId: Schema.NonEmptyString,
  revision: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
});
export type CatalogStamp = typeof CatalogStampSchema.Type;
export const parseCatalogStamp = Schema.decodeUnknownSync(CatalogStampSchema);

const SnapshotSchema = Schema.Struct({
  schemaVersion: Schema.Literal(3),
  stamp: CatalogStampSchema,
  digest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  body: BodySchema,
});
export type CatalogSnapshot = typeof SnapshotSchema.Type;
export type CatalogSaveResult = { readonly kind: 'current'; readonly snapshot: CatalogSnapshot }
  | { readonly kind: 'conflict'; readonly current: CatalogSnapshot };

const decodeBody = Schema.decodeUnknownSync(BodySchema);
const decodeSnapshot = Schema.decodeUnknownSync(SnapshotSchema);

export function parseCatalogBody(input: unknown): CatalogBody {
  const body = decodeBody(input);
  const document = canonicalCatalog(parseCatalogDocument({ ...body, version: 2, revision: 0 }));
  return structuredClone({ voices: document.voices, bindings: document.bindings });
}

export function canonicalBodyJson(body: CatalogBody): string {
  const document = canonicalCatalog({ ...body, version: 2, revision: 0 });
  return sortedJson({ voices: document.voices, bindings: document.bindings });
}

function sortedJson(value: Schema.Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(sortedJson).join(',') + ']';
  const entries: (readonly [string, Schema.Json])[] = Object.entries(value);
  entries.sort(([first], [second]) => first < second ? -1 : first > second ? 1 : 0);
  return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + sortedJson(item)).join(',') + '}';
}

export function sameCatalogBody(first: CatalogBody, second: CatalogBody): boolean {
  return canonicalBodyJson(first) === canonicalBodyJson(second);
}

export function sameCatalogStamp(first: CatalogStamp, second: CatalogStamp): boolean {
  return first.catalogId === second.catalogId && first.generationId === second.generationId && first.revision === second.revision;
}

export async function digestCatalogBody(body: CatalogBody): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalBodyJson(body));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

export async function makeCatalogSnapshot(stamp: CatalogStamp, body: CatalogBody): Promise<CatalogSnapshot> {
  const identity = structuredClone(parseCatalogStamp(stamp));
  const canonical = parseCatalogBody(body);
  const digest = await digestCatalogBody(canonical);
  return { schemaVersion: 3, stamp: identity, digest, body: canonical };
}

export async function parseCatalogSnapshot(input: unknown): Promise<CatalogSnapshot> {
  const snapshot = decodeSnapshot(input);
  const verified = await makeCatalogSnapshot(snapshot.stamp, snapshot.body);
  if (snapshot.digest !== verified.digest) throw new Error('Catalog snapshot content does not match its digest');
  return verified;
}
