import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { Schema } from 'effect';
import sharp from 'sharp';

const Request = Schema.Struct({ kind: Schema.Literal('read'), runId: Schema.String, step: Schema.Int, code: Schema.String, responsePath: Schema.String });
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const delay = () => new Promise(done => setTimeout(done, 10));
async function fixture(twoSources = false) {
  const directory = await mkdtemp(join(tmpdir(), 'image-readiness-driver-test-'));
  const out = join(directory, 'mailbox'), inputPath = join(directory, 'inputs.json');
  const page = { id: '1:1', type: 'PAGE' }, operationPage = { id: '2:1', type: 'PAGE' };
  const nodes = new Map<string, object>([[page.id, page], [operationPage.id, operationPage]]);
  const sources = [];
  for (let index = 0; index < (twoSources ? 2 : 1); index++) {
    const image = await sharp(Buffer.from([255, index, 10, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
    const path = join(directory, `source-${index}.png`);
    await writeFile(path, image);
    const target = { fileKey: 'fixture-file', pageId: page.id, sourceNodeId: `1:${2 + index * 2}`, imageNodeId: `1:${3 + index * 2}` };
    const source = { id: target.sourceNodeId, type: 'COMPONENT', parent: page, visible: true, opacity: 1, width: 1, height: 1, exportAsync: async () => image };
    const node = { id: target.imageNodeId, type: 'RECTANGLE', parent: source, visible: true, opacity: 1, fills: [{ type: 'IMAGE', imageHash: 'fill-' + index }] };
    nodes.set(source.id, source); nodes.set(node.id, node);
    sources.push({ target, expectedPng: { path, sha256: hash(image) } });
  }
  const replacement = 'figma.replacementRuns++;return true;';
  await writeFile(join(directory, 'builder.js'), replacement);
  const config = { sources, replacementPageId: operationPage.id, replacementCode: { path: 'builder.js', sha256: hash(Buffer.from(replacement)) } };
  await writeFile(inputPath, JSON.stringify(config));
  const switches: string[] = [];
  const figma = { fileKey: 'fixture-file', replacementRuns: 0, getNodeByIdAsync: async (id: string) => nodes.get(id),
    setCurrentPageAsync: async (next: { id: string }) => { switches.push(next.id); },
    base64Encode: (bytes: Uint8Array) => Buffer.from(bytes).toString('base64') };
  const execute = async (code: string): Promise<unknown> => await runInNewContext(`(async()=>{${code}})()`, { figma });
  return { directory, out, inputPath, config, figma, switches, execute };
}
async function writeReply(request: typeof Request.Type, response: unknown, overrides: { runId?: string; step?: number; path?: string; mode?: number } = {}) {
  const path = overrides.path ?? request.responsePath;
  const temporary = path + '.tmp';
  await writeFile(temporary, JSON.stringify({ runId: overrides.runId ?? request.runId, step: overrides.step ?? request.step, response }), { mode: 0o600, flag: 'wx' });
  if (overrides.mode !== undefined) await chmod(temporary, overrides.mode);
  await rename(temporary, path);
}
async function run(f: Awaited<ReturnType<typeof fixture>>, service: (request: typeof Request.Type) => Promise<void>, timeout = 1000) {
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('scripts/video-expansion/image-readiness-driver.ts'), '--input', f.inputPath, '--out', f.out, '--timeout-ms', String(timeout)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; }); child.stderr.on('data', value => { stderr += value; });
  const exited = once(child, 'exit');
  const requests: Array<typeof Request.Type> = [];
  let handled = 0;
  try {
    for (let count = 0; count < 1500; count++) {
      let value: unknown;
      try { value = JSON.parse(await readFile(join(f.out, 'next.json'), 'utf8')); }
      catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
      if (Schema.is(Request)(value)) {
        if (value.step !== handled) {
          requests.push(value); handled = value.step;
          await service(value);
        }
      }
      if (child.exitCode !== null) {
        await exited;
        return { code: child.exitCode, stdout, stderr, requests };
      }
      await delay();
    }
    throw Error('Driver test exceeded bounded completion');
  } finally { child.kill('SIGKILL'); if (child.exitCode === null) await exited; }
}

async function failed(f: Awaited<ReturnType<typeof fixture>>, result: Awaited<ReturnType<typeof run>>, expected: RegExp) {
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, expected);
  await assert.rejects(stat(join(f.out, 'replace.js')), { code: 'ENOENT' });
  assert.equal(f.figma.replacementRuns, 0);
}

test('actual driver serializes two sources through private bounded mailboxes without executing replacement', async () => {
  const f = await fixture(true);
  try {
    const result = await run(f, async request => {
      assert(Buffer.byteLength(JSON.stringify(request)) < 46_000);
      await writeReply(request, { content: [{ type: 'text', text: JSON.stringify(await f.execute(request.code)) }] });
    });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(result.requests.map(request => request.step), [1, 2, 3, 4]);
    assert.equal(new Set(result.requests.map(request => request.runId)).size, 1);
    assert.equal((await stat(f.out)).mode & 0o777, 0o700);
    for (const file of ['next.json', 'accepted-1.json', 'replace.js', 'sources-ready.json']) assert.equal((await stat(join(f.out, file))).mode & 0o777, 0o600);
    const done = JSON.parse(result.stdout);
    assert.equal(done.kind, 'done');
    const code = await readFile(done.codePath, 'utf8');
    assert.equal(hash(Buffer.from(code)), done.codeSha256);
    assert.equal(f.figma.replacementRuns, 0, 'driver never invokes replacement');
    f.switches.length = 0;
    assert.equal(await f.execute(code), true);
    assert.equal(f.figma.replacementRuns, 1);
    assert.deepEqual(f.switches, [f.config.replacementPageId]);
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('actual driver times out without a response and cannot publish replacement', async () => {
  const f = await fixture();
  try { await failed(f, await run(f, async () => undefined, 30), /response timed out/); }
  finally { await rm(f.directory, { recursive: true, force: true }); }
});

for (const mode of ['runId', 'step', 'future', 'duplicate', 'malformed', 'oversized', 'public', 'symlink', 'fifo']) {
  test(`actual driver rejects ${mode} response instead of advancing readiness`, async () => {
    const f = await fixture();
    try {
      const result = await run(f, async request => {
        const response = { content: [{ type: 'text', text: JSON.stringify(await f.execute(request.code)) }] };
        if (mode === 'runId') return writeReply(request, response, { runId: 'stale-run' });
        if (mode === 'step') return writeReply(request, response, { step: request.step + 1 });
        if (mode === 'future') return writeReply(request, response, { path: join(f.out, 'response-999.json') });
        if (mode === 'duplicate') return writeReply(request, response, request.step === 1 ? {} : { path: join(f.out, 'response-1.json') });
        if (mode === 'malformed') { await writeFile(request.responsePath, '{', { mode: 0o600 }); return; }
        if (mode === 'oversized') { await writeFile(request.responsePath, 'x'.repeat(42_001), { mode: 0o600 }); return; }
        if (mode === 'public') return writeReply(request, response, { mode: 0o644 });
        if (mode === 'fifo') { execFileSync('mkfifo', [request.responsePath]); return; }
        const path = join(f.directory, 'foreign.json');
        await writeFile(path, JSON.stringify(response), { mode: 0o600 });
        await symlink(path, request.responsePath);
      });
      const error = mode === 'runId' || mode === 'step' ? /reply identity differs/ :
        mode === 'future' || mode === 'duplicate' ? /stale, duplicate or out-of-order/ :
        mode === 'public' || mode === 'oversized' || mode === 'fifo' ? /bounded permitted regular file/ : mode === 'symlink' ? /ELOOP|symbolic link/ : /JSON|property name/;
      await failed(f, result, error);
    } finally { await rm(f.directory, { recursive: true, force: true }); }
  });
}

test('actual driver refuses existing mailboxes and changed pinned inputs', async () => {
  const f = await fixture();
  try {
    await mkdir(f.out, { mode: 0o700 });
    await writeFile(join(f.out, 'keep'), 'preserve');
    await failed(f, await run(f, async () => { throw Error('unexpected read'); }), /EEXIST/);
    assert.equal(await readFile(join(f.out, 'keep'), 'utf8'), 'preserve');
    await rm(f.out, { recursive: true });
    await writeFile(join(f.directory, 'builder.js'), 'return false;');
    await failed(f, await run(f, async () => { throw Error('unexpected read'); }), /input file hash differs/);
    await assert.rejects(stat(f.out), { code: 'ENOENT' });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});

test('actual driver rejects a FIFO input without waiting for a writer or creating a mailbox', async () => {
  const f = await fixture();
  try {
    await rm(f.inputPath);
    execFileSync('mkfifo', [f.inputPath]);
    await failed(f, await run(f, async () => { throw Error('unexpected read'); }), /bounded permitted regular file/);
    await assert.rejects(stat(f.out), { code: 'ENOENT' });
  } finally { await rm(f.directory, { recursive: true, force: true }); }
});
