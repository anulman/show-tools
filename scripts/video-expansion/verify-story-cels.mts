import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Schema } from 'effect';
import sharp from 'sharp';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const dimension = Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(512));
const expectedLayer = Schema.Struct({ name: Schema.NonEmptyString, rgbaSha256: digest });
const expectedAsset = Schema.Struct({ id: Schema.NonEmptyString, width: dimension, height: dimension,
  expectedRgbaSha256: digest, layers: Schema.NonEmptyArray(expectedLayer) });
const Expected = Schema.Struct({ fileKey: Schema.NonEmptyString, assets: Schema.NonEmptyArray(expectedAsset), batches: Schema.NonEmptyArray(Schema.Struct({ ids: Schema.NonEmptyArray(Schema.NonEmptyString) })) });
const Actual = Schema.Struct({ fileKey: Schema.NonEmptyString, collectionId: Schema.String, createdNodeIds: Schema.Array(Schema.String),
  mutatedNodeIds: Schema.Array(Schema.String), assets: Schema.Array(Schema.Struct({
    id: Schema.String, nodeId: Schema.String, width: Schema.Number, height: Schema.Number, png: Schema.String,
    childLayers: Schema.NonEmptyArray(Schema.Struct({ name: Schema.NonEmptyString, nodeId: Schema.NonEmptyString, visible: Schema.Literal(true) })),
    layers: Schema.Array(Schema.Struct({ name: Schema.String, nodeId: Schema.String, png: Schema.String })),
  })) });
const Envelope = Schema.Struct({ content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })), isError: Schema.optionalKey(Schema.Boolean) });
const [directory, ...extra] = process.argv.slice(2);
if (!directory || extra.length) throw Error('Usage: verify-story-cels.mts IMPORT_DIRECTORY');
const expectedBytes = await readFile(`${directory}/expected.json`);
const expected = Schema.decodeUnknownSync(Expected)(JSON.parse(expectedBytes.toString('utf8')));
const assetIds = expected.assets.map(asset => asset.id), batchIds = expected.batches.flatMap(batch => batch.ids);
if (new Set(assetIds).size !== assetIds.length || new Set(batchIds).size !== batchIds.length || assetIds.length !== batchIds.length || batchIds.some(id => !assetIds.includes(id))) throw Error('Expected batches must cover each unique asset exactly once');
for (const asset of expected.assets) if (new Set(asset.layers.map(layer => layer.name)).size !== asset.layers.length) throw Error(`Repeated expected layer: ${asset.id}`);
const responses: { path: string; sha256: string }[] = [];
const inputs = { expected: { path: 'expected.json', sha256: hash(expectedBytes) },
  verifierSha256: hash(await readFile(fileURLToPath(import.meta.url))), responses };
const verified = [];
const seen = new Set<string>();
const componentIds = new Set<string>();
let nativePixels = 0;
for (const [batchIndex, batch] of expected.batches.entries()) {
  const path = `result-${batchIndex}.json`, responseBytes = await readFile(`${directory}/${path}`);
  inputs.responses.push({ path, sha256: hash(responseBytes) });
  const envelope = Schema.decodeUnknownSync(Envelope)(JSON.parse(responseBytes.toString('utf8')));
  if (envelope.isError) throw Error(`Failed import batch ${batchIndex}`);
  const content = envelope.content.find(item => item.type === 'text' && item.text);
  if (!content?.text) throw Error('Missing Figma result');
  const result = Schema.decodeUnknownSync(Actual)(JSON.parse(content.text));
  if (result.fileKey !== expected.fileKey) throw Error('Figma file identity differs from intended target');
  if (result.assets.length !== batch.ids.length || result.assets.some(asset => !batch.ids.includes(asset.id))) throw Error('Batch coverage differs');
  for (const actual of result.assets) {
    const source = expected.assets.find(asset => asset.id === actual.id);
    if (!source || seen.has(actual.id) || componentIds.has(actual.nodeId)) throw Error(`Unexpected or repeated cel/component: ${actual.id}`);
    seen.add(actual.id);
    componentIds.add(actual.nodeId);
    if (actual.width !== source.width || actual.height !== source.height || actual.layers.length !== source.layers.length || actual.childLayers.length !== source.layers.length) throw Error(`Cel structure differs: ${actual.id}`);
    if (actual.childLayers.some((child, index) => child.name !== source.layers[index]?.name || child.nodeId !== actual.layers[index]?.nodeId)) throw Error(`Direct child layer order differs: ${actual.id}`);
    const check = async (png: string, expectedHash: string) => {
      const decoded = await sharp(Buffer.from(png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (decoded.info.width !== source.width || decoded.info.height !== source.height || hash(decoded.data) !== expectedHash) throw Error(`Native RGBA differs: ${actual.id}`);
      nativePixels += source.width * source.height;
    };
    await check(actual.png, source.expectedRgbaSha256);
    for (const [index, layer] of actual.layers.entries()) {
      const reference = source.layers[index];
      if (!reference || layer.name !== reference.name) throw Error(`Layer order differs: ${actual.id}`);
      await check(layer.png, reference.rgbaSha256);
    }
    verified.push({ id: actual.id, nodeId: actual.nodeId, collectionId: result.collectionId,
      width: actual.width, height: actual.height, rgbaSha256: source.expectedRgbaSha256,
      childLayers: actual.childLayers,
      layers: actual.layers.map((layer, index) => ({ name: layer.name, nodeId: layer.nodeId, rgbaSha256: source.layers[index]?.rgbaSha256 })) });
  }
}
if (seen.size !== expected.assets.length) throw Error('Incomplete canonical coverage');
const inputSha256 = hash(Buffer.from(JSON.stringify(inputs)));
const receipt = { status: 'PASS', fileKey: expected.fileKey, inputSha256, inputs, nativePixelsCompared: nativePixels,
  scope: 'Complete native RGBA and named-layer export parity; separate art and composed-timeline review required.', assets: verified };
const bytes = JSON.stringify(receipt, null, 2) + '\n';
const temporaryPath = `${directory}/.canonical-receipt-${process.pid}.tmp`;
await writeFile(temporaryPath, bytes, { flag: 'wx' });
await rename(temporaryPath, `${directory}/canonical-receipt.json`);
process.stdout.write(JSON.stringify({ status: receipt.status, assets: verified.length, nativePixelsCompared: nativePixels, inputSha256, receipt: `${directory}/canonical-receipt.json` }) + '\n');
