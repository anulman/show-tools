import { createHash } from 'node:crypto';
import { Schema } from 'effect';
import sharp from 'sharp';

const nodeId = Schema.String.check(Schema.isPattern(/^\d+:\d+$/));
const Target = Schema.Struct({ fileKey: Schema.NonEmptyString, pageId: nodeId, sourceNodeId: nodeId, imageNodeId: nodeId });
const Snapshot = Schema.Struct({
  ...Target.fields, width: Schema.Int.check(Schema.isGreaterThan(0)), height: Schema.Int.check(Schema.isGreaterThan(0)),
  imageHash: Schema.NonEmptyString, png: Schema.NonEmptyString,
});
const Envelope = Schema.Struct({ isError: Schema.optionalKey(Schema.Boolean),
  content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) })) });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

function inspectionCode(target: typeof Target.Type, contextPageId = target.pageId) {
  return `if(figma.fileKey!==${JSON.stringify(target.fileKey)})throw Error('Image source not ready: wrong or missing file identity');
const imageReadyTarget=${JSON.stringify(target)};
const imageReadyPage=await figma.getNodeByIdAsync(${JSON.stringify(contextPageId)});
if(!imageReadyPage||imageReadyPage.type!=='PAGE')throw Error('Image source not ready: missing page');
await figma.setCurrentPageAsync(imageReadyPage);
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
const imageReadySnapshot={...imageReadyTarget,width:imageReadySource.width,height:imageReadySource.height,imageHash:imageReadyImages[0].imageHash,png:figma.base64Encode(await imageReadySource.exportAsync({format:'PNG',constraint:{type:'SCALE',value:1}}))};`;
}

/** Run read-only through use_figma after upload/fill registration, before replacing any visible actor. */
export function imageSourceSnapshotCode(input: unknown): string {
  return `${inspectionCode(Schema.decodeUnknownSync(Target)(input))}\nreturn imageReadySnapshot;`;
}

/** Produces a live precondition to prepend to the already-authorized replacement script. */
export async function prepareImageReplacementGuard(input: {
  target: unknown; response: unknown; expectedPng: Uint8Array; replacementPageId: unknown;
}) {
  const target = Schema.decodeUnknownSync(Target)(input.target);
  const replacementPageId = Schema.decodeUnknownSync(nodeId)(input.replacementPageId);
  const envelope = Schema.decodeUnknownSync(Envelope)(input.response);
  if (envelope.isError) throw Error('Image source not ready: failed Figma read; retain current actor');
  const texts = envelope.content.filter(c => c.type === 'text' && c.text !== undefined);
  if (texts.length !== 1 || texts[0]?.text === undefined) throw Error('Image source not ready: complete source response required');
  const rawSnapshot: unknown = JSON.parse(texts[0].text);
  const snapshot = Schema.decodeUnknownSync(Snapshot)(rawSnapshot);
  for (const key of ['fileKey', 'pageId', 'sourceNodeId', 'imageNodeId'] satisfies Array<keyof typeof target>) {
    if (snapshot[key] !== target[key]) throw Error(`Image source not ready: ${key} differs`);
  }
  const expected = await sharp(input.expectedPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const actual = await sharp(Buffer.from(snapshot.png, 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (expected.info.width !== snapshot.width || expected.info.height !== snapshot.height ||
      actual.info.width !== snapshot.width || actual.info.height !== snapshot.height || !actual.data.equals(expected.data)) {
    throw Error('Image source not ready: complete registered source RGBA differs; retain current actor');
  }
  let occupiedPixels = 0;
  for (let i = 3; i < expected.data.length; i += 4) if (expected.data[i] > 0) occupiedPixels++;
  if (!occupiedPixels) throw Error('Image source not ready: empty expected artwork cannot authorize replacement');
  const code = `${inspectionCode(target, replacementPageId)}
if(imageReadySnapshot.width!==${snapshot.width}||imageReadySnapshot.height!==${snapshot.height}||imageReadySnapshot.imageHash!==${JSON.stringify(snapshot.imageHash)}||imageReadySnapshot.png!==${JSON.stringify(snapshot.png)})throw Error('Image source not ready: live source changed after verification; retain current actor');
`;
  return { code, receipt: {
    status: 'PASS-source-ready', ...target, replacementPageId, width: snapshot.width, height: snapshot.height, occupiedPixels,
    rgbaSha256: hash(actual.data), sourcePngSha256: hash(Buffer.from(snapshot.png, 'base64')),
    imageHash: snapshot.imageHash, guardCodeSha256: hash(Buffer.from(code)), guardCodeBytes: Buffer.byteLength(code),
    scope: 'Upload/image-fill and source pixel readiness only. Actual placed size, visibility, style and scene export require separate review.',
  } };
}
