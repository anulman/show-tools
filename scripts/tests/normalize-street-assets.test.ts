import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { parseStreetScene, StreetScene } from '../../lib/video/street-score.js';
import { Schema } from 'effect';
import { createStreetCompositor } from '../export-street-preview.js';

const command = new URL('../normalize-street-assets.ts', import.meta.url);
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'street-normalization-'));
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#f0c080' } }).png().toBuffer();
  await writeFile(join(root, 'pose.png'), png);
  await writeFile(join(root, 'background.png'), png);
  await writeFile(join(root, 'receipt.json'), '{}');
  const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  const ref = { path: 'receipt.json', sha256: sha256('{}') };
  const families = ['simple', 'vigorous', 'special'].map(tier => ({ familyId: `test-${tier}`, code: 'synthetic', tier,
    nativeGrid: { width: 2, height: 2 }, sourceOffset: { x: 1, y: 1 }, pivot: { x: 1, y: 2 }, cycleBeats: 2, actionBeats: tier === 'special' ? 1 : null,
    beatUnit: 'quarter-note', interpolation: 'hold', keyframes: [{ atBeat: 0, pose: 0 }], sourceRef: ref, sourceReview: ref,
    figma: { componentSetId: '1:1', status: 'recorded', exportReview: { kind: 'source-rgba-pass', receipt: ref } },
    drawings: [{ index: 0, native: { path: 'pose.png', sha256: sha256(png) } }],
  }));
  await writeFile(join(root, 'catalog.json'), JSON.stringify({ fileKey: 'synthetic', codes: ['synthetic'], families }));
  await writeFile(join(root, 'placements.json'), JSON.stringify({ schemaVersion: 1, fileKey: 'synthetic', sceneNodeId: '1:2', worldNodeId: '1:3', width: 2, height: 2,
    background: { path: join(root, 'background.png'), width: 2, height: 2, sha256: sha256(png) },
    placements: [{ code: 'synthetic', x: 1, y: 2, scale: 3, depth: 17, baseNativeGrid: { width: 2, height: 2 }, basePivot: { x: 1, y: 2 }, anchor: { x: 4, y: 8 }, figmaNodeId: '1:4' }],
  }));
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', command.pathname, root, 'catalog.json', join(root, 'placements.json'), 'background.png', join(root, 'assets.json')], { encoding: 'utf8' });
  return { root, run, families };
}

test('normalization preserves padded registration and action/cycle lengths', async () => {
  const { root, run } = await fixture();
  try {
    const result = run(); assert.equal(result.status, 0, result.stderr);
    const normalized = JSON.parse(await readFile(join(root, 'assets.json'), 'utf8'));
    assert.deepEqual(normalized.actors[0].clips[0].sourceOffset, { x: 1, y: 1 });
    assert.deepEqual(normalized.actors[0].clips[0].drawings[0].pivot, { x: 1, y: 2 });
    assert.deepEqual(normalized.actors[0].placement, { x: 4, y: 8, scale: 3, depth: 17 });
    assert.equal(normalized.actors[0].clips[2].actionQuarters, 1);
    assert.equal(normalized.actors[0].clips[2].cycleQuarters, 2);
    assert.equal(normalized.background.sha256, normalized.actors[0].clips[0].drawings[0].sha256);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('normalized scene rejects valid replacement PNGs at export loading', async () => {
  for (const path of ['pose.png', 'background.png']) {
    const { root, run } = await fixture();
    try {
      const result = run(); assert.equal(result.status, 0, result.stderr);
      const parsed: unknown = JSON.parse(await readFile(join(root, 'assets.json'), 'utf8'));
      const normalized = Schema.decodeUnknownSync(StreetScene)(parsed);
      const scene = parseStreetScene({ ...normalized, tracks: [{ actor: 0, keys: [{ at: 0, clip: 0, pose: 0, grayscale: false }] }] });
      const changed = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#0000ff' } }).png().toBuffer();
      await writeFile(join(root, path), changed);
      await assert.rejects(async () => {
        const compositor = await createStreetCompositor(scene, root);
        await compositor.render([{ actor: 0, clip: 0, pose: 0, grayscale: false }]);
      }, /Asset hash mismatch/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('normalization refuses changed PNG bytes even if approval metadata remains', async () => {
  const { root, run } = await fixture();
  try {
    await writeFile(join(root, 'pose.png'), 'changed after review');
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Asset hash mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('normalization rejects a layout that confuses top-left and pivot anchor', async () => {
  const { root, run } = await fixture();
  try {
    const path = join(root, 'placements.json');
    const layout = JSON.parse(await readFile(path, 'utf8'));
    layout.placements[0].anchor = { x: 1, y: 2 };
    await writeFile(path, JSON.stringify(layout));
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Street anchor differs/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
