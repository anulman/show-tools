import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { Schema } from 'effect';
import sharp from 'sharp';
import { FIGMA_CODE_LIMIT } from './owned-figma.js';

const CHUNK_BYTES = 24_576;
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 16 * 1024 * 1024;
const CODE_BYTES = 40_000;
const RESPONSE_BYTES = 40_000;
const nodeId = Schema.String.check(Schema.isPattern(/^\d{1,24}:\d{1,24}$/));
const Target = Schema.Struct({
  fileKey: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,128}$/)),
  pageId: nodeId, sourceNodeId: nodeId, imageNodeId: nodeId,
});
const Sources = Schema.NonEmptyArray(Schema.Struct({ target: Target, expectedPng: Schema.Uint8Array })).check(Schema.isMaxLength(8));
const positiveInt = Schema.Int.check(Schema.isGreaterThan(0));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Manifest = Schema.Struct({
  ...Target.fields, protocol: Schema.Literal('image-ready-chunks-v1'), requestId: Schema.String,
  width: positiveInt, height: positiveInt, imageHash: Schema.NonEmptyString,
  pngBytes: positiveInt.check(Schema.isLessThanOrEqualTo(MAX_PNG_BYTES)), pngSha256: digest,
});
const Chunk = Schema.Struct({
  ...Manifest.fields, index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)), data: Schema.NonEmptyString,
});
const Envelope = Schema.Struct({ isError: Schema.optionalKey(Schema.Boolean),
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })) });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const portableSha256 = readFileSync(new URL('./vendor/js-sha256/sha256.js', import.meta.url), 'utf8');
if (hash(Buffer.from(portableSha256)) !== '2db6c8e554fbee14672368a0d7551a8ddd841ee96c91526eb7987a0179cfc717') {
  throw Error('Image readiness harness: portable SHA256 source changed; Chief review required');
}
const sha256Code = `const imageReadySha256=(function(module,window,self,process,define){\n${portableSha256}\nreturn module.exports.sha256;})({exports:{}},undefined,undefined,undefined,undefined);`;

function boundedCode(code: string) {
  if (Buffer.byteLength(code) > CODE_BYTES) throw Error('Image readiness harness: generated code exceeds its reserved budget');
  return code;
}
function responseValue(input: unknown): unknown {
  if (Buffer.byteLength(JSON.stringify(input) ?? '') > RESPONSE_BYTES) throw Error('Image readiness harness: response exceeds its reserved budget');
  const envelope = Schema.decodeUnknownSync(Envelope)(input);
  if (envelope.isError) throw Error('Image source not ready: failed Figma read; retain current actor');
  const text = envelope.content[0];
  if (envelope.content.length !== 1 || text?.type !== 'text' || text.text === undefined) {
    throw Error('Image source not ready: complete source response required');
  }
  return JSON.parse(text.text);
}
function inspectionCode(fileKey: string, requestId: string, contextPageId: string) {
  return `if(figma.fileKey!==${JSON.stringify(fileKey)})throw Error('Image source not ready: wrong or missing file identity');
${sha256Code}
const imageReadyPage=await figma.getNodeByIdAsync(${JSON.stringify(contextPageId)});
if(!imageReadyPage||imageReadyPage.type!=='PAGE')throw Error('Image source not ready: missing page');
await figma.setCurrentPageAsync(imageReadyPage);
async function imageReadyInspect(imageReadyTarget){
const imageReadySource=await figma.getNodeByIdAsync(imageReadyTarget.sourceNodeId);
const imageReadyNode=await figma.getNodeByIdAsync(imageReadyTarget.imageNodeId);
if(!imageReadySource||imageReadySource.type!=='COMPONENT'||!imageReadyNode||!('fills'in imageReadyNode))throw Error('Image source not ready: missing source or image node');
let imageReadyParent=imageReadyNode;
while(imageReadyParent&&imageReadyParent.id!==imageReadySource.id){
 if(!imageReadyParent.visible||('opacity'in imageReadyParent&&imageReadyParent.opacity<=0))throw Error('Image source not ready: hidden image ancestry');
 imageReadyParent=imageReadyParent.parent;
}
if(!imageReadyParent||!imageReadySource.visible||imageReadySource.opacity<=0)throw Error('Image source not ready: image is outside visible source');
let imageReadyOwner=imageReadySource.parent;
while(imageReadyOwner&&imageReadyOwner.type!=='PAGE')imageReadyOwner=imageReadyOwner.parent;
if(imageReadyOwner?.id!==imageReadyTarget.pageId)throw Error('Image source not ready: wrong source page');
const imageReadyFills=Array.isArray(imageReadyNode.fills)?imageReadyNode.fills:[];
const imageReadyImages=imageReadyFills.filter(p=>p.type==='IMAGE'&&p.visible!==false&&(p.opacity??1)>0);
if(imageReadyImages.length!==1||!imageReadyImages[0].imageHash)throw Error('Image source not ready: upload has no verified image fill');
if(!Number.isInteger(imageReadySource.width)||!Number.isInteger(imageReadySource.height)||imageReadySource.width<=0||imageReadySource.height<=0||imageReadySource.width*imageReadySource.height>${MAX_PIXELS})throw Error('Image readiness harness: source pixel bounds exceeded');
const imageReadyPng=await imageReadySource.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}});
if(imageReadyPng.length>${MAX_PNG_BYTES})throw Error('Image readiness harness: source PNG byte bound exceeded');
const imageReadySnapshot={...imageReadyTarget,protocol:'image-ready-chunks-v1',requestId:${JSON.stringify(requestId)},width:imageReadySource.width,height:imageReadySource.height,imageHash:imageReadyImages[0].imageHash,pngBytes:imageReadyPng.length,pngSha256:imageReadySha256(imageReadyPng)};
return {snapshot:imageReadySnapshot,png:imageReadyPng};
}
function imageReadyAssert(snapshot,expected){for(const key of Object.keys(expected))if(snapshot[key]!==expected[key])throw Error('Image source not ready: live source changed after verification; retain current actor');}`;
}
function assertManifest(actual: typeof Manifest.Type, expected: typeof Manifest.Type) {
  if (!isDeepStrictEqual(Schema.decodeUnknownSync(Manifest)(actual), expected)) {
    throw Error('Image source not ready: chunk manifest differs');
  }
}

async function collectSource(input: {
  target: typeof Target.Type; expectedPng: Uint8Array; requestId: string;
  readSource: (code: string) => Promise<unknown>;
}) {
  const { target, requestId } = input;
  if (input.expectedPng.length > MAX_PNG_BYTES) throw Error('Image readiness harness: expected PNG byte bound exceeded');
  const expected = await sharp(input.expectedPng, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let occupiedPixels = 0;
  for (let i = 3; i < expected.data.length; i += 4) if (expected.data[i] > 0) occupiedPixels++;
  if (!occupiedPixels) throw Error('Image source not ready: empty expected artwork cannot authorize replacement');
  const runtime = inspectionCode(target.fileKey, requestId, target.pageId);
  const manifestCode = boundedCode(`${runtime}\nreturn (await imageReadyInspect(${JSON.stringify(target)})).snapshot;`);
  const manifest = Schema.decodeUnknownSync(Manifest)(responseValue(await input.readSource(manifestCode)));
  for (const key of ['fileKey', 'pageId', 'sourceNodeId', 'imageNodeId'] satisfies Array<keyof typeof target>) {
    if (manifest[key] !== target[key]) throw Error(`Image source not ready: ${key} differs`);
  }
  if (manifest.requestId !== requestId || manifest.width !== expected.info.width || manifest.height !== expected.info.height) {
    throw Error('Image source not ready: snapshot identity or expected dimensions differ');
  }
  const parts: Buffer[] = [];
  const chunkCount = Math.ceil(manifest.pngBytes / CHUNK_BYTES);
  for (let index = 0; index < chunkCount; index++) {
    const offset = index * CHUNK_BYTES;
    const length = Math.min(CHUNK_BYTES, manifest.pngBytes - offset);
    const code = boundedCode(`${runtime}
const {snapshot,png}=await imageReadyInspect(${JSON.stringify(target)});
imageReadyAssert(snapshot,${JSON.stringify(manifest)});
return {...snapshot,index:${index},offset:${offset},data:figma.base64Encode(png.slice(${offset},${offset + length}))};`);
    const chunk = Schema.decodeUnknownSync(Chunk)(responseValue(await input.readSource(code)));
    assertManifest(chunk, manifest);
    if (chunk.index !== index || chunk.offset !== offset) throw Error('Image source not ready: missing, duplicate or reordered chunk');
    const bytes = Buffer.from(chunk.data, 'base64');
    if (bytes.length !== length || bytes.toString('base64') !== chunk.data) throw Error('Image source not ready: malformed or truncated chunk');
    parts.push(bytes);
  }
  const png = Buffer.concat(parts, manifest.pngBytes);
  if (hash(png) !== manifest.pngSha256) throw Error('Image source not ready: complete PNG commitment differs');
  const actual = await sharp(png, { limitInputPixels: MAX_PIXELS }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (actual.info.width !== manifest.width || actual.info.height !== manifest.height || !actual.data.equals(expected.data)) {
    throw Error('Image source not ready: complete registered source RGBA differs; retain current actor');
  }
  return { manifest, receipt: { ...target, width: manifest.width, height: manifest.height, occupiedPixels,
    rgbaSha256: hash(actual.data), sourcePngSha256: manifest.pngSha256, sourcePngBytes: manifest.pngBytes,
    imageHash: manifest.imageHash, chunkCount } };
}

/** Verify every source, then return the complete bounded script with all live checks before replacement code. */
export async function prepareImageReplacement(input: {
  sources: ReadonlyArray<{ target: unknown; expectedPng: Uint8Array }>;
  replacementPageId: unknown; replacementCode: string;
  readSource: (code: string) => Promise<unknown>;
}) {
  const sources = Schema.decodeUnknownSync(Sources)(input.sources);
  const replacementPageId = Schema.decodeUnknownSync(nodeId)(input.replacementPageId);
  const replacementCode = Schema.decodeUnknownSync(Schema.NonEmptyString)(input.replacementCode);
  const fileKey = sources[0].target.fileKey;
  if (sources.some(source => source.target.fileKey !== fileKey) || new Set(sources.map(source => source.target.sourceNodeId)).size !== sources.length) {
    throw Error('Image source not ready: sources must be unique components in one file');
  }
  const completeBudget = FIGMA_CODE_LIMIT - 1024;
  if (Buffer.byteLength(replacementCode) > completeBudget) throw Error('Image readiness harness: replacement code exceeds the reserved call budget');
  const requestId = randomUUID();
  const verified = [];
  for (const source of sources) verified.push(await collectSource({ ...source, requestId, readSource: input.readSource }));
  const guard = boundedCode(`${inspectionCode(fileKey, requestId, replacementPageId)}
for(const expected of ${JSON.stringify(verified.map(source => source.manifest))}){
 const {snapshot}=await imageReadyInspect(expected);imageReadyAssert(snapshot,expected);
}
`);
  const code = guard + '\n' + replacementCode;
  if (Buffer.byteLength(code) > completeBudget) throw Error('Image readiness harness: complete guarded replacement exceeds the reserved call budget; retain current actor');
  return { code, receipt: {
    status: 'PASS-sources-ready', fileKey, replacementPageId, sources: verified.map(source => source.receipt), requestId,
    guardCodeSha256: hash(Buffer.from(guard)), guardCodeBytes: Buffer.byteLength(guard),
    completeCodeSha256: hash(Buffer.from(code)), completeCodeBytes: Buffer.byteLength(code), ownedWrapperReserveBytes: 1024,
    freshness: 'Full live PNG SHA256 and byte length; assumes SHA256 collision resistance. Local decoded RGBA equality is byte-exact.',
    scope: 'Upload/image-fill and source pixel readiness only. Actual placed size, visibility, style and scene export require separate review.',
  } };
}
