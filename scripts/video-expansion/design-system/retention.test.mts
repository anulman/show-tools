import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Artifact, expiryDecision, planExpiry } from './retention.mjs';

const completed: typeof Artifact.Type = { path: 'temporary/contact-sheet.png', kind: 'process-evidence', state: 'completed', owners: ['C06/default'], lessonsPath: 'assets/video/published/README.md', requiredBy: [], referencesReviewed: true };
const context = { promoted: new Set(['C06/default']), protectedPaths: new Set<string>(), lessonsAvailable: true };
const eligible = async (artifact: typeof Artifact.Type, options = context) => (await expiryDecision(artifact, options)).eligible;

test('inactive process evidence requires lessons, complete promotion and dependency review', async () => {
  assert.equal(await eligible(completed), true);
  assert.equal(await eligible(completed, { ...context, lessonsAvailable: false }), false);
  assert.equal(await eligible({ ...completed, owners: ['C06/default', 'unpromoted/special'] }), false);
  assert.equal(await eligible({ ...completed, requiredBy: ['candidate builder'] }), false);
  assert.equal(await eligible({ ...completed, referencesReviewed: false }), false);
});
test('active work, runtime exports and code stay protected', async () => {
  for (const state of ['active', 'awaiting-promotion'] satisfies (typeof Artifact.Type.state)[]) assert.equal(await eligible({ ...completed, state }), false);
  for (const kind of ['runtime', 'code', 'regression-fixture'] satisfies (typeof Artifact.Type.kind)[]) assert.equal(await eligible({ ...completed, kind }), false);
});
test('intentionally abandoned prototypes require lessons without becoming canonical art', async () => {
  const abandoned = { ...completed, kind: 'prototype', state: 'abandoned', owners: [] } satisfies typeof Artifact.Type;
  assert.equal(await eligible(abandoned), true);
  assert.equal(await eligible(abandoned, { ...context, lessonsAvailable: false }), false);
});
test('path aliases, containing directories and protected-tree children cannot bypass dependencies', async () => {
  const pinned = { ...context, protectedPaths: new Set(['assets/video/motion/pixel-final']) };
  for (const path of ['./assets/video/motion/pixel-final/review.json', 'assets/video/motion', 'assets/video/motion/pixel-final']) assert.equal(await eligible({ ...completed, path }, pinned), false);
  assert.equal(await eligible({ ...completed, path: './assets/video/published/C06-default' }), false);
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
test('real filesystem aliases to runtime files, protected trees and containing folders stay protected', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retention-alias-'));
  try {
    const file = join(root, 'pose-link.png'), directory = join(root, 'video-link');
    await symlink(resolve('assets/video/published/C06-default/pose-0.png'), file);
    await symlink(resolve('assets/video'), directory);
    for (const path of [file, directory, join(directory, 'published/C06-default/pose-0.png'), join(directory, 'published/not-created/file.png')]) assert.equal(await eligible({ ...completed, path }), false);
    const target = join(root, 'protected-tree'); await mkdir(target);
    const alias = join(root, 'protected-link'); await symlink(target, alias);
    assert.equal(await eligible({ ...completed, path: join(alias, 'not-created/report.json') }, { ...context, protectedPaths: new Set([target]) }), false);
    assert.equal(await eligible({ ...completed, path: target }, { ...context, protectedPaths: new Set([alias]) }), false);
    const artifacts = join(root, 'artifacts.json'); await writeFile(artifacts, JSON.stringify([{ ...completed, path: file }]));
    assert.equal((await planExpiry(artifacts, 'assets/video/published/retention-dependencies.json')).decisions[0].eligible, false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('dangling aliases and ambiguous parent traversal fail closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'retention-unresolved-'));
  try {
    const alias = join(root, 'dangling'); await symlink(join(root, 'missing'), alias);
    for (const path of [alias, join(alias, 'child.json'), root + '/alias/../file']) assert.equal(await eligible({ ...completed, path }), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});
