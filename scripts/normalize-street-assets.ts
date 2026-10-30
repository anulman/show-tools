import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { Schema } from 'effect';
import sharp from 'sharp';
import { StreetScene } from '../lib/video/street-score.js';

const finite = Schema.Number.check(Schema.isFinite());
const positive = finite.check(Schema.isGreaterThan(0));
const Point = Schema.Struct({ x: finite, y: finite });
const Ref = Schema.Struct({ path: Schema.NonEmptyString, sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) });
const Catalog = Schema.Struct({ fileKey: Schema.NonEmptyString, codes: Schema.Array(Schema.NonEmptyString), families: Schema.Array(Schema.Struct({
  familyId: Schema.NonEmptyString, code: Schema.NonEmptyString, tier: Schema.Literals(['simple', 'vigorous', 'special', 'ultra']),
  nativeGrid: Schema.Struct({ width: positive, height: positive }), sourceOffset: Point, pivot: Point,
  cycleBeats: positive, actionBeats: Schema.NullOr(positive), beatUnit: Schema.Literal('quarter-note'), interpolation: Schema.Literal('hold'),
  keyframes: Schema.Array(Schema.Struct({ atBeat: finite, pose: Schema.Int })),
  sourceRef: Ref, sourceReview: Ref,
  figma: Schema.Struct({ componentSetId: Schema.NonEmptyString, status: Schema.Literal('recorded'), exportReview: Schema.Struct({ kind: Schema.String, receipt: Schema.optionalKey(Ref) }) }),
  drawings: Schema.Array(Schema.Struct({ index: Schema.Int, native: Ref })),
})) });
const Layout = Schema.Struct({
  schemaVersion: Schema.Literal(1), fileKey: Schema.NonEmptyString,
  sceneNodeId: Schema.NonEmptyString, worldNodeId: Schema.NonEmptyString,
  width: positive, height: positive,
  background: Schema.Struct({ path: Schema.NonEmptyString, width: positive, height: positive, sha256: Ref.fields.sha256 }),
  placements: Schema.Array(Schema.Struct({
    code: Schema.NonEmptyString, x: finite, y: finite, scale: positive, depth: finite,
    baseNativeGrid: Schema.Struct({ width: positive, height: positive }), basePivot: Point, anchor: Point,
    figmaNodeId: Schema.NonEmptyString,
  })),
});
const [assetRootArg, indexRelative, placementsPath, backgroundRelative, output] = process.argv.slice(2);
if (!assetRootArg || !indexRelative || !placementsPath || !backgroundRelative || !output) throw new Error('Usage: normalize-street-assets.ts asset-root catalog-relative-path street-layout.json background-relative-path output.json');
const assetRoot = resolve(assetRootArg);
function assetPath(path: string) {
  const absolute = resolve(assetRoot, path), displacement = relative(assetRoot, absolute);
  if (isAbsolute(path) || displacement === '..' || displacement.startsWith('../') || isAbsolute(displacement)) throw new Error(`Asset path escapes package: ${path}`);
  return absolute;
}
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const catalogText = await readFile(assetPath(indexRelative), 'utf8');
const catalog = Schema.decodeUnknownSync(Catalog)(JSON.parse(catalogText));
const placementsText = await readFile(placementsPath, 'utf8');
const layout = Schema.decodeUnknownSync(Layout)(JSON.parse(placementsText));
const placements = layout.placements;
if (layout.fileKey !== catalog.fileKey) throw new Error('Street layout and motion catalog belong to different Figma files');
for (const placement of placements) {
  if (placement.anchor.x !== placement.x + placement.basePivot.x * placement.scale || placement.anchor.y !== placement.y + placement.basePivot.y * placement.scale) throw new Error(`${placement.code}: Street anchor differs from published base registration`);
}
if (new Set(placements.map(item => item.code)).size !== placements.length) throw new Error('Duplicate Street placement');
if (catalog.codes.length !== placements.length || catalog.codes.some(code => !placements.some(item => item.code === code))) throw new Error('Street placements and motion catalog cast must match exactly');
const verified = new Map<string, string>();
async function verify(ref: typeof Ref.Type) {
  if (verified.get(ref.path) === ref.sha256) return;
  if (sha256(await readFile(assetPath(ref.path))) !== ref.sha256) throw new Error(`Asset hash mismatch: ${ref.path}`);
  verified.set(ref.path, ref.sha256);
}
const actors = [];
for (const placement of placements) {
  const available = catalog.families.filter(family => family.code === placement.code);
  const selected = ['simple', 'vigorous'].flatMap(tier => {
    const family = available.find(family => family.tier === tier);
    if (!family) throw new Error(`${placement.code}: missing ${tier} family`);
    return [family];
  }).concat(available.filter(family => family.tier === 'special' || family.tier === 'ultra'));
  if (!selected.some(family => family.tier === 'special')) throw new Error(`${placement.code}: missing special family`);
  const clips = [];
  for (const family of selected) {
    const review = family.figma.exportReview;
    if (review.kind !== 'source-rgba-pass' || !review.receipt) throw new Error(`${family.familyId}: canonical source RGBA export verification pending`);
    await Promise.all([family.sourceRef, family.sourceReview, review.receipt].map(verify));
    const drawings = [];
    for (const [index, drawing] of family.drawings.entries()) {
      if (drawing.index !== index) throw new Error(`${family.familyId}: noncontiguous drawing indices`);
      await verify(drawing.native);
      const metadata = await sharp(assetPath(drawing.native.path)).metadata();
      if (metadata.width !== family.nativeGrid.width || metadata.height !== family.nativeGrid.height) throw new Error(`${family.familyId}: PNG canvas differs from declared native grid`);
      drawings.push({ path: `/${drawing.native.path}`, pivot: family.pivot });
    }
    clips.push({ id: family.familyId, tier: family.tier, cycleQuarters: family.cycleBeats, actionQuarters: family.actionBeats,
      nativeGrid: family.nativeGrid, sourceOffset: family.sourceOffset, keys: family.keyframes.map(key => ({ atQuarter: key.atBeat, pose: key.pose })), drawings });
  }
  actors.push({ characterId: placement.code, role: 'instrument', placement: { x: placement.anchor.x, y: placement.anchor.y, scale: placement.scale, depth: placement.depth }, clips });
}
const backgroundBytes = await readFile(assetPath(backgroundRelative)), metadata = await sharp(backgroundBytes).metadata();
if (sha256(backgroundBytes) !== layout.background.sha256) throw new Error('Street background differs from the canonical Figma handoff');
if (metadata.width !== layout.width || metadata.height !== layout.height || metadata.width !== layout.background.width || metadata.height !== layout.background.height) throw new Error('Street background dimensions differ from the canonical Figma handoff');
const packageDigest = sha256(JSON.stringify({ catalog: sha256(catalogText), placements: sha256(placementsText), background: sha256(backgroundBytes), files: [...verified] }));
const scene = Schema.decodeUnknownSync(StreetScene)({ version: 1, kind: 'authored-street-preview', width: metadata.width, height: metadata.height,
  background: `/${backgroundRelative}`, previewCountsPerSecond: 2, durationCounts: 32, countedBeatUnit: 4, actors, tracks: [],
  provenance: { source: `Figma ${catalog.fileKey} scene ${layout.sceneNodeId} world ${layout.worldNodeId}; canonical Street anchors/depth; saved voice binding remains separate`, assetsDigest: packageDigest, scoreDigest: 'not-prepared' },
});
await writeFile(output, `${JSON.stringify(scene, null, 2)}\n`);
process.stdout.write(`Normalized ${actors.length} Street actors from verified canonical exports. Asset digest ${packageDigest}\n`);
