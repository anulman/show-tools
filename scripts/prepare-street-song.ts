import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Schema } from 'effect';
import { prepareStreetSong } from '../lib/video/song-score.js';
import { publishPreparedArtifact } from '../lib/video/prepared-artifact.js';
import { StreetScene, type StreetPoofEffect } from '../lib/video/street-score.js';
import { parseStreetFitProfile, StreetFitProfileSchema, type StreetFitProfile } from '../lib/video/street-fit.js';
import { POOF_CATALOG_PATH, readPoofRelease } from './video-expansion/poof-release.mjs';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'poof-fit': { type: 'string' }, 'asset-root': { type: 'string' }, 'fit-sha256': { type: 'string' },
} });
const [catalogPath, sourcePath, mappingPath, assetsPath, output] = positionals;
if (positionals.length !== 5 || !catalogPath || !sourcePath || !mappingPath || !assetsPath || !output) throw new Error('Usage: prepare-street-song.ts catalog.json source.json mapping.json assets-scene.json output.json [--poof-fit PROFILE --asset-root ROOT --fit-sha256 SHA256] (private inputs/output)');
const fitPath = values['poof-fit'], assetRoot = values['asset-root'], expectedFitHash = values['fit-sha256'];
if ([fitPath, assetRoot, expectedFitHash].some(value => value !== undefined) && (!fitPath || !assetRoot || !expectedFitHash)) throw new Error('--poof-fit, --asset-root and --fit-sha256 must be supplied together');
const [catalog, source, mapping, assets]: unknown[] = await Promise.all([catalogPath, sourcePath, mappingPath, assetsPath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const inputs = new Set([catalogPath, sourcePath, mappingPath, assetsPath]);
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let presence: { effects: readonly StreetPoofEffect[]; fitProfile: StreetFitProfile; poofCatalogSha256: string; fitProfileSha256: string } | undefined;
if (fitPath && assetRoot && expectedFitHash) {
  const bytes = await readFile(fitPath), fitProfileSha256 = sha256(bytes);
  if (fitProfileSha256 !== expectedFitHash) throw new Error('Pinned Street fit profile hash mismatch');
  const parsed: unknown = JSON.parse(bytes.toString('utf8'));
  const fit = Schema.decodeUnknownSync(StreetFitProfileSchema)(parsed);
  if (fit.poofCatalog.path !== POOF_CATALOG_PATH) throw new Error('Street fit must reference the canonical poof catalog path');
  const release = await readPoofRelease({ releaseRoot: assetRoot, catalogSha256: fit.poofCatalog.sha256 });
  const root = release.releaseRoot;
  async function protectedAsset(path: string): Promise<string> {
    if (path.includes('\\')) throw new Error(`Unsafe asset path: ${path}`);
    const target = resolve(root, path.replace(/^\/+/, ''));
    const within = relative(root, target);
    if (within === '..' || within.startsWith('../') || isAbsolute(within)) throw new Error(`Asset leaves --asset-root: ${path}`);
    const physical = await realpath(target), physicalWithin = relative(root, physical);
    if (physicalWithin === '..' || physicalWithin.startsWith('../') || isAbsolute(physicalWithin)) throw new Error(`Asset symlink leaves --asset-root: ${path}`);
    inputs.add(target);
    return target;
  }
  const characterCatalogPath = await protectedAsset(fit.characterCatalog.path);
  const characterCatalogSha256 = sha256(await readFile(characterCatalogPath));
  if (characterCatalogSha256 !== fit.characterCatalog.sha256) throw new Error('Pinned character catalog hash mismatch');
  const effects: StreetPoofEffect[] = [...release.catalog.candidates].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map(candidate => ({
    id: candidate.id, nativeGrid: candidate.nativeGrid, pivot: candidate.anchor,
    drawings: candidate.drawings.map(drawing => ({ path: `/${drawing.native.path}`, sha256: drawing.native.sha256 })),
  }));
  const scene = Schema.decodeUnknownSync(StreetScene)(assets);
  const fitProfile = parseStreetFitProfile(parsed, { scene, effects, poofCatalogSha256: release.catalogSha256, characterCatalogSha256 });
  inputs.add(fitPath);
  await protectedAsset(POOF_CATALOG_PATH);
  await Promise.all([scene.background, ...scene.actors.flatMap(actor => actor.clips.flatMap(clip => clip.drawings)), ...effects.flatMap(effect => effect.drawings)]
    .map(asset => protectedAsset(asset.path)));
  presence = { effects, fitProfile, poofCatalogSha256: release.catalogSha256, fitProfileSha256 };
}
const result = await prepareStreetSong({ catalog, source, mapping, assets, ...(presence ? { presence } : {}) });
if (result.kind === 'blocked') {
  process.stderr.write(`${JSON.stringify(result.diagnostics, null, 2)}\n`);
  process.exitCode = 1;
} else {
  await publishPreparedArtifact({ output, inputs: [...inputs],
    artifact: { ...result.scene, preparationReceipt: result.receipt } });
  process.stdout.write(`Prepared ${result.scene.actors.length} actors, ${result.scene.durationCounts} counts, ${(result.scene.durationCounts / result.scene.previewCountsPerSecond).toFixed(6)} seconds.\n`);
}
