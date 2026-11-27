import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { setTimeout } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { NodeWS } from '@effect/platform-node/NodeSocket';
import { Schema } from 'effect';
import { CrtCameraProfileSchema, decodeCrtCameraSnapshot } from '../crt-camera-schema.js';
import { CrtCameras } from '../crt-cameras.js';
import { createGateway } from '../gateway.js';
import { decodeDeskBootstrap } from '../session-schema.js';
import { deskFixture } from './session-fixture.js';

const token = '0123456789abcdef0123456789abcdef';
const origin = 'http://127.0.0.1:9999';
const headers = { authorization: 'Bearer ' + token, origin, 'content-type': 'application/json' };
const password = 'synthetic-camera-password';
const cameraPath = '/api/crt-cameras';
const allowlist = [
  { id: 'wide', label: 'Wide', sourceName: 'Capture A' },
  { id: 'close', label: 'Close', sourceName: 'Capture B' },
  { id: 'side', label: 'Side', sourceName: 'Capture C' },
];
const cameras = allowlist.map(({ id, label }) => ({ id, label }));
const readProfile = Schema.decodeUnknownSync(CrtCameraProfileSchema, { onExcessProperty: 'error' });
const settings = { passwordFile: '/private/secret', sceneCollection: 'Performance', group: 'CRT Cameras', cameras: allowlist };

const decodeRequest = Schema.decodeUnknownSync(Schema.Struct({
  op: Schema.Int,
  d: Schema.Record(Schema.String, Schema.Unknown),
}));
const decodeToggle = Schema.decodeUnknownSync(Schema.Struct({
  sceneName: Schema.String, sceneItemId: Schema.Int, sceneItemEnabled: Schema.Boolean,
}));
type Item = { sceneItemId: number; sceneItemIndex: number; sceneItemEnabled: boolean; sourceName: string; inputKind: string | null };
type Toggle = { item: Item; enabled: boolean; respond(accepted?: boolean): void; socket: NodeWS.WebSocket };

async function fakeObs(t: TestContext, { requirePassword = true, sayHello = true } = {}) {
  const server = new NodeWS.WebSocketServer({ port: 0, host: '127.0.0.1' });
  t.after(async () => {
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  const input = (sceneItemId: number, sceneItemIndex: number, sourceName: string, sceneItemEnabled: boolean): Item =>
    ({ sceneItemId, sceneItemIndex, sourceName, sceneItemEnabled, inputKind: 'av_capture_input' });
  const items = [
    input(7, 0, 'Capture A', true), input(11, 1, 'Capture B', false), input(15, 2, 'Capture C', false),
    { sceneItemId: 19, sceneItemIndex: 3, sourceName: 'Unmanaged graphic', sceneItemEnabled: true, inputKind: 'image_source' },
  ];
  const obs = {
    collection: 'Performance', connections: 0, requests: new Array<string>(), writes: new Array<[number, boolean]>(), items,
    onToggle: ({ item, enabled, respond }: Toggle) => { item.sceneItemEnabled = enabled; respond(); },
    event: (eventType: string) => {
      for (const socket of server.clients) socket.send(JSON.stringify({ op: 5, d: { eventType } }));
    },
  };
  const hash = (value: string) => createHash('sha256').update(value).digest('base64');
  server.on('connection', socket => {
    obs.connections++;
    let identified = false;
    const send = (op: number, d: object) => socket.send(JSON.stringify({ op, d }));
    socket.on('message', raw => {
      const { op, d } = decodeRequest(JSON.parse(raw.toString()));
      if (op === 1) {
        assert.equal(d.rpcVersion, 1);
        assert.equal(d.authentication, hash(hash(password + 'salt') + 'challenge'));
        assert.equal(typeof d.eventSubscriptions, 'number');
        assert.equal(Number(d.eventSubscriptions) & 2, 2);
        identified = true;
        send(2, { negotiatedRpcVersion: 1 });
        return;
      }
      assert(identified);
      assert.equal(op, 6);
      const { requestId, requestType, requestData } = d;
      assert.equal(typeof requestId, 'string');
      assert(typeof requestType === 'string');
      obs.requests.push(requestType);
      const respond = (responseData?: object, accepted = true) =>
        send(7, { requestType, requestId, requestStatus: { result: accepted, code: accepted ? 100 : 600 }, responseData });
      switch (requestType) {
        case 'GetSceneCollectionList':
          respond({ currentSceneCollectionName: obs.collection, sceneCollections: ['Performance', 'Other'] });
          break;
        case 'GetGroupSceneItemList':
          assert.deepEqual(requestData, { sceneName: 'CRT Cameras' });
          respond({ sceneItems: items });
          break;
        case 'SetSceneItemEnabled': {
          const { sceneName, sceneItemId, sceneItemEnabled } = decodeToggle(requestData);
          assert.equal(sceneName, 'CRT Cameras');
          const item = items.find(candidate => candidate.sceneItemId === sceneItemId);
          assert(item);
          obs.writes.push([sceneItemId, sceneItemEnabled]);
          obs.onToggle({ item, enabled: sceneItemEnabled, respond: accepted => respond(undefined, accepted), socket });
          break;
        }
        default: assert.fail('Unscoped OBS request ' + requestType);
      }
    });
    if (sayHello) send(0, { rpcVersion: 1, authentication: requirePassword ? { salt: 'salt', challenge: 'challenge' } : undefined });
  });
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return { obs, url: 'ws://127.0.0.1:' + address.port };
}

async function desk(t: TestContext, crtCameras?: CrtCameras, controller = deskFixture()) {
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.', crtCameras }, controller);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const send = (path: string, options?: RequestInit) => fetch(base + path, { headers, ...options });
  return {
    send,
    read: async () => {
      const response = await send(cameraPath);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      return decodeCrtCameraSnapshot(await response.json());
    },
    select: (cameraId: string) => send(cameraPath, { method: 'POST', body: JSON.stringify({ cameraId }) }),
  };
}

test('only authenticated Desk clients can read or submit a same-origin camera selection', async t => {
  const disabled = await desk(t);
  assert.equal((await disabled.send(cameraPath, { headers: {} })).status, 401);
  assert.deepEqual(await disabled.read(), { kind: 'disabled' });
  assert.equal((await disabled.select('wide')).status, 404);

  const { obs, url } = await fakeObs(t);
  const configured = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password));
  const attempt = (body: object, requestHeaders = headers) => configured.send(cameraPath, {
    method: 'POST', headers: requestHeaders, body: JSON.stringify(body),
  });
  assert.equal((await attempt({ cameraId: 'close' }, { ...headers, authorization: '' })).status, 401);
  assert.equal((await attempt({ cameraId: 'close' }, { ...headers, origin: '' })).status, 403);
  assert.equal((await attempt({ cameraId: 'close' }, { ...headers, origin: 'https://different.example' })).status, 403);
  assert.equal((await attempt({ cameraId: 'close', sceneName: 'Another group' })).status, 400);
  assert.equal((await configured.select('unknown')).status, 400);
  assert.equal(obs.connections, 0);
});

test('cuts only direct allowlisted group inputs and publishes OBS readback', async t => {
  const { obs, url } = await fakeObs(t);
  const api = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password));
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'wide' });
  const response = await api.select('close');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: 'ready', cameras, selectedId: 'close' });
  assert.deepEqual(obs.writes, [[11, true]]);
  assert.equal(obs.items[0].sceneItemEnabled, true);
  assert.equal(obs.items[3].sceneItemEnabled, true);

  assert.equal((await api.select('close')).status, 200);
  assert.deepEqual(obs.writes, [[11, true]]);
  obs.items[1].sceneItemEnabled = false;
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'wide' });
  obs.items[1].sceneItemEnabled = true;
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'close' });
  obs.items[2].sceneItemEnabled = true;
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'side' });
  const repair = await api.select('side');
  assert.equal(repair.status, 200);
  assert.deepEqual(await repair.json(), { kind: 'ready', cameras, selectedId: 'side' });

  obs.items[0].sceneItemEnabled = false;
  const fallback = await api.select('wide');
  assert.equal(fallback.status, 200);
  assert.deepEqual(await fallback.json(), { kind: 'ready', cameras, selectedId: 'wide' });
  assert.deepEqual(obs.writes, [[11, true], [11, false], [7, true], [15, false]]);
  assert.equal(obs.connections, 1);
});

test('refuses writes for an inactive collection, ambiguous camera, group input, or misplaced fallback', async t => {
  const { obs, url } = await fakeObs(t);
  const api = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password));
  obs.collection = 'Other';
  const response = await api.select('close');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'The configured OBS scene collection is inactive', snapshot: { kind: 'offline', cameras },
  });
  assert.deepEqual(obs.requests, ['GetSceneCollectionList']);

  obs.collection = 'Performance';
  obs.items.push({ ...obs.items[1], sceneItemId: 20, sceneItemIndex: 4 });
  assert.equal((await api.select('close')).status, 503);
  obs.items.pop();
  const originalKind = obs.items[1].inputKind;
  obs.items[1].inputKind = null;
  assert.equal((await api.select('close')).status, 503);
  obs.items[1].inputKind = originalKind;
  obs.items[0].sceneItemIndex = 4;
  assert.equal((await api.select('close')).status, 503);
  assert.deepEqual(obs.writes, []);
  assert.equal(obs.items[0].sceneItemEnabled, true);
});

test('keeps the old feed when OBS rejects or fails to confirm enabling the target', async t => {
  const { obs, url } = await fakeObs(t);
  const api = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password));
  obs.items[2].sceneItemEnabled = true;
  obs.onToggle = ({ respond }) => respond(false);
  assert.equal((await api.select('close')).status, 503);
  obs.onToggle = ({ respond }) => respond();
  assert.equal((await api.select('close')).status, 503);
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'side' });
  assert.deepEqual(obs.writes, [[11, true], [11, true]]);
});

test('serializes overlapping cuts without delaying urgent audio off', async t => {
  const { obs, url } = await fakeObs(t);
  const base = deskFixture();
  const audioGoals: string[] = [];
  const api = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password), deskFixture({
    setAudio: goal => { audioGoals.push(goal); return base.setAudio(goal); },
  }));
  let resume = () => {};
  const held = new Promise<void>(resolve => {
    const apply = obs.onToggle;
    obs.onToggle = toggle => {
      obs.onToggle = apply;
      resume = () => apply(toggle);
      resolve();
    };
  });

  const first = api.select('close');
  await held;
  const second = api.select('side');
  const session = decodeDeskBootstrap(await (await api.send('/api/session')).json());
  const audio = await api.send('/api/audio', {
    method: 'POST', body: JSON.stringify({ sessionId: session.sessionId, sequence: 1, goal: 'off' }),
  });
  assert.equal(audio.status, 200);
  assert.deepEqual(audioGoals, ['off']);
  assert.deepEqual(obs.writes, [[11, true]]);
  resume();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.deepEqual(obs.writes, [[11, true], [15, true], [11, false]]);
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'side' });
});

test('pauses for a collection transition and cancels follow-on writes for the current cut', async t => {
  const { obs, url } = await fakeObs(t);
  const api = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password));
  obs.onToggle = ({ item, enabled, respond }) => {
    item.sceneItemEnabled = enabled;
    obs.event('CurrentSceneCollectionChanging');
    respond();
  };
  assert.equal((await api.select('close')).status, 503);
  assert.deepEqual(obs.writes, [[11, true]]);
  const requestCount = obs.requests.length;
  assert.deepEqual(await api.read(), { kind: 'offline', cameras });
  assert.equal(obs.requests.length, requestCount);
  assert.equal(obs.items[0].sceneItemEnabled, true);

  obs.event('CurrentSceneCollectionChanged');
  const recovered = await api.read();
  if (recovered.kind === 'offline') {
    // HTTP and WebSocket travel independently, so allow OBS's event to arrive first.
    await setTimeout(25);
    assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'close' });
  } else {
    assert.deepEqual(recovered, { kind: 'ready', cameras, selectedId: 'close' });
  }
  assert.deepEqual(obs.writes, [[11, true]]);
});

test('reports an uncertain cut on silence, reconnects for a later read, and never replays the mutation', async t => {
  const { obs, url } = await fakeObs(t);
  const api = await desk(t, new CrtCameras(readProfile({ ...settings, url }), password));
  obs.onToggle = ({ item, enabled }) => { item.sceneItemEnabled = enabled; };
  const response = await api.select('close');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'OBS request timed out', snapshot: { kind: 'offline', cameras } });
  assert.deepEqual(obs.writes, [[11, true]]);
  assert.deepEqual(await api.read(), { kind: 'offline', cameras });
  await setTimeout(1100);
  assert.deepEqual(await api.read(), { kind: 'ready', cameras, selectedId: 'close' });
  assert.deepEqual(obs.writes, [[11, true]]);
  assert.equal(obs.connections, 2);
});

test('refuses OBS without password authentication and bounds a silent handshake', async t => {
  const noAuth = await fakeObs(t, { requirePassword: false });
  const noAuthApi = await desk(t, new CrtCameras(readProfile({ ...settings, url: noAuth.url }), password));
  assert.equal((await noAuthApi.select('close')).status, 503);
  assert.deepEqual(noAuth.obs.requests, []);

  const silent = await fakeObs(t, { sayHello: false });
  const silentApi = await desk(t, new CrtCameras(readProfile({ ...settings, url: silent.url }), password));
  const response = await silentApi.select('close');
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'OBS connection timed out', snapshot: { kind: 'offline', cameras } });
  assert.deepEqual(silent.obs.requests, []);
});

test('validates the private camera profile defensively', () => {
  const url = 'wss://obs.example/endpoint';
  assert.doesNotThrow(() => readProfile({ ...settings, url }));
  assert.throws(() => readProfile({ ...settings, url, password: 'inline secret' }));
  assert.throws(() => readProfile({ ...settings, url: 'https://obs.example' }));
  assert.throws(() => readProfile({ ...settings, url: 'ws://user:secret@obs.example' }));
  assert.throws(() => readProfile({ ...settings, url: 'ws://obs.example?secret=value' }));
  assert.throws(() => readProfile({ ...settings, url, passwordFile: 'relative.txt' }));
  assert.throws(() => readProfile({ ...settings, url, cameras: [allowlist[0], { ...allowlist[1], id: 'wide' }] }));
  assert.throws(() => readProfile({ ...settings, url, cameras: [allowlist[0], { ...allowlist[1], sourceName: 'Capture A' }] }));
});
