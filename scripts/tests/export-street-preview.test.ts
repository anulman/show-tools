import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { parseStreetScene, type ActorFrame } from '../../lib/video/street-score.js';
import type { StreetAsset } from '../../lib/video/street-assets.js';
import { createStreetCompositor, exportFrameCount, parseExportArguments } from '../export-street-preview.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function scene(backgroundHash = '0'.repeat(64), poseHash = '0'.repeat(64)) {
  const clips = ['simple', 'vigorous', 'special'].map(tier => ({
    id: tier, tier, cycleQuarters: 1, actionQuarters: null, nativeGrid: { width: 2, height: 2 }, sourceOffset: { x: 50, y: 50 },
    keys: [{ atQuarter: 0, pose: 0 }], drawings: [
      { path: '/pose.png', sha256: poseHash, pivot: { x: 1, y: tier === 'vigorous' ? 0 : 1 } },
      { path: '/pose.png', sha256: poseHash, pivot: { x: 0, y: 1 } },
    ],
  }));
  return parseStreetScene({ version: 2, kind: 'authored-street-preview', width: 8, height: 4, background: { path: '/background.png', sha256: backgroundHash },
    previewCountsPerSecond: 2, durationCounts: 3, countedBeatUnit: 4,
    actors: [
      { characterId: 'main', role: 'main-vocals', placement: { x: 2, y: 2, scale: 1, depth: 0 }, clips },
      { characterId: 'other', role: 'instrument', placement: { x: 6, y: 2, scale: 1, depth: 1 }, clips },
    ],
    tracks: [0, 1].map(actor => ({ actor, keys: [{ at: 0, clip: 0, pose: 0, grayscale: actor === 1 }] })),
    provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' },
  });
}

test('export CLI rejects missing required inputs and noninteger or zero fps', () => {
  assert.throws(() => parseExportArguments([]));
  for (const fps of ['0', '29.97', 'NaN', '121']) assert.throws(() => parseExportArguments(['--scene', 's', '--asset-root', '.', '--output', 'o', '--fps', fps]));
  assert.throws(() => parseExportArguments(['--scene', 's', '--asset-root', '.', '--output', 'o', '--oops', '1']));
  assert.equal(parseExportArguments(['--scene', 's', '--asset-root', '.', '--output', 'o']).fps, 30);
  assert.equal(exportFrameCount(scene(), 30), 45);
});

test('real compositor keeps registered pivots, source color, grayscale and clipping', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'street-export-'));
  try {
    const background = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#000000' } }).png().toBuffer();
    await writeFile(join(directory, 'background.png'), background);
    const pixels = Buffer.from([200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255, 200, 100, 50, 255]);
    const pose = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
    await writeFile(join(directory, 'pose.png'), pose);
    const prepared = scene(sha256(background), sha256(pose));
    const compositor = await createStreetCompositor(prepared, directory);
    const frame = await compositor.render([{ actor: 0, clip: 0, pose: 0, grayscale: false, visible: true, poof: null }, { actor: 1, clip: 0, pose: 0, grayscale: true, visible: true, poof: null }]);
    const actual = await sharp(frame).raw().toBuffer();
    const pixel = (x: number, y: number) => [...actual.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4)];
    assert.deepEqual(pixel(0, 1), [0, 0, 0, 255]);
    assert.deepEqual(pixel(1, 1), [200, 100, 50, 255]);
    assert.deepEqual(pixel(5, 1), [118, 118, 118, 255]);
    assert.deepEqual(pixel(7, 1), [0, 0, 0, 255]);
    for (const state of [
      [{ actor: 0, clip: 0, pose: 0, grayscale: false, visible: true, poof: null }],
      [{ actor: 1, clip: 0, pose: 0, grayscale: false, visible: true, poof: null }],
      [{ actor: 1, clip: 1, pose: 0, grayscale: false, visible: true, poof: null }],
      [{ actor: 1, clip: 1, pose: 1, grayscale: false, visible: true, poof: null }],
      [{ actor: 1, clip: 1, pose: 1, grayscale: true, visible: true, poof: null }],
      [],
    ]) {
      const fresh = await createStreetCompositor(prepared, directory);
      const expected = await fresh.render(state);
      assert.deepEqual(await compositor.render(state), expected);
      assert.deepEqual(await compositor.render(state.map(actor => ({ ...actor }))), expected);
    }
    const clippedScene = parseStreetScene({ ...prepared, actors: prepared.actors.map(actor => ({ ...actor, placement: { ...actor.placement, x: 0, y: 0 } })) });
    const clipped = await createStreetCompositor(clippedScene, directory);
    const output = await sharp(await clipped.render([{ actor: 0, clip: 0, pose: 0, grayscale: false, visible: true, poof: null }])).raw().toBuffer();
    assert.deepEqual([...output.subarray(0, 4)], [200, 100, 50, 255]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('real compositor hides bodies, retains colored exit clouds and invalidates every presentation-only cache change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'street-poof-export-'));
  try {
    const background = await sharp({ create: { width: 8, height: 4, channels: 4, background: '#000000' } }).png().toBuffer();
    const pose = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#c86432' } }).png().toBuffer();
    await writeFile(join(directory, 'background.png'), background);
    await writeFile(join(directory, 'pose.png'), pose);
    const effects: StreetAsset[] = [];
    for (const [index, color] of [[255, 0, 0], [0, 255, 0], [0, 0, 255]].entries()) {
      const pixels = Buffer.alloc(128 * 128 * 4);
      pixels.set([...color, 255], (105 * 128 + 63) * 4);
      const png = await sharp(pixels, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
      const path = `/poof-${index}.png`;
      await writeFile(join(directory, path.slice(1)), png);
      effects.push({ path, sha256: sha256(png) });
    }
    const prepared = parseStreetScene({ ...scene(sha256(background), sha256(pose)), staging: {
      kind: 'poof', effects: [
        { id: 'first', nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 }, drawings: [effects[0], effects[1], effects[0], effects[1], effects[0], effects[1]] },
        { id: 'second', nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 }, drawings: Array.from({ length: 6 }, () => effects[2]) },
      ], tracks: [0, 1].map(actor => ({ actor, keys: [{ at: 0, visible: true, poof: null }] })),
    } });
    const compositor = await createStreetCompositor(prepared, directory);
    const base: ActorFrame = { actor: 0, clip: 0, pose: 0, grayscale: true, visible: true, poof: null };
    async function pixel(frame: readonly ActorFrame[], x = 1, y = 1) {
      const rgba = await sharp(await compositor.render(frame)).raw().toBuffer();
      return [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4)];
    }
    assert.deepEqual(await pixel([base]), [118, 118, 118, 255]);
    assert.deepEqual(await pixel([{ ...base, visible: false }]), [0, 0, 0, 255]);
    const exit: ActorFrame = { ...base, visible: false, poof: { effect: 0, pose: 0 } };
    assert.deepEqual(await pixel([exit]), [255, 0, 0, 255]);
    const mutablePoof = { effect: 0, pose: 0 };
    const sampled: ActorFrame = { ...base, poof: mutablePoof };
    assert.deepEqual(await pixel([sampled]), [255, 0, 0, 255]);
    assert.deepEqual(await pixel([sampled], 2, 2), [118, 118, 118, 255]);
    mutablePoof.pose = 1;
    assert.deepEqual(await pixel([sampled]), [0, 255, 0, 255]);
    mutablePoof.effect = 1;
    assert.deepEqual(await pixel([sampled]), [0, 0, 255, 255]);
    assert.deepEqual(await pixel([base]), [118, 118, 118, 255]);
    const overlapped = parseStreetScene({ ...prepared, actors: prepared.actors.map(actor => ({ ...actor, placement: { ...actor.placement, x: 2, y: 2 } })) });
    const depth = await createStreetCompositor(overlapped, directory);
    const depthPixels = await sharp(await depth.render([exit, { ...base, actor: 1 }])).raw().toBuffer();
    assert.deepEqual([...depthPixels.subarray((1 * 8 + 1) * 4, (1 * 8 + 2) * 4)], [118, 118, 118, 255]);
    assert(prepared.staging.kind === 'poof');
    const shifted = parseStreetScene({ ...prepared, staging: { ...prepared.staging,
      tracks: prepared.staging.tracks.map(track => ({ ...track, offset: { x: 2, y: 1 } })),
    } });
    const shiftedCompositor = await createStreetCompositor(shifted, directory);
    async function shiftedPixel(pose: number, x: number, y: number) {
      const png = await shiftedCompositor.render([{ ...base, poof: { effect: 0, pose } }]);
      const rgba = await sharp(png).raw().toBuffer();
      return [...rgba.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4)];
    }
    assert.deepEqual(await shiftedPixel(0, 1, 1), [118, 118, 118, 255]);
    assert.deepEqual(await shiftedPixel(0, 3, 2), [255, 0, 0, 255]);
    assert.deepEqual(await shiftedPixel(1, 3, 2), [0, 255, 0, 255]);
    assert.deepEqual(await shiftedPixel(0, 3, 2), [255, 0, 0, 255]);
    await writeFile(join(directory, 'poof-0.png'), pose);
    const tampered = await createStreetCompositor(prepared, directory);
    await assert.rejects(tampered.render([exit]), /Asset hash mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
