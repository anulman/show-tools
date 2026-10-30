import assert from 'node:assert/strict';
import test from 'node:test';
import { makeCatalogSnapshot } from '../authority-model.js';
import {
  beginCatalogSync, catalogReplicaStatus, CatalogReplicaRevisionError, completeCatalogSync,
  createCatalogReplica, failCatalogSync, freezeCatalogReplica, receiveCatalogSnapshot,
  resolveCatalogConflict, saveCatalogReplica,
} from '../replica.js';
import type { CatalogBody } from '../authority-model.js';
import type { CatalogReplica } from '../replica.js';

function body(name = 'Cowbell'): CatalogBody {
  return {
    voices: [{ id: 'voice-stable', name, notes: 'saved note', characterId: 'unknown-character', avatarToken: 'amber', effects: [
      { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 },
      { kind: 'slapback', delayMs: 100, feedback: .1, wet: .25 },
    ] }],
    bindings: [{ spreadsheetId: 'chart-one', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell', voiceId: 'voice-stable',
      cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }],
  };
}
const snapshot = (name = 'Cowbell', revision = 1, generationId = 'generation-one', catalogId = 'catalog-one') =>
  makeCatalogSnapshot({ catalogId, generationId, revision }, body(name));
async function linked() {
  const initial = createCatalogReplica({ replicaId: 'browser-one', body: body() });
  return receiveCatalogSnapshot(initial, initial.localRevision, await snapshot());
}

test('unlinked offline saves retain voice data and freeze a detached immutable effective view', async () => {
  const source = body();
  const state = createCatalogReplica({ replicaId: 'offline-browser', body: source });
  Object.assign(source.voices[0], { name: 'external mutation' });
  assert.equal(state.body.voices[0].name, 'Cowbell');
  const saved = saveCatalogReplica(state, 0, body('Local bell'));
  assert.equal(catalogReplicaStatus(saved), 'local-only');
  assert.equal(saved.localRevision, 1);
  const frozen = await freezeCatalogReplica(saved);
  assert.deepEqual(frozen.source, { kind: 'local', replicaId: 'offline-browser', localRevision: 1, base: null });
  assert.deepEqual(frozen.body, body('Local bell'));
  assert.equal(frozen.body.voices[0].characterId, 'unknown-character');
  assert.equal(frozen.digest.length, 64);
  assert(Object.isFrozen(frozen.body.voices[0].effects));
  assert(Object.isFrozen(frozen.body.bindings[0].cueRow));
  assert.throws(() => Object.assign(frozen.body.voices[0], { name: 'illegal recast' }), TypeError);
  const later = saveCatalogReplica(saved, saved.localRevision, body('Future bell'));
  assert.equal(later.body.voices[0].name, 'Future bell');
  assert.equal(frozen.body.voices[0].name, 'Local bell');
});

test('local compare-and-swap rejects a stale editor without changing the saved copy', () => {
  const initial = createCatalogReplica({ replicaId: 'browser', body: body() });
  const saved = saveCatalogReplica(initial, 0, body('First editor'));
  assert.throws(() => saveCatalogReplica(saved, 0, body('Stale editor')), CatalogReplicaRevisionError);
  assert.equal(saved.body.voices[0].name, 'First editor');
  assert.equal(saved.localRevision, 1);
  assert.throws(() => saveCatalogReplica(saved, 1, { voices: [], bindings: body().bindings }));
  assert.deepEqual(saved.body, body('First editor'));
});

test('linking differing initial libraries preserves both copies until an explicit resolution', async () => {
  const initial = createCatalogReplica({ replicaId: 'browser', body: body('Local choice') });
  const remote = await snapshot('Other profile', 800);
  const conflict = receiveCatalogSnapshot(initial, 0, remote);
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict') throw new Error('Expected an initial-library conflict');
  assert.equal(conflict.base, null);
  assert.equal(conflict.body.voices[0].name, 'Local choice');
  assert.equal(conflict.remote.body.voices[0].name, 'Other profile');
  assert.equal(conflict.localRevision, 1);
  assert.throws(() => beginCatalogSync(conflict, conflict.localRevision));
  const chosen = resolveCatalogConflict(conflict, conflict.localRevision, conflict.remote.body);
  assert.equal(catalogReplicaStatus(chosen), 'synced');
  assert.equal(chosen.localRevision, 2);
  assert.deepEqual(chosen.body, remote.body);
});

test('remote adoption advances the envelope token independently of the canonical revision', async () => {
  let state = createCatalogReplica({ replicaId: 'browser', body: body() });
  for (const name of ['A', 'B', 'C', 'Cowbell']) state = saveCatalogReplica(state, state.localRevision, body(name));
  assert.equal(state.localRevision, 4);
  const remote = await snapshot('Cowbell', 1);
  state = receiveCatalogSnapshot(state, 4, remote);
  assert.equal(state.localRevision, 5);
  assert.equal(catalogReplicaStatus(state), 'synced');
  const frozen = await freezeCatalogReplica(state);
  assert.deepEqual(frozen.source, { kind: 'canonical', stamp: remote.stamp });
  assert.equal(frozen.digest, remote.digest);
  const updated = receiveCatalogSnapshot(state, 5, await snapshot('Server update', 2));
  assert.equal(updated.localRevision, 6);
  assert.equal(updated.body.voices[0].name, 'Server update');
  assert.equal(state.body.voices[0].name, 'Cowbell');
});

test('refresh never discards pending edits and rejects older or equivocating canonical snapshots', async () => {
  const initial = await linked();
  const pending = saveCatalogReplica(initial, initial.localRevision, body('Local edit'));
  const conflict = receiveCatalogSnapshot(pending, pending.localRevision, await snapshot('Remote edit', 2));
  assert.equal(conflict.kind, 'conflict');
  if (conflict.kind !== 'conflict' || !conflict.base) throw new Error('Expected linked conflict');
  assert.deepEqual(conflict.base.body, body());
  assert.deepEqual(conflict.body, body('Local edit'));
  assert.deepEqual(conflict.remote.body, body('Remote edit'));
  const before = structuredClone(conflict);
  const older = await snapshot('Cowbell', 1);
  const equivocated = await snapshot('Other content', 2);
  assert.throws(() => receiveCatalogSnapshot(conflict, conflict.localRevision, older), /backward/);
  assert.throws(() => receiveCatalogSnapshot(conflict, conflict.localRevision, equivocated), /without a revision/);
  assert.deepEqual(conflict, before);
});

test('in-flight requests keep their exact body while acknowledgment preserves later local edits', async () => {
  let state = await linked();
  state = saveCatalogReplica(state, state.localRevision, body('Sent edit'));
  const sending = beginCatalogSync(state, state.localRevision);
  assert(sending.request);
  assert.equal(sending.state.localRevision, state.localRevision + 1);
  Object.assign(sending.request.body.voices[0], { name: 'caller mutation' });
  if (sending.state.kind !== 'sending') throw new Error('Expected in-flight synchronization');
  assert.equal(sending.state.request.body.voices[0].name, 'Sent edit');
  const later = saveCatalogReplica(sending.state, sending.state.localRevision, body('Later edit'));
  assert.equal(catalogReplicaStatus(later), 'sending');
  const acknowledged = completeCatalogSync(later, sending.state.request.attemptId, { kind: 'current', snapshot: await snapshot('Sent edit', 2) });
  assert.equal(acknowledged.localRevision, later.localRevision + 1);
  assert.equal(catalogReplicaStatus(acknowledged), 'pending');
  assert.equal(acknowledged.body.voices[0].name, 'Later edit');
  const next = beginCatalogSync(acknowledged, acknowledged.localRevision);
  assert(next.request);
  assert.equal(next.request.base.revision, 2);
  assert.equal(next.request.body.voices[0].name, 'Later edit');
  const complete = completeCatalogSync(next.state, next.request.attemptId, { kind: 'current', snapshot: await snapshot('Later edit', 3) });
  assert.equal(catalogReplicaStatus(complete), 'synced');
});

test('stale acknowledgments do nothing and network failure leaves edits retryable', async () => {
  let state = await linked();
  state = saveCatalogReplica(state, state.localRevision, body('Uncertain write'));
  const sending = beginCatalogSync(state, state.localRevision);
  assert(sending.request);
  assert.equal(completeCatalogSync(sending.state, sending.request.attemptId - 1, { kind: 'current', snapshot: await snapshot() }), sending.state);
  assert.equal(failCatalogSync(sending.state, sending.request.attemptId - 1), sending.state);
  const failed = failCatalogSync(sending.state, sending.request.attemptId);
  assert.equal(catalogReplicaStatus(failed), 'pending');
  assert.equal(failed.localRevision, sending.state.localRevision + 1);
  assert.deepEqual(failed.body, body('Uncertain write'));
  const retry = beginCatalogSync(failed, failed.localRevision);
  assert(retry.request);
  assert(retry.request.attemptId > sending.request.attemptId);
  assert.equal(completeCatalogSync(retry.state, sending.request.attemptId, { kind: 'current', snapshot: await snapshot('Uncertain write', 2) }), retry.state);
  const conflict = completeCatalogSync(retry.state, retry.request.attemptId, { kind: 'conflict', current: await snapshot('Another editor after lost acknowledgment', 3) });
  assert.equal(catalogReplicaStatus(conflict), 'conflict');
  assert.deepEqual(conflict.body, body('Uncertain write'));
});

test('mismatched success content, backward revisions and refresh during flight cannot replace pending data', async () => {
  let state = await linked();
  state = saveCatalogReplica(state, state.localRevision, body('Sent edit'));
  const sending = beginCatalogSync(state, state.localRevision);
  const request = sending.request;
  assert(request);
  const wrong = await snapshot('Wrong acknowledgment', 2);
  assert.throws(() => completeCatalogSync(sending.state, request.attemptId, { kind: 'current', snapshot: wrong }));
  const older = await snapshot('Sent edit', 0);
  assert.throws(() => completeCatalogSync(sending.state, request.attemptId, { kind: 'current', snapshot: older }));
  assert.throws(() => receiveCatalogSnapshot(sending.state, sending.state.localRevision, wrong));
  assert.deepEqual(sending.state.body, body('Sent edit'));
});

test('restore and foreign-catalog generations conflict even with equal content and revision', async () => {
  const initial = await linked();
  for (const remote of [await snapshot('Cowbell', 1, 'restored-generation'), await snapshot('Cowbell', 1, 'generation-one', 'foreign-catalog')]) {
    const conflict = receiveCatalogSnapshot(initial, initial.localRevision, remote);
    assert.equal(catalogReplicaStatus(conflict), 'conflict');
    assert.deepEqual(conflict.body, initial.body);
    const frozen = await freezeCatalogReplica(conflict);
    assert.equal(frozen.source.kind, 'local');
  }
  const pending = saveCatalogReplica(initial, initial.localRevision, body('Local edit'));
  const sending = beginCatalogSync(pending, pending.localRevision);
  assert(sending.request);
  const restored = await snapshot('Local edit', 1, 'restored-generation');
  const conflict = completeCatalogSync(sending.state, sending.request.attemptId, { kind: 'current', snapshot: restored });
  assert.equal(conflict.kind, 'conflict');
  const resolved = resolveCatalogConflict(conflict, conflict.localRevision, body('Retained local edit'));
  const retry = beginCatalogSync(resolved, resolved.localRevision);
  assert.equal(retry.request?.base.generationId, 'restored-generation');
});

test('unchanged operations do not advance tokens and exhaustion never wraps local revisions', async () => {
  const initial = await linked();
  assert.equal(saveCatalogReplica(initial, initial.localRevision, body()), initial);
  assert.equal(receiveCatalogSnapshot(initial, initial.localRevision, await snapshot()), initial);
  assert.deepEqual(beginCatalogSync(initial, initial.localRevision), { state: initial, request: null });
  const exhausted: CatalogReplica = { ...initial, localRevision: Number.MAX_SAFE_INTEGER };
  assert.throws(() => saveCatalogReplica(exhausted, exhausted.localRevision, body('New edit')), /exhausted/);
  assert.equal(exhausted.localRevision, Number.MAX_SAFE_INTEGER);
});
