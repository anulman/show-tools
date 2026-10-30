import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Schema } from 'effect';
import sharp from 'sharp';
import { grayscaleRgba } from '../lib/video/presentation.js';
import { parseStreetScene, type PreparedStreetScene, type ActorFrame } from '../lib/video/street-score.js';
import { createStreetSampler } from '../lib/video/street-sampler.js';
import { verifyStreetAsset, type StreetAsset } from '../lib/video/street-assets.js';

const ExportOptions = Schema.Struct({
  scene: Schema.NonEmptyString,
  assetRoot: Schema.NonEmptyString,
  output: Schema.NonEmptyString,
  wasm: Schema.NonEmptyString,
  fps: Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(120)),
});
type ExportOptions = typeof ExportOptions.Type;
const parseOptions = Schema.decodeUnknownSync(ExportOptions);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const sha256 = (contents: Uint8Array) => createHash('sha256').update(contents).digest('hex');

export function parseExportArguments(args: readonly string[]): ExportOptions {
  const { values } = parseArgs({ args: [...args], options: {
    scene: { type: 'string' }, 'asset-root': { type: 'string' }, output: { type: 'string' },
    wasm: { type: 'string' }, fps: { type: 'string' },
  }, strict: true, allowPositionals: false });
  return parseOptions({ scene: values.scene, assetRoot: values['asset-root'], output: values.output,
    wasm: values.wasm ?? join(projectRoot, 'ui/video/wasm/video-scene.wasm'), fps: Number(values.fps ?? 30) });
}

export function exportFrameCount(scene: PreparedStreetScene, fps: number): number {
  const count = Math.ceil(scene.durationCounts * fps / scene.previewCountsPerSecond);
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('Export frame count is outside the supported range');
  return count;
}

function assetPath(root: string, path: string): string {
  const target = resolve(root, path.replace(/^\/+/, ''));
  const withinRoot = relative(root, target);
  if (withinRoot === '..' || withinRoot.startsWith('../') || isAbsolute(withinRoot)) throw new Error(`Asset leaves --asset-root: ${path}`);
  return target;
}

export function spritePlacement(placement: { readonly x: number; readonly y: number; readonly scale: number }, pivot: { readonly x: number; readonly y: number }) {
  return { left: Math.round(placement.x - pivot.x * placement.scale), top: Math.round(placement.y - pivot.y * placement.scale) };
}

export async function createStreetCompositor(scene: PreparedStreetScene, assetRoot: string) {
  const root = resolve(assetRoot);
  const assets = new Map<string, string>();
  async function load(asset: StreetAsset) {
    const bytes = await readFile(assetPath(root, asset.path));
    await verifyStreetAsset(asset, bytes);
    assets.set(asset.path, asset.sha256);
    return bytes;
  }
  const backgroundBytes = await load(scene.background);
  const background = await sharp(backgroundBytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (background.info.width !== scene.width || background.info.height !== scene.height) throw new Error('Street background dimensions differ from the authored scene');
  const cached = new Map<string, Promise<{ input: Buffer; width: number; height: number }>>();
  async function drawing(actorIndex: number, clipIndex: number, poseIndex: number, grayscale: boolean) {
    const actor = scene.actors[actorIndex], clip = actor?.clips[clipIndex], pose = clip?.drawings[poseIndex];
    if (!actor || !clip || !pose) throw new Error('Sampler returned an unknown Street drawing');
    const cacheKey = `${actorIndex}:${clipIndex}:${poseIndex}:${Number(grayscale)}`;
    let prepared = cached.get(cacheKey);
    if (!prepared) {
      prepared = (async () => {
        const { data, info } = await sharp(await load(pose)).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        if (grayscale) grayscaleRgba(data);
        const width = Math.max(1, Math.round(info.width * actor.placement.scale));
        const height = Math.max(1, Math.round(info.height * actor.placement.scale));
        const input = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
          .resize(width, height, { kernel: 'nearest' }).png().toBuffer();
        return { input, width, height };
      })();
      cached.set(cacheKey, prepared);
    }
    return prepared;
  }
  return {
    assets,
    async render(frames: readonly ActorFrame[]): Promise<Buffer> {
      const ordered = [...frames].sort((a, b) => scene.actors[a.actor].placement.depth - scene.actors[b.actor].placement.depth || a.actor - b.actor);
      const layers: Parameters<ReturnType<typeof sharp>['composite']>[0] = [];
      for (const frame of ordered) {
        const actor = scene.actors[frame.actor], pose = actor.clips[frame.clip].drawings[frame.pose];
        const sprite = await drawing(frame.actor, frame.clip, frame.pose, frame.grayscale);
        const { left, top } = spritePlacement(actor.placement, pose.pivot);
        const x = Math.max(0, left), y = Math.max(0, top);
        const width = Math.min(scene.width, left + sprite.width) - x;
        const height = Math.min(scene.height, top + sprite.height) - y;
        if (width <= 0 || height <= 0) continue;
        const input = width === sprite.width && height === sprite.height ? sprite.input
          : await sharp(sprite.input).extract({ left: x - left, top: y - top, width, height }).png().toBuffer();
        layers.push({ input, left: x, top: y });
      }
      return sharp(background.data, { raw: { width: scene.width, height: scene.height, channels: 4 } }).composite(layers).png().toBuffer();
    },
  };
}

export async function exportStreetPreview(input: ExportOptions) {
  const options = parseOptions(input);
  const sceneBytes = await readFile(options.scene);
  const parsed: unknown = JSON.parse(sceneBytes.toString('utf8'));
  const scene = parseStreetScene(parsed);
  if (!Number.isInteger(scene.width) || !Number.isInteger(scene.height) || scene.width % 2 || scene.height % 2) throw new Error('MP4 export requires even integer scene dimensions');
  const wasm = await readFile(options.wasm);
  const sampler = await createStreetSampler(new Uint8Array(wasm), scene);
  try {
    const compositor = await createStreetCompositor(scene, options.assetRoot);
    const output = resolve(options.output), framesDir = join(output, 'frames');
    await mkdir(output);
    await mkdir(framesDir);
    const frameCount = exportFrameCount(scene, options.fps);
    const sampleCount = Math.min(9, frameCount);
    const selected = new Set(Array.from({ length: sampleCount }, (_, i) => Math.floor(i * (frameCount - 1) / Math.max(1, sampleCount - 1))));
    const thumbs: Buffer[] = [];
    const proof: Array<{ index: number; count: number; actors: readonly ActorFrame[] }> = [];
    for (let index = 0; index < frameCount; index++) {
      const count = index * scene.previewCountsPerSecond / options.fps;
      const actors = sampler.sample(count);
      const png = await compositor.render(actors);
      await writeFile(join(framesDir, `${String(index).padStart(6, '0')}.png`), png, { flag: 'wx' });
      if (selected.has(index)) {
        thumbs.push(await sharp(png).resize(384, 216, { fit: 'contain', background: '#10121b', kernel: 'nearest' }).png().toBuffer());
        proof.push({ index, count, actors });
      }
    }
    const columns = Math.min(3, thumbs.length), rows = Math.ceil(thumbs.length / columns);
    await sharp({ create: { width: columns * 384, height: rows * 216, channels: 4, background: '#10121b' } })
      .composite(thumbs.map((input, index) => ({ input, left: index % columns * 384, top: Math.floor(index / columns) * 216 })))
      .png().toFile(join(output, 'contact-sheet.png'));
    const movie = join(output, 'street-preview.mp4');
    const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-n', '-framerate', String(options.fps),
      '-i', join(framesDir, '%06d.png'), '-frames:v', String(frameCount), '-an', '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', movie], { encoding: 'utf8' });
    if (encoded.error) throw encoded.error;
    if (encoded.status !== 0) throw new Error(`FFmpeg export failed: ${encoded.stderr.trim()}`);
    const receipt = {
      version: 1, kind: 'authored-street-preview-export', sceneSha256: sha256(sceneBytes), wasmSha256: sha256(wasm),
      provenance: scene.provenance, frameCount, fps: options.fps, durationSeconds: frameCount / options.fps,
      authoredDurationCounts: scene.durationCounts, previewCountsPerSecond: scene.previewCountsPerSecond,
      endpointIncluded: false, audio: 'none', sceneSize: { width: scene.width, height: scene.height },
      movieSha256: sha256(await readFile(movie)), assets: Object.fromEntries([...compositor.assets].sort(([a], [b]) => a.localeCompare(b))), samples: proof,
    };
    await writeFile(join(output, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
    return { output, movie, receipt };
  } finally { sampler.dispose(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await exportStreetPreview(parseExportArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify({ movie: result.movie, frames: result.receipt.frameCount, fps: result.receipt.fps })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
