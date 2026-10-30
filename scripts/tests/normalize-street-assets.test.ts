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

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const noLayerHash = (): string | null => null;
const command = new URL('../normalize-street-assets.ts', import.meta.url);
async function fixture(options: { badSardine?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'street-normalization-'));
  const png = options.badSardine ? await readFile(new URL('./fixtures/identity/bad-sardine.png', import.meta.url)) : await sharp({ create: { width: 2, height: 2, channels: 4, background: '#f0c080' } }).png().toBuffer();
  await writeFile(join(root, 'pose.png'), png);
  await writeFile(join(root, 'background.png'), png);
  await writeFile(join(root, 'receipt.json'), '{}');
  const master = options.badSardine ? await readFile(new URL('../../assets/video/avatars/A04.png', import.meta.url)) : png;
  await writeFile(join(root, 'master.png'), master);
  const identityReference = { fileKey: 'synthetic', nodeId: options.badSardine ? '41:1688' : '1:5', edition: 'approved-1', path: 'master.png', sha256: sha256(master) };
  const grid = options.badSardine ? { width: 64, height: 80 } : { width: 2, height: 2 };
  const ref = { path: 'receipt.json', sha256: sha256('{}') };
  const families = ['simple', 'vigorous', 'special'].map(tier => ({ familyId: `test-${tier}`, code: 'synthetic', tier,
    nativeGrid: grid, sourceOffset: { x: 1, y: 1 }, pivot: { x: 1, y: 2 }, cycleBeats: 2, actionBeats: tier === 'special' ? 1 : null,
    beatUnit: 'quarter-note', interpolation: 'hold', keyframes: [{ atBeat: 0, pose: 0 }], sourceRef: ref, sourceReview: ref,
    figma: { componentSetId: '1:1', status: 'recorded', exportReview: { kind: 'source-rgba-pass', receipt: ref } },
    identityReview: { kind: 'pass', reference: { ...identityReference }, reviewer: 'fixture-reviewer', note: 'Synthetic fixture approval; no production art verdict.',
      drawings: [{ index: 0, nativeSha256: sha256(png), bodySha256: noLayerHash(), effectsSha256: noLayerHash() }] },
    drawings: [{ index: 0, native: { path: 'pose.png', sha256: sha256(png) }, layers: { kind: 'combined-only' } }],
  }));
  const catalog = { version: 2, fileKey: 'synthetic', codes: ['synthetic'], identityReferences: { synthetic: identityReference }, families };
  const saveCatalog = () => writeFile(join(root, 'catalog.json'), JSON.stringify(catalog));
  await saveCatalog();
  await writeFile(join(root, 'placements.json'), JSON.stringify({ schemaVersion: 1, fileKey: 'synthetic', sceneNodeId: '1:2', worldNodeId: '1:3', width: 2, height: 2,
    background: { path: join(root, 'background.png'), width: 2, height: 2, sha256: sha256(png) },
    placements: [{ code: 'synthetic', x: 1, y: 2, scale: 3, depth: 17, baseNativeGrid: { width: 2, height: 2 }, basePivot: { x: 1, y: 2 }, anchor: { x: 4, y: 8 }, figmaNodeId: '1:4' }],
  }));
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', command.pathname, root, 'catalog.json', join(root, 'placements.json'), 'background.png', join(root, 'assets.json')], { encoding: 'utf8' });
  return { root, run, families, catalog, saveCatalog };
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

test('asset digest sorts verified references independently of concurrent completion and repeats byte-for-byte', async () => {
  const { root, run, families, catalog } = await fixture();
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  try {
    for (const path of ['z-source.json', 'a-review.json', 'm-receipt.json']) await writeFile(join(root, path), '{}');
    const ref = (path: string) => ({ path, sha256: hash('{}') });
    await writeFile(join(root, 'catalog.json'), JSON.stringify({ ...catalog, families: families.map(family => ({ ...family,
      sourceRef: ref('z-source.json'), sourceReview: ref('a-review.json'), figma: { ...family.figma, exportReview: { kind: 'source-rgba-pass', receipt: ref('m-receipt.json') } },
    })) }));
    const png = await readFile(join(root, 'pose.png'));
    const expected = hash(JSON.stringify({ catalog: hash(await readFile(join(root, 'catalog.json'))), placements: hash(await readFile(join(root, 'placements.json'))), background: hash(png),
      files: [['a-review.json', hash('{}')], ['m-receipt.json', hash('{}')], ['master.png', hash(png)], ['pose.png', hash(png)], ['z-source.json', hash('{}')]],
    }));
    let previous: string | undefined;
    for (let i = 0; i < 3; i++) {
      const result = run(); assert.equal(result.status, 0, result.stderr);
      const text = await readFile(join(root, 'assets.json'), 'utf8');
      assert.equal(JSON.parse(text).provenance.assetsDigest, expected);
      if (previous !== undefined) assert.equal(text, previous);
      previous = text;
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('catalog version 2 and an independent identity certificate are mandatory', async () => {
  for (const change of ['version', 'missing'] as const) {
    const { root, run, catalog } = await fixture();
    try {
      const changed = change === 'version' ? { ...catalog, version: 1 } : { ...catalog, families: catalog.families.map(({ identityReview: _review, ...family }) => family) };
      await writeFile(join(root, 'catalog.json'), JSON.stringify(changed));
      const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, change === 'version' ? /version/ : /identityReview/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('the actual rejected Sardine stays blocked with a v2 header despite source-rgba-pass', async () => {
  for (const verdict of ['missing', 'needs-repaint', 'pending-review']) {
    const { root, run, catalog, families, saveCatalog } = await fixture({ badSardine: true });
    try {
      assert.equal(sha256(await readFile(join(root, 'pose.png'))), '41bb51639f14d2d03ee2ab666b01377dbfefc899a112b2aa902e13f37b3f36a4');
      assert.equal(sha256(await readFile(join(root, 'master.png'))), '6c0e4749fa735226146dbebefdb663e2d1268f768cc7d8c917b1f39d280c2471');
      assert.equal(families[0].figma.exportReview.kind, 'source-rgba-pass');
      families[0].identityReview.kind = verdict;
      families[0].identityReview.note = 'Rejected source model: squared eye, flat cap, skinny stem and webbed tail diverge from approved master.';
      if (verdict === 'missing') {
        const { identityReview: _review, ...first } = families[0];
        await writeFile(join(root, 'catalog.json'), JSON.stringify({ ...catalog, families: [first, ...families.slice(1)] }));
      } else await saveCatalog();
      const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /identityReview|identity review/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('identity references lock every reference field including edition and Figma IDs', async () => {
  for (const field of ['edition', 'fileKey', 'nodeId', 'path', 'sha256'] as const) {
    const { root, run, families, saveCatalog } = await fixture();
    try {
      families[0].identityReview.reference[field] = field === 'sha256' ? '0'.repeat(64) : 'changed';
      await saveCatalog();
      const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /identity reference .* differs/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('identity reference bytes must match the locked offline master', async () => {
  const { root, run } = await fixture();
  try {
    await writeFile(join(root, 'master.png'), 'tampered master');
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Asset hash mismatch: master.png/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('identity drawing certificates require complete ordered current hashes', async () => {
  for (const change of ['missing', 'extra', 'duplicate', 'stale-index', 'native', 'body', 'effects']) {
    const { root, run, families, saveCatalog } = await fixture();
    try {
      const family = families[0], review = family.identityReview;
      if (change === 'missing') review.drawings = [];
      if (change === 'extra') review.drawings.push({ ...review.drawings[0], index: 1 });
      if (change === 'duplicate') {
        family.drawings.push({ ...family.drawings[0], index: 1 });
        review.drawings.push({ ...review.drawings[0] });
      }
      if (change === 'stale-index') review.drawings[0].index = 7;
      if (change === 'native') review.drawings[0].nativeSha256 = '0'.repeat(64);
      if (change === 'body') review.drawings[0].bodySha256 = '0'.repeat(64);
      if (change === 'effects') review.drawings[0].effectsSha256 = '0'.repeat(64);
      await saveCatalog();
      const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /identity drawing/);
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('separate body/effects require certificates and verified bytes; combined-only also passes', async () => {
  for (const change of ['none', 'body-bytes', 'effects-bytes', 'missing-layer-hash', 'stale-layer-hash']) {
    const { root, run, catalog } = await fixture();
    try {
      const bytes = await readFile(join(root, 'pose.png'));
      await writeFile(join(root, 'body.png'), bytes);
      await writeFile(join(root, 'effects.png'), bytes);
      const ref = (path: string) => ({ path, sha256: sha256(bytes) });
      const first = catalog.families[0];
      await writeFile(join(root, 'catalog.json'), JSON.stringify({ ...catalog, families: [{ ...first,
        drawings: [{ ...first.drawings[0], layers: { kind: 'separate', body: ref('body.png'), effects: ref('effects.png') } }],
        identityReview: { ...first.identityReview, drawings: [{ ...first.identityReview.drawings[0],
          bodySha256: change === 'missing-layer-hash' ? null : change === 'stale-layer-hash' ? '0'.repeat(64) : sha256(bytes), effectsSha256: sha256(bytes) }] },
      }, ...catalog.families.slice(1)] }));
      if (change === 'body-bytes') await writeFile(join(root, 'body.png'), 'changed body');
      if (change === 'effects-bytes') await writeFile(join(root, 'effects.png'), 'changed effects');
      const result = run();
      if (change === 'none') assert.equal(result.status, 0, result.stderr);
      else { assert.notEqual(result.status, 0); assert.match(result.stderr, /Asset hash mismatch|identity drawing hashes/); }
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test('a failed unused family cannot hide behind the first family of its tier', async () => {
  const { root, run, families, saveCatalog } = await fixture();
  try {
    families.push({ ...families[0], familyId: 'unused-simple', identityReview: { ...families[0].identityReview, kind: 'needs-repaint' } });
    await saveCatalog();
    const result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /unused-simple: identity review needs-repaint/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
