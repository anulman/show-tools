import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { verifyStreetAsset, type StreetAsset } from '../lib/video/street-assets.js';
import { parseStreetScene, type ActorFrame } from '../lib/video/street-score.js';
import { createStreetSampler } from '../lib/video/street-sampler.js';
import { streetPoofPlacement } from '../lib/video/presentation.js';
import { spritePlacement } from './export-street-preview.js';

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Mask = { readonly pixels: Buffer; readonly width: number; readonly height: number };
type PositionedMask = Mask & { readonly left: number; readonly top: number };

function alphaAt(mask: PositionedMask, x: number, y: number): number {
  const localX = x - mask.left, localY = y - mask.top;
  return localX < 0 || localY < 0 || localX >= mask.width || localY >= mask.height ? 0
    : mask.pixels[(localY * mask.width + localX) * 4 + 3];
}

function occupied(mask: PositionedMask, visit: (x: number, y: number, alpha: number) => void) {
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) {
    const alpha = mask.pixels[(y * mask.width + x) * 4 + 3];
    if (alpha > 0) visit(mask.left + x, mask.top + y, alpha);
  }
}

export async function verifyStreetPresence({ scenePath, assetRoot, wasmPath }: {
  scenePath: string; assetRoot: string; wasmPath: string;
}) {
  const sceneBytes = await readFile(scenePath), wasmBytes = await readFile(wasmPath);
  const parsed: unknown = JSON.parse(sceneBytes.toString('utf8'));
  const scene = parseStreetScene(parsed);
  if (scene.staging.kind !== 'poof') throw new Error('Presence verification requires poof staging');
  const staging = scene.staging, root = resolve(assetRoot);
  const verifiedAssets = new Map<string, string>();
  const masks = new Map<string, Promise<Mask>>();
  async function mask(asset: StreetAsset, scale: number): Promise<Mask> {
    const key = `${asset.path}:${asset.sha256}:${scale}`;
    let cached = masks.get(key);
    if (!cached) {
      cached = (async () => {
        const path = resolve(root, asset.path.replace(/^\/+/, ''));
        const within = relative(root, path);
        if (within === '..' || within.startsWith('../') || isAbsolute(within)) throw new Error(`Asset leaves assetRoot: ${asset.path}`);
        const bytes = await readFile(path);
        await verifyStreetAsset(asset, bytes);
        verifiedAssets.set(asset.path, asset.sha256);
        const decoded = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const width = Math.max(1, Math.round(decoded.info.width * scale));
        const height = Math.max(1, Math.round(decoded.info.height * scale));
        const pixels = await sharp(decoded.data, { raw: { width: decoded.info.width, height: decoded.info.height, channels: 4 } })
          .resize(width, height, { kernel: 'nearest' }).raw().toBuffer();
        return { pixels, width, height };
      })();
      masks.set(key, cached);
    }
    return cached;
  }
  async function body(frame: ActorFrame): Promise<PositionedMask> {
    const actor = scene.actors[frame.actor], drawing = actor.clips[frame.clip].drawings[frame.pose];
    return { ...await mask(drawing, actor.placement.scale), ...spritePlacement(actor.placement, drawing.pivot) };
  }
  async function poof(actorIndex: number, effectIndex: number, pose: number): Promise<PositionedMask> {
    const actor = scene.actors[actorIndex], effect = staging.effects[effectIndex];
    const track = staging.tracks.find(track => track.actor === actorIndex);
    if (!track) throw new Error('Missing presence track');
    const placement = streetPoofPlacement(actor, track);
    return { ...await mask(effect.drawings[pose], placement.scale), ...spritePlacement(placement, effect.pivot) };
  }
  const effectFits = [];
  for (const track of staging.tracks) {
    const used = new Set(track.keys.flatMap(key => key.poof === null ? [] : [key.poof.effect]));
    for (const effect of used) for (let pose = 0; pose < 6; pose++) {
      const image = await poof(track.actor, effect, pose);
      let occupiedPixels = 0, clippedPixels = 0, opaqueClippedPixels = 0;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      occupied(image, (x, y, alpha) => {
        occupiedPixels++; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) { clippedPixels++; if (alpha === 255) opaqueClippedPixels++; }
      });
      effectFits.push({ actor: track.actor, characterId: scene.actors[track.actor].characterId, effect, effectId: staging.effects[effect].id, pose,
        occupiedPixels, clippedPixels, opaqueClippedPixels,
        bounds: occupiedPixels ? { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 } : null, pass: clippedPixels === 0 });
    }
  }
  const sampler = await createStreetSampler(wasmBytes, scene);
  try {
    const transitions = [];
    for (const track of staging.tracks) {
      let previousVisible = false;
      for (const key of track.keys) {
        const at = sampler.sample(key.at), frame = at.find(frame => frame.actor === track.actor);
        if (!frame) throw new Error('Native sampler omitted actor');
        if (frame.visible === previousVisible) continue;
        const beforeCount = key.at === 0 ? -Number.EPSILON : key.at - Number.EPSILON * Math.max(1, Math.abs(key.at));
        const before = sampler.sample(beforeCount).find(frame => frame.actor === track.actor);
        if (!before) throw new Error('Native sampler omitted outgoing actor');
        const peak = frame.poof === null ? null : await poof(track.actor, frame.poof.effect, frame.poof.pose);
        const coverage = [];
        for (const [side, count, sampled] of [['outgoing', beforeCount, before], ['incoming', key.at, frame]] satisfies Array<[string, number, ActorFrame]>) {
          let occupiedPixels = 0, uncoveredPixels = 0;
          const examples: Array<{ x: number; y: number }> = [];
          occupied(await body(sampled), (x, y) => {
            occupiedPixels++;
            if (peak === null || alphaAt(peak, x, y) !== 255) {
              uncoveredPixels++;
              if (examples.length < 8) examples.push({ x, y });
            }
          });
          coverage.push({ side, count, clip: sampled.clip, pose: sampled.pose, occupiedPixels, uncoveredPixels, examples, pass: uncoveredPixels === 0 });
        }
        const neighborOcclusions = [];
        if (peak !== null) for (const neighbor of at) if (neighbor.actor !== track.actor && neighbor.visible) {
          let opaqueOverlapPixels = 0;
          occupied(await body(neighbor), (x, y) => { if (alphaAt(peak, x, y) === 255) opaqueOverlapPixels++; });
          const cloudDepth = scene.actors[track.actor].placement.depth, neighborDepth = scene.actors[neighbor.actor].placement.depth;
          const cloudInFrontOfNeighbor = cloudDepth > neighborDepth || (cloudDepth === neighborDepth && track.actor > neighbor.actor);
          if (opaqueOverlapPixels) neighborOcclusions.push({ actor: neighbor.actor, characterId: scene.actors[neighbor.actor].characterId, opaqueOverlapPixels,
            cloudInFrontOfNeighbor, actualOpaqueOcclusionPixels: cloudInFrontOfNeighbor ? opaqueOverlapPixels : 0 });
        }
        const atOpaquePeak = frame.poof?.pose === 2;
        transitions.push({ actor: track.actor, characterId: scene.actors[track.actor].characterId, at: key.at,
          fromVisible: previousVisible, toVisible: frame.visible, sampledPoof: frame.poof, atOpaquePeak, coverage, neighborOcclusions,
          pass: atOpaquePeak && coverage.every(result => result.pass) });
        previousVisible = frame.visible;
      }
    }
    return { kind: 'actual-street-presence-admission', sceneSha256: sha256(sceneBytes), wasmSha256: sha256(wasmBytes),
      admission: transitions.every(transition => transition.pass) && effectFits.every(fit => fit.pass),
      transitions, effectFits, assets: Object.fromEntries([...verifiedAssets].sort(([a], [b]) => a.localeCompare(b))),
      neighborOcclusionPolicy: 'Diagnostic geometric opaque overlaps with visible actors and occlusion under renderer depth/actor-index order; artistic intent is not inferred.' };
  } finally { sampler.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [scenePath, assetRoot, wasmPath, reportPath, ...extra] = process.argv.slice(2);
    if (!scenePath || !assetRoot || !wasmPath || extra.length) throw new Error('Usage: verify-street-presence.ts SCENE ASSET_ROOT WASM [NEW_REPORT_JSON]');
    const report = await verifyStreetPresence({ scenePath, assetRoot, wasmPath });
    const text = `${JSON.stringify(report, null, 2)}\n`;
    if (reportPath) await writeFile(reportPath, text, { flag: 'wx' });
    process.stdout.write(text);
    if (!report.admission) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
