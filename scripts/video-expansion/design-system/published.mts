import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Schema } from 'effect';
import sharp from 'sharp';

const Hash = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const NodeId = Schema.String.check(Schema.isPattern(/^\d+:\d+$/));
const Point = Schema.Struct({ x: Schema.Number, y: Schema.Number });
const Layer = Schema.Struct({ path: Schema.String, sha256: Hash, pixelSha256: Hash, nodeId: NodeId });
export const Published = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  toolVersion: Schema.Literal(1),
  status: Schema.Literal('canonical-reexport-verified'),
  motionId: Schema.String,
  characterId: Schema.String,
  artworkId: Schema.String,
  canonical: Schema.Struct({
    store: Schema.Literal('Figma'),
    fileKey: Schema.String,
    componentSetId: NodeId,
    timelineRootId: NodeId,
  }),
  nativeGrid: Schema.Struct({ width: Schema.Int, height: Schema.Int }),
  nativeToFigma: Schema.Array(Schema.Array(Schema.Number)),
  sourceOffset: Point,
  cycleBeats: Schema.Number,
  actionBeats: Schema.NullOr(Schema.Number),
  beatUnit: Schema.Literal('quarter-note'),
  interpolation: Schema.Literal('hold'),
  keyframes: Schema.Array(Schema.Struct({ atBeat: Schema.Number, pose: Schema.Int })),
  drawings: Schema.Array(Schema.Struct({
    index: Schema.Int,
    nodeId: NodeId,
    path: Schema.String,
    sha256: Hash,
    pixelSha256: Hash,
    pivot: Point,
    layers: Schema.Record(Schema.String, Layer),
  })),
  reexport: Schema.Struct({ referenceBpm: Schema.Number, durationSeconds: Schema.Number, timingSamples: Schema.Int }),
  approval: Schema.Struct({
    style: Schema.Literal('pass'),
    temporal: Schema.Literal('pass'),
    export: Schema.Literal('pass'),
    anatomy: Schema.Literals(['pass', 'included-in-temporal-articulation-review']),
    approvedPixelHashes: Schema.Array(Hash),
  }),
});

export const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export async function normalizedPixels(path: string) {
  const { data, info } = await sharp(await readFile(path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let at = 0; at < data.length; at += 4) if (!data[at + 3]) data.fill(0, at, at + 3);
  return { data, width: info.width, height: info.height };
}

export async function verifyPublished(path: string) {
  const input: unknown = JSON.parse(await readFile(path, 'utf8'));
  const publication = Schema.decodeUnknownSync(Published)(input), directory = dirname(path);
  const { referenceBpm, durationSeconds, timingSamples } = publication.reexport;
  if (referenceBpm <= 0 || durationSeconds <= 0 || timingSamples < 2) throw new Error('Invalid canonical review timing');
  if (!publication.drawings.length || publication.approval.approvedPixelHashes.length !== publication.drawings.length || publication.nativeGrid.width <= 0 || publication.nativeGrid.height <= 0 || publication.cycleBeats <= 0 || publication.actionBeats !== null && (publication.actionBeats <= 0 || publication.actionBeats > publication.cycleBeats)) throw new Error('Invalid published canvas or duration');
  if (new Set(publication.drawings.map(drawing => drawing.nodeId)).size !== publication.drawings.length) throw new Error('Duplicate canonical pose identity');
  for (const [index, drawing] of publication.drawings.entries()) {
    if (drawing.index !== index || drawing.pixelSha256 !== publication.approval.approvedPixelHashes[index]) throw new Error('Compact approval does not cover drawing');
    for (const file of [drawing, ...Object.values(drawing.layers)]) {
      if (basename(file.path) !== file.path) throw new Error('Runtime export path escapes package');
      const bytes = await readFile(join(directory, file.path));
      const pixels = await normalizedPixels(join(directory, file.path));
      if (digest(bytes) !== file.sha256 || digest(pixels.data) !== file.pixelSha256 || pixels.width !== publication.nativeGrid.width || pixels.height !== publication.nativeGrid.height) throw new Error('Published runtime pixels changed');
      for (let at = 3; at < pixels.data.length; at += 4) if (pixels.data[at] !== 0 && pixels.data[at] !== 255) throw new Error('Published pixel art has partial alpha');
    }
    if (Object.keys(drawing.layers).length) {
      if (Object.keys(drawing.layers).length !== 2 || !drawing.layers.body || !drawing.layers.effects) throw new Error('Named body/effect pair is incomplete');
      const body = await normalizedPixels(join(directory, drawing.layers.body.path));
      const effects = await normalizedPixels(join(directory, drawing.layers.effects.path));
      const combined = await normalizedPixels(join(directory, drawing.path));
      for (let at = 0; at < combined.data.length; at += 4) {
        const source = body.data[at + 3] ? body.data : effects.data;
        if (!source.subarray(at, at + 4).equals(combined.data.subarray(at, at + 4))) throw new Error('Canonical body/effect composition changed');
      }
    }
  }
  if (publication.keyframes[0]?.atBeat !== 0 || publication.keyframes.at(-1)?.atBeat !== publication.cycleBeats || publication.keyframes[0].pose !== publication.keyframes.at(-1)?.pose || publication.keyframes.some((key, index) => key.pose < 0 || key.pose >= publication.drawings.length || key.atBeat < 0 || key.atBeat > publication.cycleBeats || index > 0 && key.atBeat <= publication.keyframes[index - 1].atBeat)) throw new Error('Invalid published beat metadata');
  return publication;
}
