import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyPublished } from './published.mjs';

test('both runtime packages verify when copied without source art or raw reports', async () => {
  const root = await mkdtemp(join(tmpdir(), 'published-motion-'));
  try {
    for (const [name, count] of [['C06-default', 3], ['C06-special-03', 6]] satisfies [string, number][]) {
      await cp(`assets/video/published/${name}`, join(root, name), { recursive: true });
      const result = await verifyPublished(join(root, name, 'promotion.json'));
      assert.equal(result.drawings.length, count);
      assert.equal(result.characterId, 'C06');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a changed runtime file cannot inherit the compact pixel approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'published-motion-'));
  try {
    await cp('assets/video/published/C06-default', root, { recursive: true });
    const path = join(root, 'pose-0.png');
    await writeFile(path, Buffer.concat([await readFile(path), Buffer.from([0])]));
    await assert.rejects(verifyPublished(join(root, 'promotion.json')), /Published runtime pixels changed/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('negative or unordered beat keys cannot be published', async () => {
  const root = await mkdtemp(join(tmpdir(), 'published-motion-'));
  try {
    await cp('assets/video/published/C06-default', root, { recursive: true });
    const path = join(root, 'promotion.json'), publication = await verifyPublished(path);
    await writeFile(path, JSON.stringify({ ...publication, keyframes: publication.keyframes.map((key, index) => index === 1 ? { ...key, atBeat: -.5 } : key) }));
    await assert.rejects(verifyPublished(path), /Invalid published beat metadata/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
