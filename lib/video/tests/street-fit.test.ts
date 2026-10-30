import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Schema } from 'effect';
import promoted from '../../../assets/video/motion/poof/scene-fits/street.json';
import { parseStreetFitProfile } from '../street-fit.js';
import { parseStreetScene, PoofEffect } from '../street-score.js';

const scene = parseStreetScene({ version: 2, kind: 'authored-street-preview', width: promoted.width, height: promoted.height,
  background: { path: '/background.png', sha256: '0'.repeat(64) }, previewCountsPerSecond: 2, durationCounts: 4, countedBeatUnit: 4,
  actors: promoted.actors.map((actor, index) => ({ characterId: actor.code, role: 'instrument',
    placement: { ...actor.bodyAnchor, scale: actor.bodyScale, depth: index },
    clips: ['simple', 'vigorous', 'special'].map(tier => ({ id: `${actor.code}-${tier}`, tier,
      cycleQuarters: 2, actionQuarters: null,
      nativeGrid: { width: actor.bodyFrame.width / actor.bodyScale, height: actor.bodyFrame.height / actor.bodyScale },
      sourceOffset: { x: 0, y: 0 }, keys: [{ atQuarter: 0, pose: 0 }], drawings: [{ path: `/pose-${actor.code}.png`, sha256: '0'.repeat(64),
        pivot: { x: (actor.bodyAnchor.x - actor.bodyFrame.x) / actor.bodyScale, y: (actor.bodyAnchor.y - actor.bodyFrame.y) / actor.bodyScale } }],
    })),
  })), tracks: promoted.actors.map((_, actor) => ({ actor, keys: [{ at: 0, clip: 0, pose: 0, grayscale: false }] })),
  provenance: { source: 'synthetic fit-boundary fixture', assetsDigest: 'fixture', scoreDigest: 'fixture' },
});
const effects = ['soft', 'pixel', 'star'].map(id => Schema.decodeUnknownSync(PoofEffect)({ id,
  nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 },
  drawings: Array.from({ length: 6 }, (_, pose) => ({ path: `/${id}-${pose}.png`, sha256: '0'.repeat(64) })),
}));
const context = { scene, effects, poofCatalogSha256: promoted.poofCatalog.sha256, characterCatalogSha256: promoted.characterCatalog.sha256 };

test('promoted source-fit profile round-trips its exact metadata and restricted effects', async () => {
  const bytes = await readFile(new URL('../../../assets/video/motion/poof/scene-fits/street.json', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), '1c12d98d9ab7e53055c126ca7cdda34dde9c4ab42839891e31370878d5cb9374');
  const profile = parseStreetFitProfile(promoted, context);
  assert.deepEqual(profile, promoted);
  assert.deepEqual(profile.actors.find(actor => actor.code === 'A29')?.allowedEffectIds, ['soft', 'star']);
  assert.match(profile.verification.scope, /not a product presence or timing approval/);
  assert(profile.verification.limits.some(limit => limit.includes('No browser/GPU or refreshed full-song movie certified')));
});

test('fit approval and every source verification gate are mandatory', () => {
  const { status, ...unapproved } = promoted;
  assert.throws(() => parseStreetFitProfile(unapproved, context));
  assert.throws(() => parseStreetFitProfile({ ...promoted, status: 'concept' }, context));
  for (const key of ['sourceMasks', 'bounds', 'admittedVariantsExercised', 'liveFigmaBodyRegistration']) {
    assert.throws(() => parseStreetFitProfile({ ...promoted, verification: { ...promoted.verification, [key]: 'PENDING' } }, context));
  }
});

test('fit rejects release pin, canvas, and unit drift', () => {
  for (const key of ['poofCatalog', 'characterCatalog']) {
    assert.throws(() => parseStreetFitProfile({ ...promoted, [key]: { ...promoted.poofCatalog, sha256: '0'.repeat(64) } }, context), /catalog pins/);
  }
  assert.throws(() => parseStreetFitProfile({ ...promoted, width: promoted.width + 1 }, context), /canvas/);
  assert.throws(() => parseStreetFitProfile({ ...promoted, offsetUnits: 'native-pixels' }, context));
  assert.throws(() => parseStreetFitProfile({ ...promoted, scaleUnits: 'percent' }, context));
});

test('fit requires the exact unique cast and qualified Figma node identities', () => {
  assert.throws(() => parseStreetFitProfile({ ...promoted, actors: promoted.actors.slice(1) }, context), /exact unique scene cast/);
  assert.throws(() => parseStreetFitProfile({ ...promoted, actors: promoted.actors.map((actor, i) => i === 0 ? promoted.actors[1] : actor) }, context), /exact unique scene cast/);
  assert.throws(() => parseStreetFitProfile({ ...promoted, actors: promoted.actors.map((actor, i) => i === 0 ? { ...actor, code: 'outside' } : actor) }, context), /outside the scene cast/);
  for (const key of ['sceneNodeId', 'templateNodeId', 'actorsNodeId']) assert.throws(() => parseStreetFitProfile({ ...promoted, [key]: 'unqualified' }, context));
  for (const patch of [{ actorNodeId: 'unqualified' }, { actorRootId: 'unqualified' }, { actorRootId: '99:99' }, { actorNodeId: promoted.actors[1].actorNodeId }]) {
    assert.throws(() => parseStreetFitProfile({ ...promoted, actors: promoted.actors.map((actor, i) => i === 0 ? { ...actor, ...patch } : actor) }, context));
  }
});

test('fit preserves body geometry and admits only integral cloud placement and known variants', () => {
  const first = promoted.actors[0];
  for (const patch of [
    { bodyAnchor: { ...first.bodyAnchor, x: first.bodyAnchor.x + 1 } }, { bodyScale: first.bodyScale + 1 },
    { offset: { x: .5, y: 0 } }, { scale: 1.5 }, { scale: 0 }, { allowedEffectIds: [] },
    { allowedEffectIds: ['soft', 'soft'] }, { allowedEffectIds: ['missing'] },
    { effectOccupiedBounds: { ...first.effectOccupiedBounds, left: -1 } },
  ]) assert.throws(() => parseStreetFitProfile({ ...promoted, actors: promoted.actors.map((actor, i) => i === 0 ? { ...actor, ...patch } : actor) }, context));
});
