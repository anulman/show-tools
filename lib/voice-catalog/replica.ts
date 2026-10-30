import { Schema } from 'effect';
import { digestCatalogBody, parseCatalogBody, sameCatalogBody, sameCatalogStamp } from './authority-model.js';
import type { CatalogBody, CatalogSaveResult, CatalogSnapshot, CatalogStamp } from './authority-model.js';

type WorkingCopy = { readonly replicaId: string; readonly localRevision: number; readonly body: CatalogBody };
export type CatalogSyncRequest = { readonly attemptId: number; readonly base: CatalogStamp; readonly body: CatalogBody };
export type CatalogReplica = WorkingCopy & (
  | { readonly kind: 'unlinked' }
  | { readonly kind: 'ready'; readonly base: CatalogSnapshot }
  | { readonly kind: 'sending' | 'uncertain'; readonly base: CatalogSnapshot; readonly request: CatalogSyncRequest }
  | { readonly kind: 'conflict'; readonly base: CatalogSnapshot | null; readonly remote: CatalogSnapshot }
);
export class CatalogReplicaRevisionError extends Error {
  constructor(readonly expectedRevision: number, readonly actualRevision: number) {
    super(`Catalog replica changed: expected revision ${expectedRevision}, found ${actualRevision}`);
    this.name = 'CatalogReplicaRevisionError';
  }
}

const parseReplicaId = Schema.decodeUnknownSync(Schema.NonEmptyString);
function expectRevision(state: CatalogReplica, expected: number): void {
  if (state.localRevision !== expected) throw new CatalogReplicaRevisionError(expected, state.localRevision);
}
function nextRevision(state: CatalogReplica): number {
  if (state.localRevision === Number.MAX_SAFE_INTEGER) throw new Error('Catalog replica revision exhausted');
  return state.localRevision + 1;
}
function sameGeneration(first: CatalogStamp, second: CatalogStamp): boolean {
  return first.catalogId === second.catalogId && first.generationId === second.generationId;
}
function checkSnapshotOrder(previous: CatalogSnapshot, next: CatalogSnapshot): void {
  if (!sameGeneration(previous.stamp, next.stamp)) return;
  if (next.stamp.revision < previous.stamp.revision) throw new Error('Canonical catalog revision moved backward');
  if (sameCatalogStamp(previous.stamp, next.stamp) && previous.digest !== next.digest)
    throw new Error('Canonical catalog changed content without a revision');
}

export function createCatalogReplica(options: { readonly replicaId: string; readonly body: unknown }): CatalogReplica {
  return { kind: 'unlinked', replicaId: parseReplicaId(options.replicaId), localRevision: 0, body: parseCatalogBody(options.body) };
}

export function saveCatalogReplica(state: CatalogReplica, expectedLocalRevision: number, input: unknown): CatalogReplica {
  expectRevision(state, expectedLocalRevision);
  const body = parseCatalogBody(input);
  return sameCatalogBody(state.body, body) ? state : { ...state, localRevision: nextRevision(state), body };
}

export function receiveCatalogSnapshot(state: CatalogReplica, expectedLocalRevision: number, snapshot: CatalogSnapshot): CatalogReplica {
  expectRevision(state, expectedLocalRevision);
  if (state.kind === 'sending') throw new Error('Finish the in-flight catalog synchronization before refreshing');
  const remote = structuredClone(snapshot);
  if (state.kind === 'uncertain') {
    checkSnapshotOrder(state.base, remote);
    if (sameGeneration(state.base.stamp, remote.stamp)) {
      if (sameCatalogStamp(state.base.stamp, remote.stamp)) return state;
      if (sameCatalogBody(state.body, remote.body))
        return { kind: 'ready', ...working(state), base: remote, localRevision: nextRevision(state) };
    }
    return { kind: 'conflict', ...working(state), base: state.base, remote, localRevision: nextRevision(state) };
  }
  if (state.kind === 'conflict') {
    checkSnapshotOrder(state.remote, remote);
    if (sameCatalogStamp(state.remote.stamp, remote.stamp)) return state;
    return { ...state, remote, localRevision: nextRevision(state) };
  }
  if (state.kind === 'ready') {
    checkSnapshotOrder(state.base, remote);
    if (!sameGeneration(state.base.stamp, remote.stamp))
      return { kind: 'conflict', ...working(state), base: state.base, remote, localRevision: nextRevision(state) };
    if (sameCatalogStamp(state.base.stamp, remote.stamp)) return state;
    if (!sameCatalogBody(state.body, state.base.body) && !sameCatalogBody(state.body, remote.body))
      return { kind: 'conflict', ...working(state), base: state.base, remote, localRevision: nextRevision(state) };
  } else if (!sameCatalogBody(state.body, remote.body)) {
    return { kind: 'conflict', ...working(state), base: null, remote, localRevision: nextRevision(state) };
  }
  return { kind: 'ready', ...working(state), base: remote, body: structuredClone(remote.body), localRevision: nextRevision(state) };
}

function working(state: CatalogReplica): WorkingCopy {
  return { replicaId: state.replicaId, localRevision: state.localRevision, body: state.body };
}

export function beginCatalogSync(state: CatalogReplica, expectedLocalRevision: number): {
  readonly state: CatalogReplica; readonly request: CatalogSyncRequest | null;
} {
  expectRevision(state, expectedLocalRevision);
  if (state.kind !== 'ready' && state.kind !== 'uncertain') throw new Error('Catalog synchronization requires a linked, resolved working copy');
  if (state.kind === 'ready' && sameCatalogBody(state.body, state.base.body)) return { state, request: null };
  const localRevision = nextRevision(state);
  const request: CatalogSyncRequest = { attemptId: localRevision,
    base: structuredClone(state.kind === 'uncertain' ? state.request.base : state.base.stamp),
    body: structuredClone(state.kind === 'uncertain' ? state.request.body : state.body) };
  return { state: { kind: 'sending', ...working(state), base: state.base, localRevision, request }, request: structuredClone(request) };
}

export function completeCatalogSync(state: CatalogReplica, attemptId: number, result: CatalogSaveResult): CatalogReplica {
  if ((state.kind !== 'sending' && state.kind !== 'uncertain') || state.request.attemptId !== attemptId) return state;
  const snapshot = structuredClone(result.kind === 'current' ? result.snapshot : result.current);
  checkSnapshotOrder(state.base, snapshot);
  if (result.kind === 'conflict' || !sameGeneration(state.base.stamp, snapshot.stamp)) {
    return { kind: 'conflict', ...working(state), base: state.base, remote: snapshot, localRevision: nextRevision(state) };
  }
  if (!sameCatalogBody(snapshot.body, state.request.body)) throw new Error('Catalog acknowledgment does not match the sent content');
  return { kind: 'ready', ...working(state), base: snapshot, localRevision: nextRevision(state) };
}

export function failCatalogSync(state: CatalogReplica, attemptId: number): CatalogReplica {
  if (state.kind !== 'sending' || state.request.attemptId !== attemptId) return state;
  return { kind: 'uncertain', ...working(state), base: state.base, request: state.request, localRevision: nextRevision(state) };
}

export function resolveCatalogConflict(state: CatalogReplica, expectedLocalRevision: number, input: unknown): CatalogReplica {
  expectRevision(state, expectedLocalRevision);
  if (state.kind !== 'conflict') throw new Error('There is no catalog conflict to resolve');
  return { kind: 'ready', ...working(state), base: structuredClone(state.remote), body: parseCatalogBody(input), localRevision: nextRevision(state) };
}

export function catalogReplicaStatus(state: CatalogReplica): 'local-only' | 'synced' | 'pending' | 'sending' | 'uncertain' | 'conflict' {
  switch (state.kind) {
    case 'unlinked': return 'local-only';
    case 'ready': return sameCatalogBody(state.body, state.base.body) ? 'synced' : 'pending';
    case 'sending': return 'sending';
    case 'uncertain': return 'uncertain';
    case 'conflict': return 'conflict';
    default: { const exhaustive: never = state; return exhaustive; }
  }
}

export type FrozenCatalogReplica = {
  readonly body: CatalogBody;
  readonly digest: string;
  readonly source: { readonly kind: 'canonical'; readonly stamp: CatalogStamp }
    | { readonly kind: 'local'; readonly replicaId: string; readonly localRevision: number; readonly base: CatalogStamp | null };
};
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const field of Object.values(value)) freeze(field);
    Object.freeze(value);
  }
  return value;
}
export async function freezeCatalogReplica(state: CatalogReplica): Promise<FrozenCatalogReplica> {
  const body = freeze(structuredClone(state.body));
  const source: FrozenCatalogReplica['source'] = state.kind === 'ready' && sameCatalogBody(state.body, state.base.body)
    ? { kind: 'canonical', stamp: structuredClone(state.base.stamp) }
    : { kind: 'local', replicaId: state.replicaId, localRevision: state.localRevision,
      base: state.kind === 'unlinked' || state.base === null ? null : structuredClone(state.base.stamp) };
  return freeze({ body, digest: await digestCatalogBody(body), source });
}
