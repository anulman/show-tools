import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { get, request } from 'node:http';
import song from '../../../songs/dance-yrself-clean.js';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGateway } from '../gateway.js';
import type { DeskPublication } from '../session-schema.js';
import { deskFixture, target } from './session-fixture.js';

const token = '0123456789abcdef0123456789abcdef';
const origin = 'http://127.0.0.1:9999';

test('authenticates commands, retains outcomes, and never stops on detach', async () => {
	let calls = 0;
	let listener: ((value: DeskPublication) => void) | undefined;
	const instrument = deskFixture({
		command: async () => { calls++; return { outcome: 'unknown' }; },
		subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
	});
	const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, instrument);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert(address && typeof address !== 'string');
	const base = `http://127.0.0.1:${address.port}`;
	try {
		assert.equal((await fetch(`${base}/api/session`)).status, 401);
		const headers = { authorization: `Bearer ${token}`, origin };
		const first = await (await fetch(`${base}/api/session`, { headers })).json() as { sessionId: string };
		const second = await (await fetch(`${base}/api/session`, { headers })).json() as { sessionId: string };
		assert.notEqual(first.sessionId, second.sessionId);
		const body = JSON.stringify({ sessionId: first.sessionId, sequence: 1, target, command: 'control', args: {} });
		const options = { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body };
		assert.deepEqual(await (await fetch(`${base}/api/command`, options)).json(), { outcome: 'unknown' });
		assert.deepEqual(await (await fetch(`${base}/api/command`, options)).json(), { outcome: 'unknown' });
		assert.equal(calls, 1);
		assert.equal((await fetch(`${base}/api/command`, { ...options, headers: { ...options.headers, origin: 'http://evil.test' } })).status, 403);
		const abort = new AbortController();
		const stream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': first.sessionId }, signal: abort.signal });
		assert.match(new TextDecoder().decode((await stream.body!.getReader().read()).value), /"type":"desk"/);
		listener?.({ type: 'gap' });
		abort.abort();
		assert.equal(calls, 1);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
	}
});

test('requires TLS off loopback', () => {
	const instrument = deskFixture();
	assert.throws(() => createGateway({ host: '0.0.0.0', port: 80, origin, token: Buffer.from(token), staticRoot: '.' }, instrument), /TLS/);
});

for (const priority of [
	{ command: 'stop', args: {} },
	{ command: 'control', args: { control: { id: 'mushroom' }, commandId: 'panic-1' } },
]) test(`admits ${priority.command} priority when ordinary commands fill the session`, async () => {
	let admitted = 0;
	const release: Array<() => void> = [];
	const instrument = deskFixture({
		command: async (_target, input) => {
			admitted++;
			if (admitted > 256) assert.deepEqual(input, priority);
			await new Promise<void>(resolve => release.push(resolve));
			return { outcome: 'unknown' };
		},
		subscribe: () => () => {},
	});
	const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, instrument);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert(address && typeof address !== 'string');
	const base = `http://127.0.0.1:${address.port}`;
	const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
	const session = await (await fetch(`${base}/api/session`, { headers })).json() as { sessionId: string };
	const send = (sequence: number, command: string, args: object = {}) => fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: session.sessionId, sequence, target, command, args }) });
	const pending: Promise<Response>[] = [];
	try {
		for (let i = 1; i <= 256; i++) {
			pending.push(send(i, 'control'));
			while (admitted < i) await new Promise(resolve => setTimeout(resolve, 1));
		}
		assert.equal((await send(257, 'control')).status, 503);
		assert.equal((await send(258, 'control', { control: { id: 'mushroom' }, commandId: 1 })).status, 503);
		const result = send(259, priority.command, priority.args);
		pending.push(result);
		while (admitted < 257) await new Promise(resolve => setTimeout(resolve, 1));
		assert.equal((await send(260, priority.command, priority.args)).status, 503);
		for (const resolve of release) resolve();
		assert.equal((await (await result).json()).outcome, 'unknown');
	} finally {
		for (const resolve of release) resolve();
		await Promise.all(pending);
		server.closeAllConnections();
		await new Promise<void>(done => server.close(() => done()));
	}
});


test('keeps Hardware Desk assets current and verifies offline Browser build pins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-static-'));
  await mkdir(join(directory, 'ui/practice'), { recursive: true });
  await writeFile(join(directory, 'index.html'), '<a href="/ui/practice/">Practice</a>');
  await writeFile(join(directory, 'ui/practice/index.html'), '<title>Practice</title>');
  await writeFile(join(directory, 'ui/practice/app.js'), 'export const release = 2;');
  await writeFile(join(directory, 'ui/practice/sw.js'), 'offline worker');
  const cacheId = 'a'.repeat(64);
  await writeFile(join(directory, 'ui/practice/offline-manifest.json'), JSON.stringify({ cacheId, files: ['/ui/practice/index.html', '/ui/practice/app.js'] }));
  const instrument = deskFixture();
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: directory }, instrument);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  try {
    const socket = connect(address.port, '127.0.0.1');
    let reply = '';
    socket.setEncoding('utf8');
    socket.on('data', data => { reply += data; });
    await once(socket, 'connect');
    socket.end('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    await once(socket, 'close');
    assert.match(reply, /^HTTP\/1.1 400/);
    const base = `http://127.0.0.1:${address.port}`;
    assert.match(await (await fetch(`${base}/`)).text(), /ui\/practice\//);
    for (const path of ['/ui/practice', '/ui/practice/', '/ui/practice/index.html']) {
      const launch = await fetch(`${base}${path}?remote&browser&song=one`, { redirect: 'manual' });
      assert.equal(launch.status, 302);
      assert.equal(launch.headers.get('location'), '/ui/live/?remote&browser&song=one');
      assert.equal(launch.headers.get('cache-control'), 'no-store');
    }
    const practice = await fetch(`${base}/ui/practice/`);
    assert.equal(practice.status, 200);
    assert.equal(new URL(practice.url).pathname, '/ui/live/');
    assert.match(await practice.text(), /<title>Practice<\/title>/);
    assert.equal(practice.headers.get('cache-control'), 'no-store');

    const browser = await fetch(`${base}/ui/live/?browser`);
    assert.equal(browser.status, 200);
    assert.equal(new URL(browser.url).pathname, '/ui/browser/');
    const script = await fetch(`${base}/ui/live/app.js`);
    assert.equal(await script.text(), 'export const release = 2;');
    assert.equal(script.headers.get('cache-control'), 'no-store');
    for (const path of ['/ui/live/sw.js', '/ui/live/%2fsw.js', '/ui/live/a%2f..%2fsw.js']) {
      assert.equal((await fetch(`${base}${path}`)).status, 404);
    }
    assert.equal((await fetch(`${base}/ui/live/app.js`, { headers: { 'service-worker': 'script' } })).status, 404);
    for (const path of ['/ui/browser/sw.js', '/ui/practice/sw.js']) {
      const worker = await fetch(`${base}${path}`);
      assert.equal(worker.status, 200);
      assert.equal(worker.headers.get('cache-control'), 'no-store');
      assert.equal(await worker.text(), 'offline worker');
    }
    assert.equal(new URL((await fetch(`${base}/ui/practice/?browser`)).url).pathname, '/ui/browser/');
    assert.equal(new URL((await fetch(`${base}/ui/browser/?remote`)).url).pathname, '/ui/live/');

    const pinned = await fetch(`${base}/ui/practice/index.html?__show_tools_build=${cacheId}`, { redirect: 'manual' });
    assert.equal(pinned.status, 200);
    assert.match(await pinned.text(), /<title>Practice<\/title>/);
    assert.equal((await fetch(`${base}/ui/practice/app.js?__show_tools_build=${'b'.repeat(64)}`)).status, 409);
    assert.equal((await fetch(`${base}/ui/practice/app.js?__show_tools_build=`)).status, 400);
    assert.equal((await fetch(`${base}/ui/practice/app.js?__show_tools_build=${cacheId}&__show_tools_build=${cacheId}`)).status, 400);
    assert.equal((await fetch(`${base}/api/session?__show_tools_build=${cacheId}`)).status, 401);
    await rm(join(directory, 'ui/practice/offline-manifest.json'));
    assert.equal((await fetch(`${base}/ui/practice/app.js?__show_tools_build=${cacheId}`)).status, 409);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});


test('serves registered root songs, redirects legacy bookmarks and isolates Browser assets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-preview-'));
  const mount = join(directory, 'preview/tanstack');
  const pin = 'c'.repeat(64);
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: directory }, deskFixture());
  try {
    await mkdir(join(mount, 'desk-assets'), { recursive: true });
    await mkdir(join(mount, 'browser'));
    await Promise.all([
      writeFile(join(mount, '_shell.html'), '<title>Preview</title>'),
      writeFile(join(mount, 'desk-assets/main.js'), 'export const preview = true;'),
      writeFile(join(mount, 'desk-assets/browser._songId-abc.js'), 'export const mode = "browser";'),
      writeFile(join(mount, 'browser/sw.js'), 'offline preview worker'),
      writeFile(join(mount, 'browser/manifest.webmanifest'), '{}'),
      writeFile(join(mount, 'offline-manifest.json'), JSON.stringify({ cacheId: pin })),
      writeFile(join(directory, 'outside.js'), 'outside preview'),
    ]);
    await symlink(join(directory, 'outside.js'), join(mount, 'desk-assets/outside.js'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    for (const route of ['/', '/01-dance-yrself-clean', '/browser', '/browser/03-i-can-change/']) {
      const response = await fetch(base + route + '?remote');
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(await response.text(), '<title>Preview</title>');
    }
    for (const [before, after] of [
      ['/ui/live/?remote', '/?remote'],
      ['/ui/browser/', '/browser/'],
      ['/ui/practice/?browser', '/browser/?browser'],
      ['/preview/tanstack/04-tribulations', '/04-tribulations'],
    ]) {
      const response = await fetch(base + before, { redirect: 'manual' });
      assert.equal(response.status, 302);
      assert.equal(response.headers.get('location'), after);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const head = await fetch(base + '/04-tribulations', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const asset = await fetch(base + '/desk-assets/main.js?__show_tools_build=' + pin);
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
    assert.equal(await asset.text(), 'export const preview = true;');
    assert.equal((await fetch(base + '/desk-assets/browser._songId-abc.js')).status, 200);
    assert.equal((await fetch(base + '/browser/?__show_tools_build=' + 'b'.repeat(64))).status, 409);
    assert.equal((await fetch(base + '/browser/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
    for (const route of ['/02-tribulations', '/desk-assets/missing.js', '/desk-assets/outside.js', '/desk-assets/%2e%2e%2fsw.js', '/_shell.html', '/sw.js', '/preview/tanstack/_shell.html', '/ui/live/sw.js']) {
      assert.equal((await fetch(base + route)).status, 404, route);
    }
    for (const route of ['/', '/01-dance-yrself-clean', '/desk-assets/main.js', '/browser']) {
      assert.equal((await fetch(base + route, { headers: { 'Service-Worker': 'script' } })).status, 404, route);
    }
    const worker = await fetch(base + '/browser/sw.js', { headers: { 'Service-Worker': 'script' } });
    assert.equal(worker.status, 200);
    assert.equal(worker.headers.get('service-worker-allowed'), null, 'default scope stays in /browser/');
    assert.equal(await worker.text(), 'offline preview worker');
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('streams a full compiled song and bounds a slow observer', async () => {
  assert.ok(song.compiled);
  const snapshot = deskFixture().snapshot();
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024);
  let publish: ((value: DeskPublication) => void) | undefined;
  const instrument = deskFixture({
    snapshot: () => snapshot,
    command: async () => ({ outcome: 'unknown' }),
    subscribe: listener => { publish = listener; return () => {}; },
  });
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, instrument);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  try {
    const session = await (await fetch(`${base}/api/session`, { headers })).json();
    const events = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': session.sessionId } });
    assert.equal(events.status, 200);
    const reader = events.body!.getReader();
    let text = '';
    while (!text.includes('\n\n')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'complete bootstrap remains connected');
      text += new TextDecoder().decode(chunk.value);
    }
    assert.equal(JSON.parse(text.slice(6)).view.song.compiled.parts.length, 6);
    const result = await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: session.sessionId, sequence: 1, target, command: 'stop', args: {} }) });
    assert.equal((await result.json()).outcome, 'unknown');
    await reader.cancel();

    const slow = await (await fetch(`${base}/api/session`, { headers })).json();
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      get(`${base}/api/events`, { headers: { ...headers, 'x-session-id': slow.sessionId } }, resolve).on('error', reject);
    });
    response.pause();
    const closed = new Promise<void>(resolve => { response.on('error', () => {}); response.once('close', resolve); });
    const payload = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 100; i++) publish?.({ type: 'desk', view: { ...snapshot, song: { ...snapshot.song, description: payload } } });
    response.resume();
    let timeout: ReturnType<typeof setTimeout>;
    try {
      await Promise.race([closed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('slow observer stayed connected')), 5000); })]);
    } finally { clearTimeout(timeout!); }
    assert.equal(response.aborted, true);
    assert.equal((await fetch(`${base}/api/session`, { headers })).status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
  }
});

test('status allocates no sessions and audio shares deduplication with targeted commands', async () => {
  let goals = 0;
  const controller = deskFixture({ setAudio: () => { goals++; return { outcome: 'accepted', view: controller.snapshot() }; } });
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, controller);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  try {
    for (let count = 0; count < 140; count++) assert.equal((await fetch(`${base}/api/status`, { headers })).status, 200);
    const bootstrap = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(bootstrap.view.audio.kind, 'off');
    const send = (route: string, fields: object) => fetch(`${base}/api/${route}`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, ...fields }) });
    assert.equal((await send('command', { sequence: 1, command: 'stop', args: {} })).status, 400);
    const audio = { sequence: 1, goal: 'on' };
    assert.equal((await (await send('audio', audio)).json()).outcome, 'accepted');
    assert.equal((await (await send('audio', audio)).json()).outcome, 'accepted');
    assert.equal(goals, 1);
    assert.equal((await send('command', { sequence: 1, target, command: 'stop', args: {} })).status, 409);
    assert.equal((await send('audio', { sequence: 1, goal: 'off' })).status, 409);
    assert.equal((await send('audio', { sequence: 2, goal: 'off' })).status, 200);
    assert.equal(goals, 2);
  } finally { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test('audio off bypasses ordinary and reserved command capacity', async () => {
  const release: Array<() => void> = [];
  let admitted = 0;
  const controller = deskFixture({ command: async () => { admitted++; await new Promise<void>(resolve => release.push(resolve)); return { outcome: 'unknown' }; } });
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, controller);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  const bootstrap = await (await fetch(`${base}/api/session`, { headers })).json();
  const pending: Promise<Response>[] = [];
  try {
    for (let sequence = 1; sequence <= 257; sequence++) {
      pending.push(fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence, target, command: sequence === 257 ? 'stop' : 'control', args: {} }) }));
      while (admitted < sequence) await new Promise(resolve => setTimeout(resolve, 1));
    }
    const response = await fetch(`${base}/api/audio`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: 258, goal: 'off' }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).outcome, 'accepted');
  } finally { for (const resolve of release) resolve(); await Promise.all(pending); server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())); }
});

test('idle observers receive the documented SSE heartbeat without a controller publication', { timeout: 4000 }, async () => {
	let commands = 0;
	const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, deskFixture({ command: async () => { commands++; return { outcome: 'unknown' }; } }));
	const abort = new AbortController();
	try {
		server.listen(0, '127.0.0.1'); await once(server, 'listening');
		const address = server.address(); assert.ok(address && typeof address !== 'string');
		const base = `http://127.0.0.1:${address.port}`, headers = { authorization: `Bearer ${token}`, origin };
		const session = await (await fetch(`${base}/api/session`, { headers })).json() as { sessionId: string };
		const stream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': session.sessionId }, signal: abort.signal });
		let text = '';
		for await (const bytes of stream.body!) { text += new TextDecoder().decode(bytes); if (text.includes(': show-tools-heartbeat\n\n')) break; }
		assert.match(text, /: show-tools-heartbeat\n\n/);
		assert.equal(commands, 0);
	} finally { abort.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('input intent readback requires hardware authorization, exact origin and bounded POST metadata', async () => {
  let calls = 0;
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, deskFixture({ command: async () => { calls++; return { outcome: 'unknown' }; } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/input-intent-status`;
  const body = JSON.stringify({ inputOwnerToken: 'original-owner', intentId: 'original-intent' });
  try {
    assert.equal((await fetch(url, { method: 'POST', body })).status, 401);
    assert.equal((await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body })).status, 403);
    const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ inputOwnerToken: 'original-owner', intentId: 'x'.repeat(257) }) })).status, 400);
    assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify({ inputOwnerToken: 'original-owner', intentId: 'original-intent', kind: 'keyboard' }) })).status, 400);
    const response = await fetch(url, { method: 'POST', headers, body });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { kind: 'unknown' });
    assert.equal(calls, 0, 'status readback has no native command authority');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('more than 128 sequential empty browser reconnects reclaim only closed namespaces', async () => {
  let commands = 0;
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, deskFixture({ command: async () => { commands++; return { outcome: 'unknown' }; } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`, headers = { authorization: `Bearer ${token}`, origin };
  try {
    for (let index = 0; index < 140; index++) {
      const response = await fetch(`${base}/api/session`, { headers });
      assert.equal(response.status, 200, `empty reconnect ${index + 1}`);
      const session = await response.json();
      const abort = new AbortController();
      const events = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': session.sessionId }, signal: abort.signal });
      const reader = events.body!.getReader(); await reader.read(); abort.abort();
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    assert.equal(commands, 0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('an input body finishing after its empty SSE owner closed cannot dispatch or recreate that namespace', async () => {
  let commands = 0;
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, deskFixture({ command: async () => { commands++; return { outcome: 'unknown' }; } }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`, headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  const abort = new AbortController();
  let finish!: () => void;
  try {
    const session = await (await fetch(`${base}/api/session`, { headers })).json();
    const ownerRequest = once(server, 'request');
    const events = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': session.sessionId }, signal: abort.signal });
    const [owner] = await ownerRequest;
    const ownerClosed = once(owner, 'close');
    await events.body!.getReader().read();
    const body = JSON.stringify({ sessionId: session.sessionId, sequence: 1, target, command: 'inputAttach', args: {
      intentId: 'late-intent', kind: 'pointer', bindingGeneration: 1, releasedMask: 223, heldMask: 0,
    } });
    const arrived = once(server, 'request');
    const pending = new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      const command = request(`${base}/api/command`, { method: 'POST', headers }, resolve);
      command.once('error', reject); command.write(body.slice(0, -1));
      finish = () => command.end(body.slice(-1));
    });
    await arrived;
    abort.abort(); await ownerClosed;
    finish(); const response = await pending;
    assert.equal(response.statusCode, 409); response.resume();
    assert.equal(commands, 0);
    assert.equal((await fetch(`${base}/api/session`, { headers })).status, 200);
  } finally { abort.abort(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
