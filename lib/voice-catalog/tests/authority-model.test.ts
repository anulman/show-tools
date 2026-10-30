import assert from 'node:assert/strict';
import test from 'node:test';
import { digestCatalogBody, makeCatalogSnapshot, parseCatalogBody, parseCatalogSnapshot, type CatalogBody } from '../authority-model.js';

function body() {
  return {
    voices: [{ id: 'bell', name: 'Bell', notes: 'Retain this', characterId: 'future-character', avatarToken: 'amber', effects: [
      { kind: 'slapback', delayMs: 100, feedback: .1, wet: .25 },
      { kind: 'chorus', rateHz: .8, depthMs: 5, baseDelayMs: 20, wet: .35 },
    ] }],
    bindings: [{ spreadsheetId: 'sheet', sheetId: 101, labelCell: 'A11', sourceLabel: 'AF - Cowbell', voiceId: 'bell',
      cueRow: { labelCell: 'A19', sourceLabel: 'R2' } }],
  } satisfies CatalogBody;
}
const stamp = { catalogId: 'catalog', generationId: 'generation', revision: 7 };

test('snapshot digest binds operator content, including effect order, but not authority revision', async () => {
  const original = body();
  const first = await makeCatalogSnapshot(stamp, original);
  assert.deepEqual(await parseCatalogSnapshot(JSON.parse(JSON.stringify(first))), first);
  assert.equal((await makeCatalogSnapshot({ ...stamp, revision: 8 }, original)).digest, first.digest);
  const changed = body();
  changed.voices[0].effects.reverse();
  assert.notEqual((await makeCatalogSnapshot(stamp, changed)).digest, first.digest);
  const movedCue = body();
  movedCue.bindings[0].cueRow = { labelCell: 'A18', sourceLabel: 'R1' };
  assert.notEqual((await makeCatalogSnapshot(stamp, movedCue)).digest, first.digest);
  assert.equal(first.body.voices[0].characterId, 'future-character');
});

test('equivalent property and voice order produce the same content digest', async () => {
  const original = body();
  const reordered = {
    bindings: original.bindings,
    voices: original.voices.map(voice => ({ effects: voice.effects, avatarToken: voice.avatarToken,
      characterId: voice.characterId, notes: voice.notes, name: voice.name, id: voice.id })),
  };
  assert.equal(await digestCatalogBody(reordered), await digestCatalogBody(original));
  const two = { ...original, voices: [...original.voices, { ...original.voices[0], id: 'another-voice' }] };
  assert.equal(await digestCatalogBody(two), await digestCatalogBody({ ...two, voices: [...two.voices].reverse() }));
});

test('snapshot verification rejects changed content, bad identities, obsolete versions and invalid links', async () => {
  const snapshot = await makeCatalogSnapshot(stamp, body());
  const changed = { ...snapshot, body: body() };
  changed.body.voices[0].name = 'Changed';
  await assert.rejects(parseCatalogSnapshot(changed), /digest/);
  await assert.rejects(parseCatalogSnapshot({ ...snapshot, schemaVersion: 2 }));
  await assert.rejects(makeCatalogSnapshot({ ...stamp, revision: Number.MAX_SAFE_INTEGER + 1 }, body()));
  await assert.rejects(makeCatalogSnapshot({ ...stamp, generationId: '' }, body()));
  const invalid = body();
  invalid.bindings[0].voiceId = 'absent';
  assert.throws(() => parseCatalogBody(invalid));
});

test('constructed snapshots own their content independently of later editor mutations', async () => {
  const original = body();
  const snapshot = await makeCatalogSnapshot(stamp, original);
  original.voices[0].name = 'Later draft';
  original.voices[0].effects.reverse();
  original.bindings[0].cueRow = { labelCell: 'A20', sourceLabel: 'L1' };
  assert.equal(snapshot.body.voices[0].name, 'Bell');
  assert.equal(snapshot.body.voices[0].effects[0].kind, 'slapback');
  assert.deepEqual(snapshot.body.bindings[0].cueRow, { labelCell: 'A19', sourceLabel: 'R2' });
  assert.deepEqual(await parseCatalogSnapshot(snapshot), snapshot);
});

test('snapshot identity is captured with its body before asynchronous digest work', async () => {
  const identity = { ...stamp };
  const pending = makeCatalogSnapshot(identity, body());
  identity.revision = 99;
  identity.generationId = 'later-generation';
  assert.deepEqual((await pending).stamp, stamp);
});
