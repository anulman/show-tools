import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test, type TestContext } from 'node:test';
import { Schema } from 'effect';
import sharp from 'sharp';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const verifier = fileURLToPath(new URL('../video-expansion/verify-story-cels.mts', import.meta.url));
const preparer = fileURLToPath(new URL('../video-expansion/prepare-story-cels.mts', import.meta.url));
const fileKey = 'QWreOYAnaje2LlywefJFiK';
const Receipt = Schema.Struct({ fileKey: Schema.String, inputSha256: Schema.String, inputs: Schema.Struct({
  expected: Schema.Struct({ path: Schema.String, sha256: Schema.String }), verifierSha256: Schema.String,
  responses: Schema.NonEmptyArray(Schema.Struct({ path: Schema.String, sha256: Schema.String })),
}) });
async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'story-cel-verification-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rgba = Buffer.from([255, 0, 0, 255]);
  const png = (await sharp(rgba, { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer()).toString('base64');
  const expected = { fileKey, assets: [{ id: 'test-cel', width: 1, height: 1, expectedRgbaSha256: sha(rgba), layers: [{ name: 'Body', rgbaSha256: sha(rgba) }] }], batches: [{ ids: ['test-cel'] }] };
  const result = { fileKey, collectionId: '1:1', createdNodeIds: [], mutatedNodeIds: [], assets: [{ id: 'test-cel', nodeId: '1:2', width: 1, height: 1, png,
    childLayers: [{ name: 'Body', nodeId: '1:3', visible: true }], layers: [{ name: 'Body', nodeId: '1:3', png }] }] };
  const writeExpected = (value: unknown) => writeFile(join(directory, 'expected.json'), JSON.stringify(value));
  const writeResult = (value: unknown = result) => writeFile(join(directory, 'result-0.json'), JSON.stringify({ isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] }));
  await writeExpected(expected); await writeResult();
  const run = () => spawnSync(process.execPath, ['--import', 'tsx', verifier, directory], { encoding: 'utf8' });
  return { directory, expected, result, writeExpected, writeResult, run };
}

test('a nonempty verified receipt binds every exact input', async t => {
  const f = await fixture(t), run = f.run();
  assert.equal(run.status, 0, run.stderr);
  const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(await readFile(join(f.directory, 'canonical-receipt.json'), 'utf8')));
  assert.equal(receipt.fileKey, fileKey);
  assert.equal(receipt.inputs.expected.sha256, sha(await readFile(join(f.directory, 'expected.json'))));
  assert.equal(receipt.inputs.responses[0].sha256, sha(await readFile(join(f.directory, 'result-0.json'))));
  assert.equal(receipt.inputs.verifierSha256, sha(await readFile(verifier)));
  assert.equal(receipt.inputSha256, sha(Buffer.from(JSON.stringify(receipt.inputs))));
});

test('empty coverage cannot produce a successful zero-pixel receipt', async t => {
  const f = await fixture(t);
  await f.writeExpected({ fileKey, assets: [], batches: [] });
  assert.notEqual(f.run().status, 0);
  await assert.rejects(readFile(join(f.directory, 'canonical-receipt.json')));
});

test('an unexpected hidden direct child cannot pass with matching pixels', async t => {
  const f = await fixture(t);
  f.result.assets[0].childLayers.unshift({ name: 'Hidden extra', nodeId: '1:4', visible: false });
  await f.writeResult();
  assert.notEqual(f.run().status, 0);
});

test('a failed rerun preserves the prior receipt and exposes changed input binding', async t => {
  const f = await fixture(t);
  assert.equal(f.run().status, 0);
  const before = await readFile(join(f.directory, 'canonical-receipt.json'));
  const receipt = Schema.decodeUnknownSync(Receipt)(JSON.parse(before.toString('utf8')));
  f.result.assets[0].layers[0].png = (await sharp(Buffer.from([0, 0, 255, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer()).toString('base64');
  await f.writeResult();
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(await readFile(join(f.directory, 'canonical-receipt.json')), before);
  assert.notEqual(receipt.inputs.responses[0].sha256, sha(await readFile(join(f.directory, 'result-0.json'))));
});

test('wrong or missing batch file identity cannot certify matching pixels', async t => {
  const f = await fixture(t);
  await f.writeResult({ ...f.result, fileKey: 'ANOTHER_FIGMA_FILE' });
  assert.notEqual(f.run().status, 0);
  const { fileKey: omitted, ...withoutIdentity } = f.result;
  await f.writeResult(withoutIdentity);
  assert.notEqual(f.run().status, 0);
});

test('generated imports reject wrong or missing file identity before other Figma access', async t => {
  const f = await fixture(t), path = join(f.directory, 'source.png');
  const png = Buffer.from(f.result.assets[0].png, 'base64');
  await writeFile(path, png);
  const image = { path, sha256: sha(png) }, specPath = join(f.directory, 'spec.json'), output = join(f.directory, 'batches');
  await writeFile(specPath, JSON.stringify({ fileKey, pageId: '1:1', collectionName: 'Test cels', batchSize: 1,
    assets: [{ id: 'test-cel', name: 'Test cel', width: 1, height: 1, pivot: { x: 0, y: 0 }, purpose: 'Boundary fixture', combined: image, layers: [{ name: 'Body', image }] }],
  }));
  const prepared = spawnSync(process.execPath, ['--import', 'tsx', preparer, specPath, output], { encoding: 'utf8' });
  assert.equal(prepared.status, 0, prepared.stderr);
  const code = await readFile(join(output, 'batch-0.js'), 'utf8');
  for (const actualKey of ['ANOTHER_FIGMA_FILE', undefined]) {
    let otherAccesses = 0;
    const figma = new Proxy({}, { get(_target, property) {
      if (property === 'fileKey') return actualKey;
      otherAccesses++; throw Error('Unexpected Figma access before target check');
    } });
    const execution: unknown = runInNewContext(`(async()=>{${code}})()`, { figma });
    await assert.rejects(Promise.resolve(execution), /file identity/);
    assert.equal(otherAccesses, 0);
  }
});
