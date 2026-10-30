import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseStreetScene } from '../../lib/video/street-score.js';
import { verifyStreetPresence } from '../verify-street-presence.js';

const wasmPath = new URL('../../ui/video/wasm/video-scene.wasm', import.meta.url).pathname;
const command = new URL('../verify-street-presence.ts', import.meta.url).pathname;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(options: { scale?: number; anchorX?: number; offsetX?: number; outgoingExtra?: boolean; neighbor?: boolean; wrongPeak?: boolean; initialVisible?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'presence-admission-'));
  async function png(name: string, width: number, height: number, pixels: readonly (readonly [number, number])[]) {
    const rgba = Buffer.alloc(width * height * 4);
    for (const [x, y] of pixels) rgba.set([180, 90, 50, 255], (y * width + x) * 4);
    const bytes = await sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer();
    await writeFile(join(root, name), bytes);
    return { path: `/${name}`, sha256: hash(bytes) };
  }
  const outgoing = await png('outgoing.png', 8, 10, options.outgoingExtra ? [[6, 7], [0, 0]] : [[6, 7]]);
  const incoming = await png('incoming.png', 10, 12, [[2, 3]]);
  const background = await png('background.png', 256, 256, []);
  const peakPixels: Array<[number, number]> = [];
  for (let y = 90; y <= 115; y++) for (let x = 50; x <= 80; x++) peakPixels.push([x, y]);
  if (options.outgoingExtra) {
    peakPixels.length = 0;
    for (let y = 102; y <= 110; y++) for (let x = 60; x <= 68; x++) peakPixels.push([x, y]);
  }
  const effect = await png('peak.png', 128, 128, peakPixels);
  const actor = { characterId: 'subject', role: 'instrument', placement: { x: options.anchorX ?? 128, y: 150, scale: options.scale ?? 1.5, depth: 0 },
    clips: ['simple', 'vigorous', 'special'].map(tier => ({ id: tier, tier, cycleQuarters: 2, actionQuarters: null,
      nativeGrid: { width: 64, height: 80 }, sourceOffset: { x: 99, y: 99 }, keys: [{ atQuarter: 0, pose: 0 }],
      drawings: [{ ...outgoing, pivot: { x: 7, y: 8 } }, { ...incoming, pivot: { x: 3, y: 4 } }],
    })),
  };
  const subjectKeys = [
    { at: 0, visible: options.initialVisible ?? false, poof: options.initialVisible ? { effect: 0, pose: 2 } : null },
    { at: 1, visible: true, poof: { effect: 0, pose: options.wrongPeak ? 1 : 2 } },
    { at: 2, visible: false, poof: { effect: 0, pose: 2 } },
  ];
  const scene = parseStreetScene({ version: 2, kind: 'authored-street-preview', width: 256, height: 256, background,
    previewCountsPerSecond: 2, durationCounts: 3, countedBeatUnit: 4,
    actors: [actor, ...(options.neighbor ? [{ ...actor, characterId: 'neighbor', placement: { ...actor.placement, depth: 1 } }] : [])],
    tracks: [0, ...(options.neighbor ? [1] : [])].map(actor => ({ actor, keys: [
      { at: 0, clip: 0, pose: 0, grayscale: false }, { at: 1, clip: 1, pose: 1, grayscale: true }, { at: 2, clip: 0, pose: 0, grayscale: false },
    ] })),
    staging: { kind: 'poof', effects: [{ id: 'synthetic', nativeGrid: { width: 128, height: 128 }, pivot: { x: 64, y: 106 }, drawings: Array.from({ length: 6 }, () => effect) }],
      tracks: [{ actor: 0, offset: { x: options.offsetX ?? 0, y: 0 }, keys: subjectKeys }, ...(options.neighbor ? [{ actor: 1, offset: { x: 0, y: 0 }, keys: [{ at: 0, visible: true, poof: { effect: 0, pose: 2 } }] }] : [])] },
    provenance: { source: 'synthetic', assetsDigest: 'fixture', scoreDigest: 'fixture' },
  });
  const scenePath = join(root, 'scene.json');
  const save = () => writeFile(scenePath, JSON.stringify(scene));
  await save();
  const run = () => verifyStreetPresence({ scenePath, assetRoot: root, wasmPath });
  return { root, scenePath, scene, save, run };
}

test('actual native flips admit combined padded drawings with distinct pivots and rounded nearest scaling', async () => {
  const f = await fixture();
  try {
    const report = await f.run();
    assert.equal(report.admission, true);
    assert.equal(report.transitions.length, 2);
    assert.equal(report.effectFits.length, 6);
    const entry = report.transitions[0];
    assert.equal(entry.at, 1); assert.equal(entry.atOpaquePeak, true);
    assert.deepEqual(entry.coverage.map(side => side.pose), [0, 1]);
    assert(entry.coverage.every(side => side.occupiedPixels > 0 && side.uncoveredPixels === 0));
    assert.equal(entry.coverage[0].clip, 0); assert.equal(entry.coverage[1].clip, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('combined outgoing pixels outside the peak reject despite covered incoming art', async () => {
  const f = await fixture({ outgoingExtra: true });
  try {
    const report = await f.run();
    assert.equal(report.admission, false);
    assert(report.transitions[0].coverage[0].uncoveredPixels > 0);
    assert.equal(report.transitions[0].coverage[1].uncoveredPixels, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('merged peak holds inspect intervening body poses and deduplicate shared key times', async () => {
  const f = await fixture();
  try {
    assert(f.scene.staging.kind === 'poof');
    const rgba = Buffer.alloc(30 * 20 * 4);
    for (const x of [0, 29]) rgba.set([180, 90, 50, 255], x * 4);
    const bytes = await sharp(rgba, { raw: { width: 30, height: 20, channels: 4 } }).png().toBuffer();
    await writeFile(join(f.root, 'wide.png'), bytes);
    const staging = { ...f.scene.staging, tracks: f.scene.staging.tracks.map(track => ({ ...track,
      keys: [...track.keys, { at: 1.5, visible: true, poof: { effect: 0, pose: 2 } }].sort((a, b) => a.at - b.at),
    })) };
    const tracks = f.scene.tracks.map(track => ({ ...track, keys: [...track.keys,
      { at: 1.5, clip: 1, pose: 2, grayscale: false }, { at: 1.75, clip: 1, pose: 1, grayscale: false },
    ].sort((a, b) => a.at - b.at) }));
    async function runWithPivot(x: number) {
      const actors = f.scene.actors.map(actor => ({ ...actor, clips: actor.clips.map(clip => ({ ...clip,
        drawings: [...clip.drawings, { path: '/wide.png', sha256: hash(bytes), pivot: { x, y: 1 } }],
      })) }));
      await writeFile(f.scenePath, JSON.stringify({ ...f.scene, actors, tracks, staging }));
      return f.run();
    }
    const failed = await runWithPivot(15);
    assert(failed.transitions.every(transition => transition.pass));
    assert(failed.effectFits.every(fit => fit.pass));
    assert.equal(failed.admission, false);
    assert(failed.peakHolds.find(hold => hold.at === 1.5)?.uncoveredPixels);
    assert.equal(failed.peakHolds.filter(hold => hold.at === 1.5).length, 1);
    const passed = await runWithPivot(13);
    assert.equal(passed.admission, true, JSON.stringify(passed.peakHolds));
    assert(passed.peakHolds.every(hold => hold.pass));
    assert.equal(passed.peakHolds.filter(hold => hold.at === 1.5).length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('world-space effect offset fixes occupied edge clipping without moving character art', async () => {
  const f = await fixture({ scale: 1, anchorX: 6 });
  try {
    const failed = await f.run();
    assert.equal(failed.admission, false);
    assert(failed.effectFits.some(fit => fit.opaqueClippedPixels > 0));
    const bodyBefore = JSON.stringify(f.scene.actors);
    assert.equal(f.scene.staging.kind, 'poof');
    if (f.scene.staging.kind !== 'poof') return;
    const changed = { ...f.scene, staging: { ...f.scene.staging, tracks: f.scene.staging.tracks.map(track => ({ ...track, offset: { x: 8, y: 0 } })) } };
    await writeFile(f.scenePath, JSON.stringify(changed));
    const passed = await f.run();
    assert.equal(passed.admission, true);
    assert(passed.effectFits.every(fit => fit.clippedPixels === 0));
    assert.equal(JSON.stringify(changed.actors), bodyBefore);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('all six drawings of a used variant are checked, including an unsampled clipped tail', async () => {
  const f = await fixture({ scale: 1, anchorX: 6 });
  try {
    assert(f.scene.staging.kind === 'poof');
    const rgba = Buffer.alloc(128 * 128 * 4); rgba.set([0, 0, 0, 255], (106 * 128) * 4);
    const bytes = await sharp(rgba, { raw: { width: 128, height: 128, channels: 4 } }).png().toBuffer();
    await writeFile(join(f.root, 'tail.png'), bytes);
    const effect = f.scene.staging.effects[0];
    await writeFile(f.scenePath, JSON.stringify({ ...f.scene, staging: { ...f.scene.staging,
      tracks: f.scene.staging.tracks.map(track => ({ ...track, offset: { x: 8, y: 0 } })),
      effects: [{ ...effect, drawings: effect.drawings.map((drawing, index) => index === 5 ? { path: '/tail.png', sha256: hash(bytes) } : drawing) }],
    } }));
    const report = await f.run();
    assert.equal(report.admission, false);
    assert.equal(report.effectFits.find(fit => fit.pose === 5)?.opaqueClippedPixels, 1);
    assert(report.transitions.every(transition => transition.pass));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('mask admission uses independent cloud scale while preserving the body geometry', async () => {
  const f = await fixture({ scale: 3 });
  try {
    assert(f.scene.staging.kind === 'poof');
    const originalBodies = JSON.stringify(f.scene.actors);
    const smaller = { ...f.scene, staging: { ...f.scene.staging,
      tracks: f.scene.staging.tracks.map(track => ({ ...track, scale: 1 })) } };
    await writeFile(f.scenePath, JSON.stringify(smaller));
    const passed = await f.run();
    assert.equal(passed.admission, true);
    const bounds = passed.effectFits[0].bounds;
    assert(bounds);
    assert.equal(bounds.right - bounds.left, 31);
    assert.equal(passed.transitions[0].coverage[0].occupiedPixels, 9);
    assert.equal(JSON.stringify(smaller.actors), originalBodies);
    await writeFile(f.scenePath, JSON.stringify({ ...smaller, staging: { ...smaller.staging,
      tracks: smaller.staging.tracks.map(track => ({ ...track, scale: .1 })) } }));
    assert.equal((await f.run()).admission, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('wrong PNG bytes reject before decoding and a nonpeak switch cannot pass on opaque pixels alone', async () => {
  const f = await fixture({ wrongPeak: true });
  try {
    const report = await f.run();
    assert.equal(report.admission, false);
    assert.equal(report.transitions[0].atOpaquePeak, false);
    assert(report.transitions[0].coverage.every(side => side.pass));
    await writeFile(join(f.root, 'outgoing.png'), 'not even an image');
    await assert.rejects(f.run(), /Asset hash mismatch/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('visible at zero requires peak masking and neighbor occlusion is an explicit diagnostic', async () => {
  const f = await fixture({ initialVisible: true, neighbor: true });
  try {
    const report = await f.run();
    assert.equal(report.admission, true);
    assert(report.transitions.some(transition => transition.at === 0 && transition.actor === 0));
    assert(report.transitions.some(transition => transition.neighborOcclusions.some(neighbor => neighbor.opaqueOverlapPixels > 0)));
    const behind = report.transitions.find(transition => transition.actor === 0)?.neighborOcclusions.find(neighbor => neighbor.actor === 1);
    assert(behind && behind.opaqueOverlapPixels > 0);
    assert.equal(behind.cloudInFrontOfNeighbor, false);
    assert.equal(behind.actualOpaqueOcclusionPixels, 0);
    const inFront = report.transitions.find(transition => transition.actor === 1)?.neighborOcclusions.find(neighbor => neighbor.actor === 0);
    assert(inFront && inFront.opaqueOverlapPixels > 0);
    assert.equal(inFront.cloudInFrontOfNeighbor, true);
    assert.equal(inFront.actualOpaqueOcclusionPixels, inFront.opaqueOverlapPixels);
    assert(f.scene.staging.kind === 'poof');
    await writeFile(f.scenePath, JSON.stringify({ ...f.scene, staging: { ...f.scene.staging, tracks: f.scene.staging.tracks.map(track => ({ ...track,
      keys: track.keys.map(key => key.at === 0 ? { ...key, poof: null } : key),
    })) } }));
    assert.equal((await f.run()).admission, false);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('CLI writes one exclusive report and exits nonzero for failed admission', async () => {
  const f = await fixture({ wrongPeak: true });
  try {
    const reportPath = join(f.root, 'report.json');
    const args = ['--import', 'tsx', command, f.scenePath, f.root, wasmPath, reportPath];
    const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(first.status, 1, first.stderr);
    const original = await readFile(reportPath, 'utf8');
    assert.equal(JSON.parse(original).admission, false);
    const second = spawnSync(process.execPath, args, { encoding: 'utf8' });
    assert.equal(second.status, 1); assert.match(second.stderr, /EEXIST/);
    assert.equal(await readFile(reportPath, 'utf8'), original);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('CLI runs through a checkout symlink and cannot silently skip failed admission', async () => {
  const f = await fixture({ wrongPeak: true });
  try {
    const alias = join(f.root, 'checkout');
    await symlink(fileURLToPath(new URL('../../', import.meta.url)), alias, 'dir');
    const entry = join(alias, 'scripts/verify-street-presence.ts');
    const usage = spawnSync(process.execPath, ['--import', 'tsx', entry], { encoding: 'utf8' });
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /Usage: verify-street-presence/);
    const reportPath = join(f.root, 'alias-report.json');
    const failed = spawnSync(process.execPath, ['--import', 'tsx', entry, f.scenePath, f.root, wasmPath, reportPath], { encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr);
    assert.equal(JSON.parse(await readFile(reportPath, 'utf8')).admission, false);
    assert(f.scene.staging.kind === 'poof');
    await writeFile(f.scenePath, JSON.stringify({ ...f.scene, staging: { ...f.scene.staging,
      tracks: f.scene.staging.tracks.map(track => ({ ...track, keys: track.keys.map(key => ({ ...key,
        poof: key.poof === null ? null : { ...key.poof, pose: 2 },
      })) })),
    } }));
    const validReport = join(f.root, 'alias-valid.json');
    const valid = spawnSync(process.execPath, ['--import', 'tsx', entry, f.scenePath, f.root, wasmPath, validReport], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(JSON.parse(await readFile(validReport, 'utf8')).admission, true);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('stdin scripts can import the verifier API without invoking its CLI', () => {
  const moduleUrl = new URL('../verify-street-presence.ts', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-'], {
    encoding: 'utf8', input: `import { verifyStreetPresence } from ${JSON.stringify(moduleUrl)}; process.stdout.write(typeof verifyStreetPresence);`,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'function');
});

test('explicit pre-existing presence does not invent an entrance at song zero', async () => {
  const f = await fixture({ initialVisible: true });
  try {
    assert(f.scene.staging.kind === 'poof');
    const scene = { ...f.scene, staging: { ...f.scene.staging, tracks: f.scene.staging.tracks.map(track => ({ ...track,
      initiallyPresent: true, keys: track.keys.map(key => key.at === 0 ? { ...key, poof: null } : key),
    })) } };
    await writeFile(f.scenePath, JSON.stringify(scene));
    const report = await f.run();
    assert.equal(report.admission, true);
    assert(!report.transitions.some(transition => transition.at === 0));
    assert(report.transitions.some(transition => transition.at === 2));
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
