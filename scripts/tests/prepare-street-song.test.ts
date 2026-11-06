import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { Schema } from 'effect';
import sourceInput from '../../songs/dance-yrself-clean.source.json';
import mapping from '../../songs/dance-yrself-clean.mapping.json';
import promoted from '../../assets/video/motion/poof/scene-fits/street.json';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';
import { readMusicXmlSong } from '../../lib/performance/musicxml-song.js';
import { parseSongSource } from '../../lib/performance/song-source.js';
import { discoverSheetVoices } from '../../lib/voice-catalog/sheet-voices.js';
import { reconcileCatalog } from '../../lib/voice-catalog/session.js';
import { parseStreetScene } from '../../lib/video/street-score.js';
import { PoofCatalog, POOF_CATALOG_PATH } from '../video-expansion/poof-release.mjs';

const checkout = fileURLToPath(new URL('../../', import.meta.url));
const command = fileURLToPath(new URL('../prepare-street-song.ts', import.meta.url));
const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const source = parseSongSource(sourceInput);
const { xml: musicxml } = await importSheetMusicXml({ source, mapping });
const { song: compiled } = await readMusicXmlSong(musicxml);
const rows = discoverSheetVoices(compiled, source);
let serial = 0;
const saved = reconcileCatalog({ version: 2, revision: 0, voices: [], bindings: [] }, rows, new Map(), () => `cli-fixture-${++serial}`);
const catalog = { ...saved, voices: saved.voices.map((voice, index) => ({ ...voice, characterId: promoted.actors[index].code })) };

async function fixture() {
  const root = await mkdtemp('/private/tmp/street-song-cli-');
  const assetRoot = join(root, 'assets'); await mkdir(assetRoot);
  async function saveAsset(path: string, bytes: Uint8Array | string) {
    const target = join(assetRoot, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); return target;
  }
  const poofBytes = await readFile(join(checkout, POOF_CATALOG_PATH));
  const poofs = Schema.decodeUnknownSync(PoofCatalog)(JSON.parse(poofBytes.toString('utf8')));
  const poofPath = await saveAsset(POOF_CATALOG_PATH, poofBytes);
  for (const candidate of poofs.candidates) for (const drawing of candidate.drawings) {
    const target = join(assetRoot, drawing.native.path); await mkdir(dirname(target), { recursive: true });
    await copyFile(join(checkout, drawing.native.path), target);
  }
  const characterBytes = JSON.stringify({ kind: 'synthetic CLI test catalog; no artwork approval claim' });
  const characterPath = await saveAsset(promoted.characterCatalog.path, characterBytes);
  const fit = { ...promoted, characterCatalog: { ...promoted.characterCatalog, sha256: hash(characterBytes) } };
  const fitPath = join(root, 'fit.json'), fitText = `${JSON.stringify(fit)}\n`;
  await writeFile(fitPath, fitText);
  const bodyBytes = await sharp({ create: { width: 64, height: 80, channels: 4, background: '#a06040' } }).png().toBuffer();
  const bodyPath = await saveAsset('body.png', bodyBytes);
  const backgroundBytes = await sharp({ create: { width: 1280, height: 720, channels: 4, background: '#102030' } }).png().toBuffer();
  const backgroundPath = await saveAsset('background.png', backgroundBytes);
  const assets = {
    version: 2, kind: 'authored-street-preview', width: 1280, height: 720,
    background: { path: '/background.png', sha256: hash(backgroundBytes) }, durationCounts: 32,
    previewCountsPerSecond: 2, countedBeatUnit: 4, tracks: [],
    actors: fit.actors.map((actor, index) => ({ characterId: actor.code, role: 'instrument',
      placement: { ...actor.bodyAnchor, scale: actor.bodyScale, depth: index },
      clips: ['simple', 'vigorous', 'special', 'ultra'].map(tier => ({ id: `${actor.code}-${tier}`, tier,
        cycleQuarters: 2, actionQuarters: null, nativeGrid: { width: 64, height: 80 }, sourceOffset: { x: 0, y: 0 },
        keys: [{ atQuarter: 0, pose: 0 }], drawings: [{ path: '/body.png', sha256: hash(bodyBytes),
          pivot: { x: (actor.bodyAnchor.x - actor.bodyFrame.x) / actor.bodyScale, y: (actor.bodyAnchor.y - actor.bodyFrame.y) / actor.bodyScale } }],
      })),
    })),
    provenance: { source: 'synthetic CLI publication fixture', assetsDigest: 'fixture', scoreDigest: 'fixture' },
  };
  const inputs = [join(root, 'catalog.json'), join(root, 'song.musicxml'), join(root, 'scene-assets.json')];
  await Promise.all(inputs.map((path, index) => writeFile(path, [JSON.stringify(catalog), musicxml, JSON.stringify(assets)][index])));
  const output = join(root, 'prepared.json');
  const flags = ['--poof-fit', fitPath, '--asset-root', assetRoot, '--fit-sha256', hash(fitText)];
  const run = (options: { output?: string; flags?: readonly string[] } = {}) => spawnSync(process.execPath,
    ['--import', 'tsx', command, ...inputs, options.output ?? output, ...(options.flags ?? flags)], { encoding: 'utf8' });
  return { root, assetRoot, fit, fitPath, fitText, inputs, output, flags, run, characterPath, poofPath, bodyPath, backgroundPath,
    effectPath: join(assetRoot, poofs.candidates[0].drawings[0].native.path) };
}

test('CLI accepts canonical MusicXML with four positional inputs and publishes pinned presence assets in the same atomic artifact', async () => {
  const f = await fixture();
  try {
    const original = f.run({ flags: [] }); assert.equal(original.status, 0, original.stderr);
    assert.equal(parseStreetScene(JSON.parse(await readFile(f.output, 'utf8'))).staging.kind, 'all-present');
    const result = f.run(); assert.equal(result.status, 0, result.stderr);
    const artifact = JSON.parse(await readFile(f.output, 'utf8'));
    const scene = parseStreetScene(artifact);
    assert.equal(scene.staging.kind, 'poof'); assert.equal(scene.actors.length, 8);
    assert.equal(artifact.preparationReceipt.cells.length, 1744);
    if (scene.staging.kind === 'poof') assert.deepEqual(scene.staging.effects.map(effect => effect.id), ['pixel', 'soft', 'star']);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('incomplete flags, wrong raw fit hash and rejected fit cannot replace a previous prepared artifact', async () => {
  const f = await fixture();
  try {
    await writeFile(f.output, 'previous complete artifact');
    for (const flags of [f.flags.slice(0, 2), ['--poof-fit', f.fitPath, '--asset-root', f.assetRoot], [...f.flags.slice(0, -1), '0'.repeat(64)]]) {
      const result = f.run({ flags }); assert.notEqual(result.status, 0);
      assert.equal(await readFile(f.output, 'utf8'), 'previous complete artifact');
    }
    await writeFile(f.fitPath, '{not valid JSON');
    const beforeDecode = f.run(); assert.notEqual(beforeDecode.status, 0); assert.match(beforeDecode.stderr, /Pinned Street fit profile hash mismatch/);
    assert.equal(await readFile(f.output, 'utf8'), 'previous complete artifact');
    const rejected = JSON.stringify({ ...f.fit, status: 'draft' }); await writeFile(f.fitPath, rejected);
    const unapproved = f.run({ flags: [...f.flags.slice(0, -1), hash(rejected)] }); assert.notEqual(unapproved.status, 0);
    assert.equal(await readFile(f.output, 'utf8'), 'previous complete artifact');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('fit, catalog and referenced image input aliases are rejected through direct, hardlink and symlink outputs', async () => {
  const f = await fixture();
  try {
    const sources = [f.fitPath, f.poofPath, f.characterPath, f.bodyPath, f.effectPath, f.backgroundPath];
    for (const [index, path] of sources.entries()) {
      const original = await readFile(path), hard = join(f.root, `hard-${index}.json`), soft = join(f.root, `soft-${index}.json`);
      await link(path, hard); await symlink(path, soft);
      for (const output of [path, hard, soft]) {
        const result = f.run({ output }); assert.notEqual(result.status, 0, path); assert.match(result.stderr, /aliases an input/, result.stderr);
        assert.deepEqual(await readFile(path), original);
      }
    }
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('character catalog corruption and physical asset-root escapes fail without replacing output', async () => {
  const f = await fixture();
  try {
    await writeFile(f.output, 'previous complete artifact');
    const original = await readFile(f.characterPath);
    await writeFile(f.characterPath, 'different character catalog');
    const corrupt = f.run(); assert.notEqual(corrupt.status, 0); assert.match(corrupt.stderr, /Pinned character catalog hash mismatch/);
    assert.equal(await readFile(f.output, 'utf8'), 'previous complete artifact');
    await writeFile(f.characterPath, original);
    const outside = join(f.root, 'outside.png'); await copyFile(f.bodyPath, outside); await rm(f.bodyPath); await symlink(outside, f.bodyPath);
    const escaped = f.run(); assert.notEqual(escaped.status, 0); assert.match(escaped.stderr, /symlink leaves --asset-root/);
    assert.equal(await readFile(f.output, 'utf8'), 'previous complete artifact');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
