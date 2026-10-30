import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Schema } from 'effect';
import sharp from 'sharp';

export const POOF_CATALOG_PATH = 'assets/video/motion/poof/catalog.json';
const artifactPrefix = 'assets/video/motion/poof/';
const Text = Schema.NonEmptyString.check(Schema.isPattern(/\S/));
const Hash = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const NodeId = Schema.String.check(Schema.isPattern(/^\d+:\d+$/));
const Native = Schema.Struct({ path: Text, sha256: Hash, rgbaSha256: Hash });
const Review = Schema.Struct({
  styleQuestion: Schema.Literal('Is this the work of a mid-res 8-bit pixel artist?'),
  styleVerdict: Schema.Literal('pass'), styleEvidence: Text,
  temporalQuestion: Schema.Literal('Does this look like intentional movement of the same pixel model, rather than texture crawl or distortion?'),
  temporalVerdict: Schema.Literal('pass'), temporalEvidence: Text,
  reviewer: Text, sourceRgba: Schema.Literal('pass'),
});
export const PoofCatalog = Schema.Struct({
  version: Schema.Literal(1), fileKey: Schema.NonEmptyString,
  status: Schema.Literal('approved-effect-library'), canonical: Schema.Literal('Figma'),
  selectionPolicy: Schema.Literal('interchangeable'), selectedCandidate: Schema.Null,
  operatorApproval: Schema.Struct({
    date: Schema.String.check(Schema.isPattern(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)), quote: Text, scope: Text,
  }),
  candidates: Schema.Array(Schema.Struct({
    id: Schema.Literals(['soft', 'pixel', 'star']), name: Text, status: Schema.Literal('approved'),
    nativeGrid: Schema.Struct({ width: Schema.Literal(128), height: Schema.Literal(128) }),
    anchor: Schema.Struct({ x: Schema.Literal(64), y: Schema.Literal(106) }),
    componentSetId: NodeId, palette: Schema.Array(Schema.String.check(Schema.isPattern(/^#[a-fA-F0-9]{6}$/))),
    keyframes: Schema.Array(Schema.Struct({ atBeat: Schema.Number, pose: Schema.NullOr(Schema.Int) })),
    actionBeats: Schema.Literal(1.5), beatUnit: Schema.Literal('quarter-note'), interpolation: Schema.Literal('hold'),
    characterSwitchAtBeat: Schema.Literal(0.5),
    drawings: Schema.Array(Schema.Struct({
      index: Schema.Int, meaning: Text, native: Native,
      figma: Schema.Struct({ nodeId: NodeId, effectsNodeIds: Schema.Array(NodeId), exportRgbaSha256: Hash }),
    })),
    review: Review,
    preview: Schema.Struct({ review: Schema.Struct({
      reviewer: Text, movieSha256: Hash, frames: Schema.Literal(41),
      styleVerdict: Schema.Literal('pass'), temporalVerdict: Schema.Literal('pass'),
      bodyIntegrityVerdict: Schema.Literal('pass'), clearanceVerdict: Schema.Literal('pass'), evidence: Text,
    }) }),
  })),
});
export type PoofCatalog = typeof PoofCatalog.Type;
export const poofSha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

function same(actual: unknown, expected: unknown, label: string) {
  if (!isDeepStrictEqual(actual, expected)) throw Error(label);
}
function artifactPath(root: string, path: string) {
  if (isAbsolute(path) || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..') || !path.startsWith(artifactPrefix)) throw Error(`Unsafe poof artifact path: ${path}`);
  const absolute = resolve(root, path), displacement = relative(root, absolute);
  if (!displacement || displacement === '..' || displacement.startsWith('../') || isAbsolute(displacement)) throw Error(`Poof artifact escapes root: ${path}`);
  return absolute;
}
async function physicalRoot(input: string) {
  const root = resolve(input), stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) throw Error('Poof root must be a physical directory without symlinks');
  return root;
}
async function artifactBytes(root: string, path: string) {
  const absolute = artifactPath(root, path);
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = join(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) throw Error(`Poof artifact symlink rejected: ${path}`);
  }
  if (!(await lstat(absolute)).isFile() || await realpath(absolute) !== absolute) throw Error(`Poof artifact is not a physical file: ${path}`);
  return readFile(absolute);
}
async function checkedSource(inputRoot: string, expectedCatalogSha256?: string) {
  const root = await physicalRoot(inputRoot), catalogBytes = await artifactBytes(root, POOF_CATALOG_PATH);
  const catalogSha256 = poofSha256(catalogBytes);
  if (expectedCatalogSha256 !== undefined && catalogSha256 !== Schema.decodeUnknownSync(Hash)(expectedCatalogSha256)) throw Error('Pinned poof catalog hash mismatch');
  const parsed: unknown = JSON.parse(catalogBytes.toString('utf8'));
  const catalog = Schema.decodeUnknownSync(PoofCatalog)(parsed);
  same(catalog.candidates.map(candidate => candidate.id).sort(), ['pixel', 'soft', 'star'], 'Poof release requires exactly all three approved candidates');
  const files = new Map([[POOF_CATALOG_PATH, catalogBytes]]), componentIds = new Set<string>();
  const keys = Array.from({ length: 7 }, (_, index) => ({ atBeat: index / 4, pose: index === 6 ? null : index }));
  for (const candidate of catalog.candidates) {
    same(candidate.keyframes, keys, `${candidate.id}: expected six held drawings and explicit clear endpoint`);
    if (candidate.drawings.length !== 6 || !candidate.palette.length) throw Error(`${candidate.id}: six drawings and a palette are required`);
    if (componentIds.has(candidate.componentSetId)) throw Error('Duplicate poof component identity');
    componentIds.add(candidate.componentSetId);
    const palette = new Set(candidate.palette.map(color => color.toLowerCase()));
    for (const [index, drawing] of candidate.drawings.entries()) {
      if (drawing.index !== index || !drawing.native.path.endsWith('.png') || files.has(drawing.native.path)) throw Error(`${candidate.id}: duplicate or noncontiguous drawing path/index`);
      if (componentIds.has(drawing.figma.nodeId) || !drawing.figma.effectsNodeIds.length || new Set(drawing.figma.effectsNodeIds).size !== drawing.figma.effectsNodeIds.length) throw Error(`${candidate.id}: incomplete canonical drawing identity`);
      componentIds.add(drawing.figma.nodeId);
      const bytes = await artifactBytes(root, drawing.native.path);
      if (poofSha256(bytes) !== drawing.native.sha256) throw Error(`${candidate.id}/${index}: PNG file hash mismatch`);
      const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      same([info.width, info.height, info.channels], [128, 128, 4], `${candidate.id}/${index}: native RGBA grid mismatch`);
      const rgbaSha256 = poofSha256(data);
      if (rgbaSha256 !== drawing.native.rgbaSha256 || rgbaSha256 !== drawing.figma.exportRgbaSha256) throw Error(`${candidate.id}/${index}: native/source-export RGBA hash mismatch`);
      let opaque = 0;
      for (let at = 0; at < data.length; at += 4) {
        const alpha = data[at + 3];
        if (alpha !== 0 && alpha !== 255) throw Error(`${candidate.id}/${index}: nonbinary alpha`);
        if (!alpha) continue;
        opaque++;
        const color = `#${data.subarray(at, at + 3).toString('hex')}`;
        if (!palette.has(color)) throw Error(`${candidate.id}/${index}: opaque color outside reviewed palette`);
      }
      if (!opaque || opaque === 128 * 128) throw Error(`${candidate.id}/${index}: drawing needs occupied pixels and transparent margins`);
      if (index === 2) for (let y = 18; y <= 112; y++) for (let x = 24; x <= 104; x++) {
        if (data[(y * 128 + x) * 4 + 3] !== 255) throw Error(`${candidate.id}: peak no longer covers the reviewed character envelope`);
      }
      files.set(drawing.native.path, bytes);
    }
  }
  return { catalog, catalogSha256, root, files };
}

/** Reads only the pinned catalog and its18 PNGs; temporary process evidence is not a dependency. */
export async function readPoofRelease(options: { releaseRoot: string; catalogSha256: string }) {
  const checked = await checkedSource(options.releaseRoot, options.catalogSha256);
  return { catalog: checked.catalog, catalogSha256: checked.catalogSha256, catalogPath: POOF_CATALOG_PATH, releaseRoot: checked.root };
}
async function absent(path: string) {
  try { await lstat(path); } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }
  throw Error(`Refusing existing poof output: ${path}`);
}
async function freezeNested(root: string) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) { await freezeNested(path); await chmod(path, 0o555); }
    else await chmod(path, 0o444);
  }
}
async function discardOwnedStaging(root: string) {
  await chmod(root, 0o755);
  for (const entry of await readdir(root, { withFileTypes: true })) if (entry.isDirectory()) await discardOwnedStaging(join(root, entry.name));
  await rm(root, { recursive: true, force: true });
}

export async function buildPoofRelease(options: { sourceRoot: string; outputRoot: string }) {
  const outputRoot = resolve(options.outputRoot);
  if (!outputRoot.startsWith('/private/tmp/')) throw Error('Poof release outputs must be temporary directories under /private/tmp');
  await absent(outputRoot);
  await physicalRoot(dirname(outputRoot));
  const source = await checkedSource(options.sourceRoot);
  const staging = await mkdtemp(join(dirname(outputRoot), `.${basename(outputRoot)}-staging-`));
  let stagingExists = true;
  let reservation: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    for (const [path, bytes] of source.files) {
      const target = artifactPath(staging, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: 'wx' });
    }
    await readPoofRelease({ releaseRoot: staging, catalogSha256: source.catalogSha256 });
    await freezeNested(staging);
    // Exclusive mkdir refuses files, directories and racing publishers. The final rename
    // replaces only this empty reservation, publishing the complete directory atomically.
    await mkdir(outputRoot);
    reservation = await lstat(outputRoot);
    await rename(staging, outputRoot);
    stagingExists = false;
    try { await chmod(outputRoot, 0o555); }
    catch (error) { await rename(outputRoot, staging); stagingExists = true; throw error; }
    return { releaseRoot: outputRoot, catalogPath: POOF_CATALOG_PATH, catalogSha256: source.catalogSha256, candidates: 3, drawings: 18, files: source.files.size };
  } finally {
    if (reservation && stagingExists) {
      try {
        const current = await lstat(outputRoot);
        if (current.dev === reservation.dev && current.ino === reservation.ino) await rmdir(outputRoot);
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTEMPTY'))) throw error;
      }
    }
    if (stagingExists) await discardOwnedStaging(staging);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [sourceRoot, outputRoot, ...extra] = process.argv.slice(2);
  if (!sourceRoot || !outputRoot || extra.length) throw Error('Usage: poof-release.mts SOURCE_ROOT NEW_TEMP_OUTPUT_ROOT');
  process.stdout.write(JSON.stringify(await buildPoofRelease({ sourceRoot, outputRoot })) + '\n');
}
