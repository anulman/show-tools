import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PassThrough } from 'node:stream';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { createHash } from 'node:crypto';
import { runBrowserPeripheralServer, startBrowserPeripheralServer } from '../browser-server.js';
import { PF } from '../../performance/light-abi.js';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'browser-ipac-'));
  await mkdir(join(root, 'ui/practice'), { recursive: true });
  await writeFile(join(root, 'ui/practice/index.html'), '<h1>Practice</h1>');
  const input = new PassThrough({ objectMode: true });
  const writes: string[] = [];
  const server = await startBrowserPeripheralServer({ staticRoot: root,
    transport: { session: 17, input, write: line => { writes.push(line); }, async close() { input.end(); } } });
  input.write({ type: 'ready', version: 1, session: 17, released: true });
  await setImmediate();
  const token = new URLSearchParams(new URL(server.url).hash.slice(1)).get('peripheral');
  const headers = { origin: server.origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const request = (path: string, data?: unknown, extra: HeadersInit = {}) => fetch(server.origin + '/api/peripheral/' + path,
    { method: 'POST', headers: { ...headers, ...extra }, body: data === undefined ? undefined : JSON.stringify(data) });
  const connect = async () => {
    const abort = new AbortController();
    const response = await fetch(server.origin + '/api/peripheral/events', { method: 'POST', headers, signal: abort.signal });
    assert.equal(response.status, 200);
    assert.ok(response.body);
    const reader = response.body.getReader();
    const first = await reader.read();
    assert.ok(first.value);
    const lease = JSON.parse(new TextDecoder().decode(first.value)).lease;
    assert.equal(typeof lease, 'string');
    return { abort, lease, reader };
  };
  return { ...server, root, input, writes, headers, request, connect,
    async dispose() { await server.close(); await rm(root, { recursive: true, force: true }); } };
}
function image() {
  const values = Array<number>(PF.LIGHT_FIELDS).fill(0);
  values[PF.LIGHT_FORMAT] = 1; values[PF.LIGHT_GENERATION] = 1; values[PF.LIGHT_EPOCH] = 1;
  values[PF.LIGHT_SEQUENCE] = 1; values[PF.LIGHT_RATE] = 48000; values[PF.LIGHT_COUNT] = 1;
  values[PF.LIGHT_SAMPLES] = 1; values[PF.LIGHT_SAMPLES + 1] = .7;
  return values;
}

test('printed practice URL works; API rejects foreign origin, Host rebinding and missing secret', async () => {
  const f = await fixture();
  try {
    const page = await fetch(f.url);
    assert.equal(page.status, 200); assert.match(await page.text(), /Practice/);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await f.request('events', undefined, { origin: 'http://evil.example' })).status, 403);
    assert.equal(await new Promise<number>(resolve => {
      const request = httpRequest(f.origin + '/api/peripheral/events', { method: 'POST', headers: { ...f.headers, host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode ?? 0); }); request.end();
    }), 403);
    assert.equal((await f.request('events', undefined, { authorization: 'Bearer wrong' })).status, 403);
    assert.deepEqual(f.writes, []);
  } finally { await f.dispose(); }
});

test('single client forwards exact native publication and edges; closing fences stale writes and clears LED', async () => {
  const f = await fixture();
  try {
    const first = await f.connect();
    assert.equal((await f.request('events')).status, 409);
    assert.equal((await f.request('light', { lease: first.lease, values: [1, 2] })).status, 400);
    const values = image();
    assert.equal((await f.request('light', { lease: first.lease, values })).status, 204);
    assert.equal(f.writes.length, 2);
    assert.equal(f.writes[1], `light ${f.writes[0].slice(5)} ${values.join(' ')}`);
    f.input.write({ type: 'button', session: 17, sequence: 1, down: true });
    const input = await first.reader.read();
    assert.ok(input.value); assert.equal(JSON.parse(new TextDecoder().decode(input.value)).down, true);
    assert.equal((await f.request('clear', { lease: first.lease })).status, 204);
    assert.equal(f.writes.at(-1), 'clear');
    first.abort.abort();
    const second = await f.connect();
    assert.notEqual(first.lease, second.lease);
    const newBinding = f.writes.at(-1);
    assert.notEqual(newBinding?.split(' ')[1], f.writes[0].split(' ')[1], 'new audio instance has a fresh engine incarnation');
    const count = f.writes.length;
    assert.equal((await f.request('light', { lease: first.lease, values })).status, 409);
    assert.equal(f.writes.length, count);
    second.abort.abort();
  } finally { await f.dispose(); }
});

test('request payload limits and malformed helper stream fail closed', async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    assert.equal((await f.request('light', { lease: client.lease, values: Array(20000).fill(1) })).status, 400);
    f.input.write({ type: 'button', session: 18, sequence: 1, down: true });
    await assert.rejects(f.completed, /Peripheral session changed/);
    assert.equal(f.writes.at(-1), 'clear');
    client.abort.abort();
  } finally { await f.dispose(); }
});

test('stalled client lease clears output without advancing musical phase', { timeout: 6000 }, async () => {
  const f = await fixture();
  try {
    const client = await f.connect();
    await client.reader.read();
    assert.equal(f.writes.at(-1), 'clear');
    assert.equal((await f.request('light', { lease: client.lease, values: image() })).status, 409);
  } finally { await f.dispose(); }
});


async function verifiedBuild(directory: string) {
  await mkdir(join(directory, 'ui/practice'), { recursive: true });
  const path = '/ui/practice/index.html', html = '<main>Practice</main>';
  await writeFile(join(directory, path), html);
  const cacheId = createHash('sha256').update(path).update('\0').update(html).update('\0').digest('hex');
  await writeFile(join(directory, 'ui/practice/offline-manifest.json'), JSON.stringify({ cacheId, files: [path] }));
  await writeFile(join(directory, 'ui/practice/sw.js'), '// ' + cacheId);
  await writeFile(join(directory, 'build-info.json'), JSON.stringify({ version: 1, source: { revision: 'a'.repeat(40), tree: 'b'.repeat(40), dirty: false } }));
}

test('malformed helper output ends its owned process and listener', { timeout: 5000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-ipac-process-'));
  const helper = join(directory, 'helper'), log = join(directory, 'exit.log');
  await verifiedBuild(directory);
  await writeFile(helper, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(log)}, String(process.pid));
process.stdout.write(JSON.stringify({ type: 'unsupported' }) + String.fromCharCode(10));
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  if (line === 'quit') { fs.appendFileSync(${JSON.stringify(log)}, ':quit'); process.exit(0); }
});
`, { mode: 0o700 });
  let origin: string | undefined;
  try {
    await assert.rejects(runBrowserPeripheralServer({ staticRoot: directory, helperExecutable: helper, sdkChannel: 0,
      onReady: url => { origin = new URL(url).origin; } }, new AbortController().signal));
    assert.match(await readFile(log, 'utf8'), /:quit$/);
    assert.ok(origin);
    await assert.rejects(fetch(origin));
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('a helper that stops consuming LED writes is terminated before queued images can replay', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'browser-ipac-backpressure-'));
  await verifiedBuild(directory);
  const helper = join(directory, 'helper'), log = join(directory, 'exit.log');
  await writeFile(helper, `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(log)}, 'started');
process.stdin.pause();
setInterval(() => {}, 1000);
process.stdout.write(JSON.stringify({ type: 'ready', version: 1, session: Number(process.argv[2]), released: true }) + String.fromCharCode(10));
process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(log)}, ':terminated'); process.exit(0); });
`, { mode: 0o700 });
  const abort = new AbortController();
  let ready: (url: string) => void = () => {};
  const url = new Promise<string>(resolve => { ready = resolve; });
  const running = runBrowserPeripheralServer({ staticRoot: directory, helperExecutable: helper, sdkChannel: 0, onReady: ready }, abort.signal);
  void running.catch(() => {});
  let stream: Response | undefined;
  try {
    const address = new URL(await url), origin = address.origin;
    const token = new URLSearchParams(address.hash.slice(1)).get('peripheral');
    const headers = { origin, authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    for (let count = 0; count < 100; count++) {
      stream = await fetch(origin + '/api/peripheral/events', { method: 'POST', headers });
      if (stream.status === 200) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(stream?.status, 200); assert.ok(stream?.body);
    const reader = stream.body.getReader(), first = await reader.read();
    assert.ok(first.value);
    const lease = JSON.parse(new TextDecoder().decode(first.value)).lease;
    const values = image(); values[PF.LIGHT_COUNT] = 32;
    for (let row = 0; row < 32; row++) { values[PF.LIGHT_SAMPLES + row * 2] = 4294967295 - row; values[PF.LIGHT_SAMPLES + row * 2 + 1] = .12345678901234567; }
    let overflow = false;
    for (let sequence = 1; sequence <= 1024; sequence++) {
      values[PF.LIGHT_SEQUENCE] = sequence;
      const response = await fetch(origin + '/api/peripheral/light', { method: 'POST', headers, body: JSON.stringify({ lease, values }) });
      if (response.status === 400) { overflow = true; break; }
      assert.equal(response.status, 204);
      if (sequence % 20 === 0) await fetch(origin + '/api/peripheral/heartbeat', { method: 'POST', headers, body: JSON.stringify({ lease }) });
    }
    assert.equal(overflow, true, 'the bounded output queue rejects a stalled helper');
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([running, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Stalled helper remained alive')), 1500); })]); }
    finally { clearTimeout(deadline); }
    assert.equal(await readFile(log, 'utf8'), 'started:terminated');
    await assert.rejects(fetch(origin));
    reader.releaseLock();
  } finally { abort.abort(); await running.catch(() => {}); await rm(directory, { recursive: true, force: true }); }
});
