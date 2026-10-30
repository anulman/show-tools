import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import initSqlJs from 'sql.js';
import type { CatalogBody } from '../authority-model.js';
import { migrateCatalog, readMigratedCatalog, restoreCatalog } from '../migrations.js';
import { NativeCatalogAuthority } from '../native-store.js';
import { beginCatalogSync, catalogReplicaStatus, completeCatalogSync, createCatalogReplica,
  failCatalogSync, freezeCatalogReplica, receiveCatalogSnapshot, resolveCatalogConflict, saveCatalogReplica } from '../replica.js';
import { VoiceCatalogSqlite } from '../sqlite.js';

const require = createRequire(import.meta.url);
const sql = await initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
function body(name: string): CatalogBody {
  return {
    voices: [{ id: 'voice-stable', name, notes: 'Retain this note', characterId: 'future-character', avatarToken: 'amber', effects: [
      { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 },
      { kind: 'slapback', delayMs: 100, feedback: .1, wet: .25 },
    ] }],
    bindings: [{ spreadsheetId: 'fixture-sheet', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell',
      voiceId: 'voice-stable', cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }],
  };
}

async function fixture(directory: string) {
  const legacy = VoiceCatalogSqlite.create(sql);
  try {
    legacy.replace({ ...body('A'), version: 2, revision: 0 }, 0);
    const bytes = migrateCatalog(sql, legacy.exportBytes(), { catalogId: 'fixture-catalog', generationId: 'initial-generation' });
    const filename = join(directory, 'catalog.sqlite');
    await writeFile(filename, bytes);
    return { filename, authority: NativeCatalogAuthority.open(filename) };
  } finally { legacy.close(); }
}

for (const committed of [false, true]) for (const otherWriter of [false, true]) {
  test(`real SQLite preserves undo after ${committed ? 'committed' : 'uncommitted'} unknown save${otherWriter ? ' and another writer' : ''}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'catalog-native-replica-'));
    const { filename, authority } = await fixture(directory);
    try {
      const base = await authority.read();
      let state = receiveCatalogSnapshot(createCatalogReplica({ replicaId: 'fixture-browser', body: body('A') }), 0, base);
      state = saveCatalogReplica(state, state.localRevision, body('B'));
      const original = beginCatalogSync(state, state.localRevision);
      assert(original.request);
      state = saveCatalogReplica(original.state, original.state.localRevision, body('A'));
      if (committed) assert.equal((await authority.replace(original.request.base, original.request.body)).kind, 'current');
      state = failCatalogSync(state, original.request.attemptId);
      assert.equal(catalogReplicaStatus(state), 'uncertain');
      if (otherWriter) {
        const other = NativeCatalogAuthority.open(filename);
        try { assert.equal((await other.replace((await other.read()).stamp, body('C'))).kind, 'current'); }
        finally { other.close(); }
      }
      state = receiveCatalogSnapshot(state, state.localRevision, await authority.read());
      assert.deepEqual(state.body, body('A'));
      assert.equal((await freezeCatalogReplica(state)).source.kind, 'local');
      if (state.kind === 'uncertain') {
        const settle = beginCatalogSync(state, state.localRevision);
        assert(settle.request);
        assert.deepEqual(settle.request.body, body('B'));
        const acknowledgment = await authority.replace(settle.request.base, settle.request.body);
        state = completeCatalogSync(settle.state, settle.request.attemptId, acknowledgment);
        assert.equal(catalogReplicaStatus(state), 'pending');
      } else {
        assert.equal(state.kind, 'conflict');
        state = resolveCatalogConflict(state, state.localRevision, state.body);
      }
      const undo = beginCatalogSync(state, state.localRevision);
      assert(undo.request);
      assert.deepEqual(undo.request.body, body('A'));
      const saved = await authority.replace(undo.request.base, undo.request.body);
      state = completeCatalogSync(undo.state, undo.request.attemptId, saved);
      assert.equal(catalogReplicaStatus(state), 'synced');
      assert.deepEqual(state.body, body('A'));
      assert.equal((await freezeCatalogReplica(state)).source.kind, 'canonical');
      const final = await authority.read();
      assert.equal(final.stamp.revision, committed && otherWriter ? 4 : 3);
      const late = await authority.replace(original.request.base, original.request.body);
      assert.equal(late.kind, 'conflict', 'the original old-base write cannot arrive later and overwrite the undo');
      assert.equal(completeCatalogSync(state, original.request.attemptId, late), state);
      assert.deepEqual(await authority.read(), final);
      const reopened = NativeCatalogAuthority.open(filename);
      try { assert.deepEqual(await reopened.read(), final); }
      finally { reopened.close(); }
      assert.deepEqual((await readMigratedCatalog(sql, new Uint8Array(await readFile(filename)))).body, body('A'));
    } finally { authority.close(); await rm(directory, { recursive: true, force: true }); }
  });
}

test('a native backup restored with a new generation rejects an old equal-content save', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'catalog-native-restore-'));
  const { authority } = await fixture(directory);
  try {
    const base = await authority.read();
    const backupPath = join(directory, 'backup.sqlite');
    assert.deepEqual(await authority.snapshot(backupPath), base);
    const restoredPath = join(directory, 'restored.sqlite');
    await writeFile(restoredPath, restoreCatalog(sql, new Uint8Array(await readFile(backupPath))));
    const restored = NativeCatalogAuthority.open(restoredPath);
    try {
      const current = await restored.read();
      assert.equal(current.stamp.catalogId, base.stamp.catalogId);
      assert.equal(current.stamp.revision, base.stamp.revision);
      assert.notEqual(current.stamp.generationId, base.stamp.generationId);
      assert.equal((await restored.replace(base.stamp, body('A'))).kind, 'conflict');
      let state = receiveCatalogSnapshot(createCatalogReplica({ replicaId: 'old-browser', body: body('A') }), 0, base);
      state = receiveCatalogSnapshot(state, state.localRevision, current);
      assert.equal(catalogReplicaStatus(state), 'conflict');
      assert.equal((await freezeCatalogReplica(state)).source.kind, 'local');
      assert.deepEqual(state.body, body('A'));
    } finally { restored.close(); }
  } finally { authority.close(); await rm(directory, { recursive: true, force: true }); }
});
