import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Schema } from 'effect';
import sharp from 'sharp';
import { prepareImageReplacement } from '../video-expansion/figma-image-readiness.js';

function prepareSingle(input: Omit<Parameters<typeof prepareImageReplacement>[0], 'sources' | 'replacementCode'> & {
  target: unknown; expectedPng: Uint8Array;
}) {
  return prepareImageReplacement({ sources: [{ target: input.target, expectedPng: input.expectedPng }],
    replacementPageId: input.replacementPageId, replacementCode: "return 'replacement reached';", readSource: input.readSource });
}

const target = { fileKey: 'test-file', pageId: '1:1', sourceNodeId: '1:2', imageNodeId: '1:3' };
const png = (bytes: Uint8Array, width = 2, height = 1) => sharp(bytes, { raw: { width, height, channels: 4 } }).png().toBuffer();
const pixels = Buffer.from([255, 240, 212, 255, 0, 0, 0, 0]);
const record = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown));
function figmaFixture(image: Buffer, width = 2, height = 1) {
  const page = { id: '1:1', type: 'PAGE' };
  const switches: string[] = [];
  const source = { id: '1:2', type: 'COMPONENT', visible: true, opacity: 1, width, height, parent: page,
    exportAsync: async () => image };
  const imageNode = { id: '1:3', type: 'RECTANGLE', visible: true, opacity: 1, parent: source,
    fills: [{ type: 'IMAGE', visible: true, opacity: 1, imageHash: 'uploaded-image' }] };
  const figma = { fileKey: target.fileKey,
    getNodeByIdAsync: async (id: string) => [page, source, imageNode].find(n => n.id === id),
    setCurrentPageAsync: async (next: { id: string }) => { switches.push(next.id); },
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64') };
  return { figma, source, imageNode, switches };
}
async function execute(code: string, figma: object) {
  const result: unknown = runInNewContext(`(async()=>{${code}})()`, { figma });
  return await Promise.resolve(result);
}
const envelope = (snapshot: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(snapshot) }] });
async function prepared(suppliedImage?: Buffer, width = 2, height = 1) {
  const image = suppliedImage ?? await png(pixels);
  const fixture = figmaFixture(image, width, height), codes: string[] = [], responses: unknown[] = [];
  const ready = await prepareSingle({ target, expectedPng: image, replacementPageId: target.pageId,
    readSource: async code => {
      codes.push(code);
      const response = envelope(await execute(code, fixture.figma));
      responses.push(response);
      assert(Buffer.byteLength(JSON.stringify(response)) < 40_000);
      return response;
    } });
  return { fixture, ready, image, codes, responses };
}

test('verified uploaded pixels permit replacement only after a fresh live source check', async () => {
  const f = await prepared();
  assert.equal(f.ready.receipt.sources[0].occupiedPixels, 1);
  assert.equal(await execute(`${f.ready.code}\nreturn 'replacement reached';`, f.fixture.figma), 'replacement reached');
  f.fixture.imageNode.fills = [];
  await assert.rejects(execute(`${f.ready.code}\nthrow Error('replacement reached');`, f.fixture.figma), /no verified image fill/);
});

test('DNS/upload failure cannot replace an actor with an unfilled or blank source', async () => {
  const image = await png(pixels), fixture = figmaFixture(image);
  fixture.imageNode.fills = [];
  await assert.rejects(prepareSingle({ target, expectedPng: image, replacementPageId: target.pageId,
    readSource: async code => envelope(await execute(code, fixture.figma)) }), /no verified image fill/);
  const blank = figmaFixture(await png(Buffer.alloc(8)));
  await assert.rejects(prepareSingle({ target, expectedPng: image, replacementPageId: target.pageId,
    readSource: async code => envelope(await execute(code, blank.figma)) }), /RGBA differs/);
  await assert.rejects(prepared(await png(Buffer.alloc(8))), /empty expected artwork/);
});

test('source pixels, fill identity and registration cannot change before replacement', async () => {
  for (const change of ['pixels', 'imageHash', 'width', 'visibility', 'outside-source']) {
    const f = await prepared();
    if (change === 'pixels') f.fixture.source.exportAsync = async () => await png(Buffer.from([0, 0, 0, 255, 0, 0, 0, 0]));
    if (change === 'imageHash') f.fixture.imageNode.fills[0].imageHash = 'different-upload';
    if (change === 'width') f.fixture.source.width = 3;
    if (change === 'visibility') f.fixture.imageNode.visible = false;
    if (change === 'outside-source') f.fixture.source.id = '1:4';
    await assert.rejects(execute(`${f.ready.code}\nthrow Error('replacement reached');`, f.fixture.figma), /Image source not ready/);
  }
});

test('wrong file identity fails before any other Figma access in every emitted stage', async () => {
  const f = await prepared();
  for (const code of [...f.codes, f.ready.code]) {
    let accesses = 0;
    const figma = new Proxy({}, { get(_object, key) {
      if (key === 'fileKey') return 'wrong-file';
      accesses++; throw Error('Unexpected access');
    } });
    await assert.rejects(execute(code, figma), /file identity/);
    assert.equal(accesses, 0);
  }
});

test('failed, oversized, malformed or incomplete envelopes cannot produce a guard', async () => {
  for (const response of [undefined, { isError: true, content: [] }, { content: [] }, envelope({}),
    { content: [{ type: 'text', text: '{' }] }, envelope({ padding: 'x'.repeat(40_000) })]) {
    await assert.rejects(prepareSingle({ target, expectedPng: await png(pixels), replacementPageId: target.pageId,
      readSource: async () => response }));
  }
});

test('a shared source is checked from the replacement page with only one page switch', async () => {
  const f = await prepared(), switches: string[] = [];
  const operationPage = { id: '2:1', type: 'PAGE' };
  const figma = { ...f.fixture.figma,
    getNodeByIdAsync: async (id: string) => id === operationPage.id ? operationPage : f.fixture.figma.getNodeByIdAsync(id),
    setCurrentPageAsync: async (page: { id: string }) => { switches.push(page.id); } };
  const ready = await prepareSingle({ target, expectedPng: f.image, replacementPageId: operationPage.id,
    readSource: async code => envelope(await execute(code, figma)) });
  switches.length = 0;
  assert.equal(await execute(`${ready.code}\nreturn 'replacement reached';`, figma), 'replacement reached');
  assert.deepEqual(switches, [operationPage.id]);
});

test('a PNG larger than one MiB is fully verified through bounded code and responses', async () => {
  const image = await png(randomBytes(640 * 512 * 4), 640, 512);
  assert(image.length > 1024 * 1024);
  const f = await prepared(image, 640, 512);
  assert(f.ready.receipt.sources[0].chunkCount > 40);
  assert.equal(f.codes.length, f.ready.receipt.sources[0].chunkCount + 1);
  assert.equal(f.ready.receipt.sources[0].sourcePngSha256, createHash('sha256').update(image).digest('hex'));
  for (const code of [...f.codes, f.ready.code]) assert(Buffer.byteLength(code) < 40_000);
  assert(Buffer.byteLength(f.ready.code + '\n' + ' '.repeat(10_000)) < 50_000);
  assert.equal(await execute(f.ready.code, f.fixture.figma), 'replacement reached');
});

test('missing, reordered, duplicate, mixed and malformed chunks fail closed', async () => {
  const image = await png(randomBytes(256 * 64 * 4), 256, 64);
  for (const mode of ['missing', 'reordered', 'duplicate', 'request', 'identity', 'truncated', 'base64', 'tampered']) {
    const f = figmaFixture(image, 256, 64);
    let calls = 0;
    let firstChunk: unknown;
    await assert.rejects(prepareSingle({ target, expectedPng: image, replacementPageId: target.pageId,
      readSource: async code => {
        const result = record(await execute(code, f.figma));
        const call = calls++;
        if (call === 1) firstChunk = envelope(result);
        if (call !== 2) return envelope(result);
        if (mode === 'missing') return undefined;
        if (mode === 'reordered') return envelope({ ...result, index: 2 });
        if (mode === 'duplicate') return firstChunk;
        if (mode === 'request') return envelope({ ...result, requestId: 'another-acquisition' });
        if (mode === 'identity') return envelope({ ...result, sourceNodeId: '8:8' });
        const data = Schema.decodeUnknownSync(Schema.String)(result.data);
        if (mode === 'truncated') return envelope({ ...result, data: data.slice(0, -4) });
        if (mode === 'base64') return envelope({ ...result, data: '!' + data.slice(1) });
        const bytes = Buffer.from(data, 'base64'); bytes[0] ^= 1;
        return envelope({ ...result, data: bytes.toString('base64') });
      } }), /Image source not ready|Expected/);
  }
});

test('source PNG or metadata drift between chunk reads is rejected before a guard exists', async () => {
  const image = await png(randomBytes(256 * 64 * 4), 256, 64);
  for (const mode of ['png', 'dimensions', 'fill']) {
    const f = figmaFixture(image, 256, 64);
    let calls = 0;
    await assert.rejects(prepareSingle({ target, expectedPng: image, replacementPageId: target.pageId,
      readSource: async code => {
        if (calls++ === 2) {
          if (mode === 'png') { const changed = Buffer.from(image); changed[100] ^= 1; f.source.exportAsync = async () => changed; }
          if (mode === 'dimensions') f.source.width++;
          if (mode === 'fill') f.imageNode.fills[0].imageHash = 'replacement-fill';
        }
        return envelope(await execute(code, f.figma));
      } }), /live source changed/);
  }
});

test('pixel-identical but byte-different PNG export fails the live freshness commitment', async () => {
  const f = await prepared();
  const changed = await sharp(f.image).png({ compressionLevel: 0 }).toBuffer();
  assert(!changed.equals(f.image));
  const actual = await sharp(changed).ensureAlpha().raw().toBuffer();
  assert(actual.equals(pixels));
  f.fixture.source.exportAsync = async () => changed;
  await assert.rejects(execute(f.ready.code + '\nthrow Error("replacement reached");', f.fixture.figma), /live source changed/);
});

test('generated portable SHA256 agrees with Node crypto without Node or Web Crypto globals', async () => {
  const expected = await png(pixels);
  const values = [Buffer.alloc(0), Buffer.from('abc'), Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    ...[55, 56, 63, 64, 65, 1_048_577].map(length => Buffer.alloc(length, 0xab))];
  for (const bytes of values) {
    const f = figmaFixture(bytes);
    let checked = false;
    await assert.rejects(prepareSingle({ target, expectedPng: expected, replacementPageId: target.pageId,
      readSource: async code => {
        const result = record(await execute(code, f.figma));
        assert.equal(result.pngSha256, createHash('sha256').update(bytes).digest('hex'));
        checked = true;
        throw Error('vector checked');
      } }), /vector checked/);
    assert(checked);
  }
});

test('source and expected byte/pixel budgets reject before replacement preparation', async () => {
  const large = Buffer.alloc(16 * 1024 * 1024 + 1);
  await assert.rejects(prepared(large), /expected PNG byte bound/);
  const f = figmaFixture(large);
  await assert.rejects(prepareSingle({ target, expectedPng: await png(pixels), replacementPageId: target.pageId,
    readSource: async code => envelope(await execute(code, f.figma)) }), /source PNG byte bound/);
  f.source.width = 16 * 1024 * 1024 + 1;
  await assert.rejects(prepareSingle({ target, expectedPng: await png(pixels), replacementPageId: target.pageId,
    readSource: async code => envelope(await execute(code, f.figma)) }), /source pixel bounds/);
});

test('two large sources share one bounded guard and page switch before a nine-KiB replacement', async () => {
  const firstImage = await png(randomBytes(640 * 512 * 4), 640, 512);
  const secondImage = await png(randomBytes(640 * 512 * 4), 640, 512);
  assert(firstImage.length > 1024 * 1024 && secondImage.length > 1024 * 1024);
  const first = figmaFixture(firstImage, 640, 512), second = figmaFixture(secondImage, 640, 512);
  second.source.id = '1:4'; second.imageNode.id = '1:5';
  const secondTarget = { ...target, sourceNodeId: second.source.id, imageNodeId: second.imageNode.id };
  const operationPage = { id: '2:1', type: 'PAGE' }, switches: string[] = [];
  const figma = { ...first.figma, replacementRuns: 0,
    getNodeByIdAsync: async (id: string) => id === operationPage.id ? operationPage :
      (await first.figma.getNodeByIdAsync(id)) ?? (await second.figma.getNodeByIdAsync(id)),
    setCurrentPageAsync: async (page: { id: string }) => { switches.push(page.id); } };
  const replacementCode = '/*' + 'x'.repeat(9 * 1024) + '*/\nfigma.replacementRuns++; return "replaced";';
  const ready = await prepareImageReplacement({ sources: [
    { target, expectedPng: firstImage }, { target: secondTarget, expectedPng: secondImage },
  ], replacementPageId: operationPage.id, replacementCode,
  readSource: async code => {
    const result = envelope(await execute(code, figma));
    assert(Buffer.byteLength(code) < 40_000);
    assert(Buffer.byteLength(JSON.stringify(result)) < 40_000);
    return result;
  } });
  assert.equal(ready.receipt.sources.length, 2);
  assert(ready.receipt.completeCodeBytes + ready.receipt.ownedWrapperReserveBytes < 50_000);
  assert.equal(ready.code.split('@version 0.11.1').length - 1, 1, 'portable hash source is shared');
  switches.length = 0;
  assert.equal(await execute(ready.code, figma), 'replaced');
  assert.deepEqual(switches, [operationPage.id]);
  assert.equal(figma.replacementRuns, 1);
  figma.replacementRuns = 0;
  const changed = Buffer.from(secondImage); changed[100] ^= 1;
  second.source.exportAsync = async () => changed;
  await assert.rejects(execute(ready.code, figma), /live source changed/);
  assert.equal(figma.replacementRuns, 0, 'a stale second source blocks all replacement code');
});

test('a bad second source cannot prepare any replacement and source sets are bounded', async () => {
  const image = await png(pixels), first = figmaFixture(image), second = figmaFixture(await png(Buffer.alloc(8)));
  second.source.id = '1:4'; second.imageNode.id = '1:5';
  const secondTarget = { ...target, sourceNodeId: second.source.id, imageNodeId: second.imageNode.id };
  const figma = { ...first.figma, replacementRuns: 0,
    getNodeByIdAsync: async (id: string) => (await first.figma.getNodeByIdAsync(id)) ?? (await second.figma.getNodeByIdAsync(id)) };
  await assert.rejects(prepareImageReplacement({ sources: [{ target, expectedPng: image }, { target: secondTarget, expectedPng: image }],
    replacementPageId: target.pageId, replacementCode: 'figma.replacementRuns++;',
    readSource: async code => envelope(await execute(code, figma)) }), /RGBA differs/);
  assert.equal(figma.replacementRuns, 0);
  let reads = 0;
  for (const sources of [[], Array.from({ length: 9 }, () => ({ target, expectedPng: image })),
    [{ target, expectedPng: image }, { target, expectedPng: image }],
    [{ target, expectedPng: image }, { target: { ...secondTarget, fileKey: 'another-file' }, expectedPng: image }]]) {
    await assert.rejects(prepareImageReplacement({ sources, replacementPageId: target.pageId, replacementCode: 'return true;',
      readSource: async () => { reads++; throw Error('unexpected read'); } }));
  }
  assert.equal(reads, 0);
});

test('the complete guarded script budget includes the caller replacement before a code value is returned', async () => {
  const image = await png(pixels), fixture = figmaFixture(image);
  await assert.rejects(prepareImageReplacement({ sources: [{ target, expectedPng: image }], replacementPageId: target.pageId,
    replacementCode: '/*' + 'x'.repeat(30_000) + '*/', readSource: async code => envelope(await execute(code, fixture.figma)) }), /complete guarded replacement exceeds/);
  let reads = 0;
  await assert.rejects(prepareImageReplacement({ sources: [{ target, expectedPng: image }], replacementPageId: target.pageId,
    replacementCode: 'x'.repeat(50_000), readSource: async () => { reads++; throw Error('unexpected read'); } }), /replacement code exceeds/);
  assert.equal(reads, 0);
});
