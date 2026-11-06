import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { get } from 'node:http';
import song from '../../../songs/dance-yrself-clean.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createGateway, type Instrument, type Observation } from '../gateway.js';

const token = '0123456789abcdef0123456789abcdef';
const origin = 'http://127.0.0.1:9999';

test('authenticates commands, retains outcomes, and never stops on detach', async () => {
	let calls = 0;
	let listener: ((value: Observation) => void) | undefined;
	const instrument: Instrument = {
		snapshot: () => ({ type: 'session', song: { id: 'test' }, state: { running: false } }),
		command: async () => { calls++; return { outcome: 'applied' }; },
		subscribe: (callback) => { listener = callback; return () => { listener = undefined; }; },
	};
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
		const body = JSON.stringify({ sessionId: first.sessionId, sequence: 1, command: 'control', args: {} });
		const options = { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body };
		assert.deepEqual(await (await fetch(`${base}/api/command`, options)).json(), { outcome: 'applied' });
		assert.deepEqual(await (await fetch(`${base}/api/command`, options)).json(), { outcome: 'applied' });
		assert.equal(calls, 1);
		assert.equal((await fetch(`${base}/api/command`, { ...options, headers: { ...options.headers, origin: 'http://evil.test' } })).status, 403);
		const abort = new AbortController();
		const stream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': first.sessionId }, signal: abort.signal });
		assert.match(new TextDecoder().decode((await stream.body!.getReader().read()).value), /"type":"session"/);
		listener?.({ type: 'state', state: { running: true } });
		abort.abort();
		assert.equal(calls, 1);
	} finally {
		server.closeAllConnections();
		await new Promise<void>((done) => server.close(() => done()));
	}
});

test('requires TLS off loopback', () => {
	const instrument: Instrument = { snapshot: () => null, command: async () => ({ outcome: 'unknown' }), subscribe: () => () => {} };
	assert.throws(() => createGateway({ host: '0.0.0.0', port: 80, origin, token: Buffer.from(token), staticRoot: '.' }, instrument), /TLS/);
});

test('admits Stop when ordinary commands fill the session', async () => {
	let admitted = 0;
	const release: Array<() => void> = [];
	const instrument: Instrument = {
		snapshot: () => ({ type: 'session' }),
		command: async (input) => {
			admitted++;
			if (typeof input === 'object' && input !== null && 'command' in input && input.command === 'stop') return { outcome: 'applied' };
			await new Promise<void>(resolve => release.push(resolve));
			return { outcome: 'applied' };
		},
		subscribe: () => () => {},
	};
	const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, instrument);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	const address = server.address();
	assert(address && typeof address !== 'string');
	const base = `http://127.0.0.1:${address.port}`;
	const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
	const session = await (await fetch(`${base}/api/session`, { headers })).json() as { sessionId: string };
	const send = (sequence: number, command: string) => fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: session.sessionId, sequence, command, args: {} }) });
	const pending: Promise<Response>[] = [];
	try {
		for (let i = 1; i <= 256; i++) {
			pending.push(send(i, 'control'));
			while (admitted < i) await new Promise(resolve => setTimeout(resolve, 1));
		}
		assert.equal((await send(257, 'control')).status, 503);
		assert.equal((await (await send(258, 'stop')).json()).outcome, 'applied');
	} finally {
		for (const resolve of release) resolve();
		await Promise.all(pending);
		server.closeAllConnections();
		await new Promise<void>(done => server.close(() => done()));
	}
});


test('rejects malformed request targets and serves practice directory indexes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'gateway-static-'));
  await mkdir(join(directory, 'ui/practice'), { recursive: true });
  await writeFile(join(directory, 'index.html'), '<a href="/ui/practice/">Practice</a>');
  await writeFile(join(directory, 'ui/practice/index.html'), '<title>Practice</title>');
  const instrument: Instrument = { snapshot: () => null, command: async () => ({ outcome: 'unknown' }), subscribe: () => () => {} };
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
    const practice = await fetch(`${base}/ui/practice/`);
    assert.equal(practice.status, 200);
    assert.match(await practice.text(), /<title>Practice<\/title>/);
    assert.equal((await fetch(`${base}/api/session`)).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(done => server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});


test('streams a full compiled song and bounds a slow observer', async () => {
  assert.ok(song.compiled);
  const snapshot: Observation = { type: 'session', song: { ...song, source: undefined }, state: { phase: 'idle' } };
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024);
  let publish: ((value: Observation) => void) | undefined;
  const instrument: Instrument = {
    snapshot: () => snapshot,
    command: async () => ({ outcome: 'applied' }),
    subscribe: listener => { publish = listener; return () => {}; },
  };
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
    assert.equal(JSON.parse(text.slice(6)).song.compiled.parts.length, 6);
    const result = await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: session.sessionId, sequence: 1, command: 'stop', args: {} }) });
    assert.equal((await result.json()).outcome, 'applied');
    await reader.cancel();

    const slow = await (await fetch(`${base}/api/session`, { headers })).json();
    const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
      get(`${base}/api/events`, { headers: { ...headers, 'x-session-id': slow.sessionId } }, resolve).on('error', reject);
    });
    response.pause();
    const closed = new Promise<void>(resolve => { response.on('error', () => {}); response.once('close', resolve); });
    const payload = 'x'.repeat(256 * 1024);
    for (let i = 0; i < 100; i++) publish?.({ type: 'state', payload });
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
