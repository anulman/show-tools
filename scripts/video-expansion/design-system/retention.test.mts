import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Artifact, expiryDecision, planExpiry } from './retention.mjs';

const completed: typeof Artifact.Type = { path: 'temporary/contact-sheet.png', kind: 'process-evidence', state: 'completed', owners: ['C06/default'], lessonsPath: 'assets/video/published/README.md', requiredBy: [], referencesReviewed: true };
const context = { promoted: new Set(['C06/default']), protectedPaths: new Set<string>(), lessonsAvailable: true };
test('inactive process evidence requires lessons, complete promotion and dependency review', () => {
  assert.equal(expiryDecision(completed, context).eligible, true);
  assert.equal(expiryDecision(completed, { ...context, lessonsAvailable: false }).eligible, false);
  assert.equal(expiryDecision({ ...completed, owners: ['C06/default', 'unpromoted/special'] }, context).eligible, false);
  assert.equal(expiryDecision({ ...completed, requiredBy: ['candidate builder'] }, context).eligible, false);
  assert.equal(expiryDecision({ ...completed, referencesReviewed: false }, context).eligible, false);
});
test('active work, runtime exports and code stay protected', () => {
  for (const state of ['active', 'awaiting-promotion'] satisfies (typeof Artifact.Type.state)[]) assert.equal(expiryDecision({ ...completed, state }, context).eligible, false);
  for (const kind of ['runtime', 'code', 'regression-fixture'] satisfies (typeof Artifact.Type.kind)[]) assert.equal(expiryDecision({ ...completed, kind }, context).eligible, false);
});
test('intentionally abandoned prototypes require lessons without becoming canonical art', () => {
  const abandoned = { ...completed, kind: 'prototype', state: 'abandoned', owners: [] } satisfies typeof Artifact.Type;
  assert.equal(expiryDecision(abandoned, context).eligible, true);
  assert.equal(expiryDecision(abandoned, { ...context, lessonsAvailable: false }).eligible, false);
});
test('path aliases, containing directories and protected-tree children cannot bypass dependencies', () => {
  const pinned = { ...context, protectedPaths: new Set(['assets/video/motion/pixel-final']) };
  for (const path of ['./assets/video/motion/pixel-final/review.json', 'assets/video/motion', 'assets/video/motion/pixel-final']) assert.equal(expiryDecision({ ...completed, path }, pinned).eligible, false);
  assert.equal(expiryDecision({ ...completed, path: './assets/video/published/C06-default' }, context).eligible, false);
});
test('the CLI plan protects legacy builder inputs after runtime promotion and deletes nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retention-plan-'));
  try {
    const path = join(root, 'artifacts.json');
    await writeFile(path, JSON.stringify([
      completed,
      { ...completed, path: 'assets/video/motion/special-moves/animated/C06/C06-special-03/manifest.json', owners: ['C06/special/03'] },
    ]));
    const result = await planExpiry(path, 'assets/video/published/retention-dependencies.json');
    assert.equal(result.deleted, 0);
    assert.deepEqual(result.decisions.map(decision => decision.eligible), [true, false]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
