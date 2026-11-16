import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as httpServer, type IncomingMessage } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { TLSSocket } from 'node:tls';
import { Schema } from 'effect';
import { decodePeripheralBridgeConfig, decodePeripheralInputMap, runPeripheralBridge } from '../../peripherals/bridge.js';
import { ConnectAddressSchema, connectionOptions } from '../connection-options.js';
import { createSessionClient, DeskUnavailableError, SessionHttpError } from '../session-client.js';
import { decodeSessionProfile } from '../session-profile.js';
import { deskFixture, sessionProfile } from './session-fixture.js';

const address = Schema.decodeUnknownSync(ConnectAddressSchema);
const token = 'explicit-route-test-token-0123456789abcdef';

const inputMap = decodePeripheralInputMap({
  sources: [{ kind: 'linux', id: 'synthetic', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41], relativeAxes: [] }],
  switches: [{ controlId: 'blue', sourceId: 'synthetic', type: 1, code: 41 }], leds: [], confirmWiring: false,
});

test('explicit routes preserve authority, TLS identity and failure boundaries for both clients', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-connect-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cert = join(directory, 'cert.pem');
  const key = join(directory, 'key.pem');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
    '-days', '1', '-subj', '/CN=desk.invalid', '-addext', 'subjectAltName=DNS:desk.invalid,IP:::1'], { stdio: 'ignore' });
  await writeFile(join(directory, 'token'), token, { mode: 0o600 });
  const view = deskFixture().snapshot();
  const requests: Array<{ host: string | undefined; origin: string | undefined; authorization: string | undefined; servername: string | false | null }> = [];
  let status = 200;
  let stall = false;
  const server = httpsServer({ cert: await readFile(cert), key: await readFile(key) }, (request, response) => {
    if (!(request.socket instanceof TLSSocket)) throw new Error('Expected TLS socket');
    requests.push({ host: request.headers.host, origin: request.headers.origin, authorization: request.headers.authorization,
      servername: request.socket.servername });
    if (stall) return;
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url === '/api/session' ? { sessionId: 'test-session', inputOwnerToken: 'fixture-owner-token', view } : view));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Missing test port');
  const origin = `https://desk.invalid:${bound.port}`;
  const profile = (value = origin, connectAddress: unknown = '127.0.0.1') => decodeSessionProfile({ ...sessionProfile(directory), origin: value,
    connectAddress, caFile: cert, tls: { cert, key } });
  const bridge = (value = origin, connectAddress: unknown = '127.0.0.1') => decodePeripheralBridgeConfig({ version: 2, origin: value,
    connectAddress, tokenFile: join(directory, 'token'), caFile: cert, helperExecutable: '/no-helper-must-run',
    inputMap, bindingRevision: 1, jiggle: { minimumTravel: 10, minimumReversal: 2 } });
  await t.test('unresolvable DNS name reaches explicit IP with original Host, Origin, auth and SNI', async () => {
    assert.equal((await (await createSessionClient(profile())).status()).audio.kind, 'off');
    await assert.rejects(runPeripheralBridge(bridge(), new AbortController().signal), /Hardware audio is off/);
    assert.equal(requests.length, 2);
    for (const request of requests) assert.deepEqual(request, { host: `desk.invalid:${bound.port}`, origin,
      authorization: `Bearer ${token}`, servername: 'desk.invalid' });
  });
  await t.test('wrong original TLS hostname and untrusted chain fail before HTTP', async () => {
    const before = requests.length;
    const wrong = `https://wrong.invalid:${bound.port}`;
    await assert.rejects((await createSessionClient(profile(wrong))).status(), error => error instanceof Error && !(error instanceof DeskUnavailableError));
    await assert.rejects(runPeripheralBridge(bridge(wrong), new AbortController().signal), /Hostname\/IP does not match/);
    const noTrust = { ...profile(), caFile: undefined };
    await assert.rejects((await createSessionClient(noTrust)).status(), error => error instanceof Error && !(error instanceof DeskUnavailableError));
    await assert.rejects(runPeripheralBridge({ ...bridge(), caFile: undefined }, new AbortController().signal), /self.signed certificate/);
    assert.equal(requests.length, before);
  });
  await t.test('original IP certificate identity works without IP SNI', async () => {
    const ipOrigin = `https://[::1]:${bound.port}`;
    assert.equal((await (await createSessionClient(profile(ipOrigin))).status()).audio.kind, 'off');
    await assert.rejects(runPeripheralBridge(bridge(ipOrigin), new AbortController().signal), /Hardware audio is off/);
    for (const request of requests.slice(-2)) { assert.equal(request.host, `[::1]:${bound.port}`); assert.equal(request.origin, ipOrigin); assert.ok(!request.servername); }
    const before = requests.length;
    await assert.rejects((await createSessionClient(profile(`https://127.0.0.1:${bound.port}`))).status());
    await assert.rejects(runPeripheralBridge(bridge(`https://127.0.0.1:${bound.port}`), new AbortController().signal), /Hostname\/IP does not match/);
    assert.equal(requests.length, before);
  });
  await t.test('HTTP authentication failure remains an ownership error', async () => {
    status = 401;
    await assert.rejects((await createSessionClient(profile())).status(), error => error instanceof SessionHttpError && error.status === 401);
    await assert.rejects(runPeripheralBridge(bridge(), new AbortController().signal), /failed \(401\)/);
    status = 200;
  });
  await t.test('timeouts remain connection errors rather than absent service', async () => {
    stall = true;
    await assert.rejects((await createSessionClient(profile())).status(), error => error instanceof Error && !(error instanceof DeskUnavailableError));
    await assert.rejects(runPeripheralBridge(bridge(), new AbortController().signal), /timed out/);
    stall = false;
  });
  await t.test('literal validation and HTTP loopback restriction hold at both boundaries', async () => {
    assert.throws(() => profile(origin, 'desk.invalid'));
    assert.throws(() => bridge(origin, 'desk.invalid'));
    for (const ip of ['100.93.139.99', '2001:db8::1']) {
      await assert.rejects(createSessionClient(profile('http://localhost:1234', ip)), /must be loopback/);
      await assert.rejects(runPeripheralBridge(bridge('http://localhost:1234', ip), new AbortController().signal), /must be loopback/);
    }
    await assert.rejects(createSessionClient(profile('http://remote.invalid:1234')), /requires HTTPS/);
    await assert.rejects(runPeripheralBridge(bridge('http://remote.invalid:1234'), new AbortController().signal), /requires HTTPS/);
    assert.deepEqual(connectionOptions(new URL(origin)), {});
    assert.equal(connectionOptions(new URL('http://localhost'), address('127.0.0.1')).hostname, '127.0.0.1');
  });
});

test('HTTP legacy and explicit loopback routes reach both actual clients', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-http-route-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'token'), token, { mode: 0o600 });
  const view = deskFixture().snapshot();
  const requests: IncomingMessage[] = [];
  const server = httpServer((request, response) => { requests.push(request); response.end(JSON.stringify(request.url === '/api/session' ? { sessionId: 'test', inputOwnerToken: 'fixture-owner-token', view } : view)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Missing test port');
  for (const explicit of [false, true]) {
    const origin: string = `http://${explicit ? 'localhost' : '127.0.0.1'}:${bound.port}`;
    const route = explicit ? { connectAddress: '127.0.0.1' } : {};
    const profile = decodeSessionProfile({ ...sessionProfile(directory), origin, ...route });
    assert.equal((await (await createSessionClient(profile)).status()).audio.kind, 'off');
    const bridge = decodePeripheralBridgeConfig({ version: 2, origin, ...route, tokenFile: join(directory, 'token'),
      helperExecutable: '/no-helper-must-run', inputMap, bindingRevision: 1, jiggle: { minimumTravel: 10, minimumReversal: 2 } });
    await assert.rejects(runPeripheralBridge(bridge, new AbortController().signal), /Hardware audio is off/);
    for (const request of requests.slice(-2)) { assert.equal(request.headers.host, new URL(origin).host); assert.equal(request.headers.origin, origin); }
  }
});
