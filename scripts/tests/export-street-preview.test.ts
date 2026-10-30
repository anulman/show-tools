import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { parseStreetScene } from '../../lib/video/street-score.js';
import { createStreetCompositor, exportFrameCount, parseExportArguments } from '../export-street-preview.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function scene(backgroundHash = '0'.repeat(64), poseHash = '0'.repeat(64)) {
  const clips = ['simple', 'vigorous', 'special'].map(tier => ({
    id: tier, tier, cycleQuarters: 1, actionQuarters: null, nativeGrid: { width: 2, height: 2 }, sourceOffset: { x: 50, y: 50 },
    keys: [{ atQuarter: 0, pose: 0 }], drawings: [{ path: '/pose.png', sha256: poseHash, pivot: { x: 1, y: 1 } }],
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
    const frame = await compositor.render([{ actor: 0, clip: 0, pose: 0, grayscale: false }, { actor: 1, clip: 0, pose: 0, grayscale: true }]);
    const actual = await sharp(frame).raw().toBuffer();
    const pixel = (x: number, y: number) => [...actual.subarray((y * 8 + x) * 4, (y * 8 + x + 1) * 4)];
    assert.deepEqual(pixel(0, 1), [0, 0, 0, 255]);
    assert.deepEqual(pixel(1, 1), [200, 100, 50, 255]);
    assert.deepEqual(pixel(5, 1), [118, 118, 118, 255]);
    assert.deepEqual(pixel(7, 1), [0, 0, 0, 255]);
    const clippedScene = parseStreetScene({ ...prepared, actors: prepared.actors.map(actor => ({ ...actor, placement: { ...actor.placement, x: 0, y: 0 } })) });
    const clipped = await createStreetCompositor(clippedScene, directory);
    const output = await sharp(await clipped.render([{ actor: 0, clip: 0, pose: 0, grayscale: false }])).raw().toBuffer();
    assert.deepEqual([...output.subarray(0, 4)], [200, 100, 50, 255]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
