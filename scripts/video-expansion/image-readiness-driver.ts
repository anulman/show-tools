import { constants } from 'node:fs';
import { open, mkdir, readdir, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Schema } from 'effect';
import { prepareImageReplacement } from './figma-image-readiness.js';

const File = Schema.Struct({ path: Schema.NonEmptyString,
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)) });
const Input = Schema.Struct({
  sources: Schema.NonEmptyArray(Schema.Struct({ target: Schema.Unknown, expectedPng: File })).check(Schema.isMaxLength(8)),
  replacementPageId: Schema.Unknown, replacementCode: File,
});
const Reply = Schema.Struct({ runId: Schema.String, step: Schema.Int, response: Schema.Unknown });
const Timeout = Schema.Int.check(Schema.isBetween({ minimum: 10, maximum: 300_000 }));
const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

async function readBounded(path: string, maximum: number, privateFile = false) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum || (privateFile && (before.uid !== process.getuid?.() || (before.mode & 0o077) !== 0))) {
      throw Error('Image readiness harness: response/input is not a bounded permitted regular file');
    }
    const data = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < data.length) {
      const read = await handle.read(data, length, data.length - length, length);
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    const after = await handle.stat();
    if (length !== before.size || after.size !== before.size) throw Error('Image readiness harness: file changed while reading');
    return data.subarray(0, length);
  } finally { await handle.close(); }
}

/** Run one collector in a fresh private mailbox; an external lease owner services only the published read requests. */
export async function runImageReadinessDriver(input: { inputPath: string; outDirectory: string; timeoutMs?: number }) {
  if (!isAbsolute(input.inputPath) || !isAbsolute(input.outDirectory) || process.getuid === undefined) {
    throw Error('Image readiness harness: absolute paths and POSIX ownership checks are required');
  }
  const timeoutMs = Schema.decodeUnknownSync(Timeout)(input.timeoutMs ?? 60_000);
  const config = Schema.decodeUnknownSync(Input)(JSON.parse((await readBounded(input.inputPath, 40_000)).toString('utf8')));
  const reference = async (file: typeof File.Type, maximum: number) => {
    const value = await readBounded(resolve(dirname(input.inputPath), file.path), maximum);
    if (hash(value) !== file.sha256) throw Error('Image source not ready: input file hash differs');
    return value;
  };
  const sources = [];
  for (const source of config.sources) sources.push({ target: source.target, expectedPng: await reference(source.expectedPng, 16 * 1024 * 1024) });
  const replacementCode = (await reference(config.replacementCode, 50_000)).toString('utf8');
  await mkdir(input.outDirectory, { mode: 0o700 });
  const directory = await open(input.outDirectory, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await directory.stat();
    if (!info.isDirectory() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) throw Error('Image readiness harness: mailbox is not a private owned directory');
  } finally { await directory.close(); }
  const runId = randomUUID();
  let step = 0;
  const nextPath = join(input.outDirectory, 'next.json');
  const overallDeadline = performance.now() + 15 * 60_000;
  const message = async (value: unknown) => {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 46_000) throw Error('Image readiness harness: mailbox request exceeds its bounded transport budget');
    const temporary = join(input.outDirectory, `next-${runId}.tmp`);
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
    await rename(temporary, nextPath);
  };
  const readSource = async (code: string): Promise<unknown> => {
    const deadline = Math.min(performance.now() + timeoutMs, overallDeadline);
    if (performance.now() >= deadline) throw Error('Image readiness harness: overall preparation timed out');
    step++;
    const responseName = `response-${step}.json`;
    const responsePath = join(input.outDirectory, responseName);
    await message({ kind: 'read', runId, step, code, responsePath });
    while (performance.now() < deadline) {
      const responses = (await readdir(input.outDirectory)).filter(name => /^response-\d+\.json$/.test(name));
      if (responses.some(name => name !== responseName)) throw Error('Image readiness harness: stale, duplicate or out-of-order response');
      if (responses.includes(responseName)) {
        const reply = Schema.decodeUnknownSync(Reply)(JSON.parse((await readBounded(responsePath, 42_000, true)).toString('utf8')));
        if (reply.runId !== runId || reply.step !== step) throw Error('Image readiness harness: reply identity differs');
        await rename(responsePath, join(input.outDirectory, `accepted-${step}.json`));
        return reply.response;
      }
      await new Promise(done => setTimeout(done, 10));
    }
    throw Error('Image readiness harness: response timed out; no replacement performed');
  };
  try {
    const ready = await prepareImageReplacement({ sources, replacementPageId: config.replacementPageId, replacementCode, readSource });
    if (performance.now() >= overallDeadline) throw Error('Image readiness harness: overall preparation timed out');
    const codePath = join(input.outDirectory, 'replace.js'), receiptPath = join(input.outDirectory, 'sources-ready.json');
    await writeFile(codePath, ready.code, { mode: 0o600, flag: 'wx' });
    await writeFile(receiptPath, JSON.stringify(ready.receipt), { mode: 0o600, flag: 'wx' });
    const result = { kind: 'done', runId, step, codePath, receiptPath, codeBytes: ready.receipt.completeCodeBytes,
      codeSha256: ready.receipt.completeCodeSha256 };
    await message(result);
    return result;
  } catch (error) {
    await message({ kind: 'error', runId, step, error: error instanceof Error ? error.message.slice(0, 1000) : 'Unknown readiness failure' });
    throw error;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = parseArgs({ options: { input: { type: 'string' }, out: { type: 'string' }, 'timeout-ms': { type: 'string' } } }).values;
  if (!args.input || !args.out) {
    process.stderr.write('Usage: image-readiness-driver.ts --input INPUT.json --out NEW_DIRECTORY [--timeout-ms MILLISECONDS]\n');
    process.exitCode = 1;
  } else {
    await runImageReadinessDriver({ inputPath: args.input, outDirectory: args.out,
      timeoutMs: args['timeout-ms'] === undefined ? undefined : Number(args['timeout-ms']) }).then(
      result => process.stdout.write(JSON.stringify(result) + '\n'),
      error => { process.stderr.write((error instanceof Error ? error.message : 'Image readiness failed') + '\n'); process.exitCode = 1; },
    );
  }
}
