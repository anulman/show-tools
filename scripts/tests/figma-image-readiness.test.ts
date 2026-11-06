import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import sharp from 'sharp';
import { imageSourceSnapshotCode, prepareImageReplacementGuard } from '../video-expansion/figma-image-readiness.js';

const target = { fileKey: 'test-file', pageId: '1:1', sourceNodeId: '1:2', imageNodeId: '1:3' };
const png = (bytes: Uint8Array) => sharp(bytes, { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
const pixels = Buffer.from([255, 240, 212, 255, 0, 0, 0, 0]);
function figmaFixture(image: Buffer) {
  const page = { id: '1:1', type: 'PAGE' };
  const source = { id: '1:2', type: 'COMPONENT', visible: true, opacity: 1, width: 2, height: 1, parent: page,
    exportAsync: async () => image };
  const imageNode = { id: '1:3', type: 'RECTANGLE', visible: true, opacity: 1, parent: source,
    fills: [{ type: 'IMAGE', visible: true, opacity: 1, imageHash: 'uploaded-image' }] };
  const figma = { fileKey: target.fileKey,
    getNodeByIdAsync: async (id: string) => [page, source, imageNode].find(n => n.id === id),
    setCurrentPageAsync: async () => undefined,
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64') };
  return { figma, source, imageNode };
}
async function execute(code: string, figma: object) {
  const result: unknown = runInNewContext(`(async()=>{${code}})()`, { figma });
  return await Promise.resolve(result);
}
const envelope = (snapshot: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(snapshot) }] });
async function prepared() {
  const image = await png(pixels), fixture = figmaFixture(image);
  const response = envelope(await execute(imageSourceSnapshotCode(target), fixture.figma));
  return { fixture, guard: await prepareImageReplacementGuard({ target, response, expectedPng: image, replacementPageId: target.pageId }), image, response };
}

test('verified uploaded pixels permit replacement only after a fresh live source check', async () => {
  const f = await prepared();
  assert.equal(f.guard.receipt.occupiedPixels, 1);
  assert.equal(await execute(`${f.guard.code}\nreturn 'replacement reached';`, f.fixture.figma), 'replacement reached');
  f.fixture.imageNode.fills = [];
  await assert.rejects(execute(`${f.guard.code}\nthrow Error('replacement reached');`, f.fixture.figma), /no verified image fill/);
});

test('DNS/upload failure cannot replace an actor with an unfilled or blank source', async () => {
  const image = await png(pixels), fixture = figmaFixture(image);
  fixture.imageNode.fills = [];
  await assert.rejects(execute(imageSourceSnapshotCode(target), fixture.figma), /no verified image fill/);
  const blank = figmaFixture(await png(Buffer.alloc(8)));
  const response = envelope(await execute(imageSourceSnapshotCode(target), blank.figma));
  await assert.rejects(prepareImageReplacementGuard({ target, response, expectedPng: image, replacementPageId: target.pageId }), /RGBA differs/);
  await assert.rejects(prepareImageReplacementGuard({ target, response, expectedPng: await png(Buffer.alloc(8)), replacementPageId: target.pageId }), /empty expected artwork/);
});

test('source pixels, fill identity and native registration cannot change before replacement', async () => {
  for (const change of ['pixels', 'imageHash', 'width', 'visibility', 'outside-source']) {
    const f = await prepared();
    if (change === 'pixels') f.fixture.source.exportAsync = async () => await png(Buffer.from([0, 0, 0, 255, 0, 0, 0, 0]));
    if (change === 'imageHash') f.fixture.imageNode.fills[0].imageHash = 'different-upload';
    if (change === 'width') f.fixture.source.width = 3;
    if (change === 'visibility') f.fixture.imageNode.visible = false;
    if (change === 'outside-source') f.fixture.source.id = '1:4';
    await assert.rejects(execute(`${f.guard.code}\nthrow Error('replacement reached');`, f.fixture.figma), /Image source not ready/);
  }
});

test('wrong file identity fails before any other Figma access', async () => {
  const f = await prepared();
  for (const code of [imageSourceSnapshotCode(target), f.guard.code]) {
    let accesses = 0;
    const figma = new Proxy({}, { get(_object, key) {
      if (key === 'fileKey') return 'wrong-file';
      accesses++; throw Error('Unexpected access');
    } });
    await assert.rejects(execute(code, figma), /file identity/);
    assert.equal(accesses, 0);
  }
});

test('failed, mismatched or incomplete tool responses cannot produce a replacement guard', async () => {
  const f = await prepared();
  for (const response of [{ isError: true, ...f.response }, { content: [] }, envelope({}), envelope({ ...target, width: 2, height: 1, imageHash: 'x', png: f.image.toString('base64'), sourceNodeId: '9:9' })]) {
    await assert.rejects(prepareImageReplacementGuard({ target, response, expectedPng: f.image, replacementPageId: target.pageId }));
  }
});

test('a shared source is checked from the replacement page with only one page switch', async () => {
  const f = await prepared(), switches: string[] = [];
  const operationPage = { id: '2:1', type: 'PAGE' };
  const figma = { ...f.fixture.figma,
    getNodeByIdAsync: async (id: string) => id === operationPage.id ? operationPage : f.fixture.figma.getNodeByIdAsync(id),
    setCurrentPageAsync: async (page: { id: string }) => { switches.push(page.id); } };
  const guard = await prepareImageReplacementGuard({ target, response: f.response, expectedPng: f.image, replacementPageId: operationPage.id });
  assert.equal(await execute(`${guard.code}\nreturn 'replacement reached';`, figma), 'replacement reached');
  assert.deepEqual(switches, [operationPage.id]);
});
