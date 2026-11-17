import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compiledCaptureFixture } from '../../performance/tests/fixtures/compiled-capture.js';
import { decodeTakeAudio } from '../../performance/take-audio.js';
import { PersistentDesk } from '../controller.js';
import { createGateway } from '../gateway.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

test('authenticated sample reads copy real native capture and fence stale runs without changing playback', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'take-audio-'));
  const compiled = await compiledCaptureFixture();
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage(compiled).installed);
  const origin = 'http://127.0.0.1', key = '012345678901234567890123456789ab';
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(key), staticRoot: directory }, controller);
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}/api/take-audio`;
    controller.setAudio('on');
    const ready = () => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; };
    const audio = await until(ready);
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    assert.equal((await controller.command(target, { command: 'start', args: { bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false } })).outcome, 'applied');
    assert.equal((await controller.command(target, { command: 'control', args: { control: { id: 'R1' }, commandId: 'record' } })).outcome, 'applied');
    await until(() => ready()?.performance.state.bar === 1 ? true : undefined);
    await controller.command(target, { command: 'control', args: { control: { id: 'R1' } } });
    await until(() => ready()?.performance.state.compiledTakes?.[0]?.ready ? true : undefined, () => JSON.stringify(ready()?.performance.state));
    assert.equal((await controller.command(target, { command: 'stop', args: {} })).outcome, 'applied');
    const stopped = ready(); assert(stopped);
    const request = { target, take: 0, offset: 0, frames: 64, token: stopped.performance.revision };
    const headers = { authorization: `Bearer ${key}`, origin, 'content-type': 'application/json' };
    const post = (body: object, useHeaders = headers) => fetch(url, { method: 'POST', headers: useHeaders, body: JSON.stringify(body) });
    assert.equal((await post(request, { ...headers, authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await post({ ...request, frames: 4097 })).status, 400);
    assert.equal((await post({ ...request, target: { ...target, hostEpoch: 'stale' } })).status, 409);
    const response = await post(request); assert.equal(response.status, 200);
    const chunk = decodeTakeAudio(new Uint8Array(await response.arrayBuffer()));
    assert.equal(chunk.sampleRate, 8000); assert.equal(chunk.frames, 64);
    const pcm = new DataView(chunk.pcm.buffer, chunk.pcm.byteOffset, chunk.pcm.byteLength);
    for (let index = 0; index < 128; ++index) assert.equal(pcm.getFloat32(index * 4, true), .25);
    assert.equal(ready()?.performance.revision, stopped.performance.revision, 'read does not mutate revision or playback');
    assert.equal((await post({ ...request, offset: chunk.totalFrames })).status, 409);
    await controller.command(target, { command: 'setClick', args: { enabled: false } });
    assert.equal((await post(request)).status, 409, 'any intervening command invalidates the export snapshot');
    const current = ready(); assert(current);
    await controller.command(target, { command: 'start', args: { bpm: 120, countInBars: 1, startBar: 1, endBar: 4, loop: false } });
    const running = ready(); assert(running);
    assert.equal((await post({ ...request, token: running.performance.revision })).status, 409, 'running capture cannot be read');
  } finally {
    await controller.close(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
