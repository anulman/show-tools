import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PersistentDesk } from '../controller.js';
import { createGateway } from '../gateway.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

test('the native desk records the exact song mix and serves the last completed WAV after audio ends', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'demo-recording-'));
  const profile = sessionProfile(directory);
  const controller = new PersistentDesk(profile, installedPackage().installed);
  const origin = 'http://127.0.0.1', key = '012345678901234567890123456789ab';
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(key), staticRoot: directory }, controller);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/`;
    const headers = { authorization: `Bearer ${key}`, origin, 'content-type': 'application/json' };
    const ready = () => {
      const audio = controller.snapshot().audio;
      return audio.kind === 'ready' ? audio : undefined;
    };
    const download = (method = 'GET') => fetch(base + 'demo-recording', { method, headers });
    assert.equal((await fetch(base + 'demo-recording')).status, 401);
    assert.equal((await download()).status, 404);
    controller.setAudio('on');
    const audio = await until(ready);
    assert.equal(audio.performance.demo, 'idle');
    assert.equal(audio.performance.audition, null);
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    const bootstrap = await fetch(base + 'session', { headers }).then(response => response.json());
    let sequence = 0;
    async function command(name: string, args: object) {
      const response = await fetch(base + 'command', { method: 'POST', headers,
        body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: ++sequence, target, command: name, args }) });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.outcome, 'applied', JSON.stringify(result));
    }
    assert.equal(await fetch(base + 'desk-mode').then(response => response.text()), 'hardware');
    await command('audition', { profile: 5 });
    assert.equal(ready()?.performance.audition, 5);
    assert.equal(ready()?.performance.state.phase, 'idle');
    await command('setClick', { enabled: false });
    await command('start', { bpm: 240, countInBars: 1, startBar: 1, endBar: 1, loop: false, recordDemo: true });
    assert.equal(ready()?.performance.demo, 'armed');
    assert.equal(ready()?.performance.audition, null, 'Transport takes back the monitor route');
    assert.equal((await download('HEAD')).status, 404);
    await until(() => ready()?.performance.demo === 'saved' ? true : undefined);
    assert.equal(ready()?.performance.state.phase, 'ended');
    assert.equal((await fetch(base + 'demo-recording', { headers: { ...headers, origin: 'https://elsewhere.invalid' } })).status, 403);
    const response = await download();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/wav');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const wav = Buffer.from(await response.arrayBuffer());
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 2);
    assert.equal(wav.readUInt32LE(24), 8000);
    assert.equal(wav.readUInt32LE(40), 8000 * 4);
    assert.equal(wav.length, 44 + 8000 * 4);
    for (let offset = 44; offset < wav.length; offset += 2) assert.equal(wav.readInt16LE(offset), 8192);

    await command('recordDemo', { recording: true });
    assert.equal(ready()?.performance.demo, 'armed');
    await command('recordDemo', { recording: false });
    await until(() => ready()?.performance.demo === 'idle' ? true : undefined);
    assert.equal((await download('HEAD')).status, 200, 'Cancel preserves the prior complete WAV');

    await command('setClick', { enabled: true });
    await command('start', { bpm: 240, countInBars: 0, startBar: 1, endBar: 1, loop: true, recordDemo: true });
    await until(() => {
      const active = ready()?.performance;
      return active?.demo === 'recording' && (active.state.beat ?? 0) >= 2 ? true : undefined;
    });
    await command('recordDemo', { recording: false });
    await until(() => ready()?.performance.demo === 'saved' ? true : undefined);
    assert.equal(ready()?.performance.state.phase, 'playing', 'Finishing a demo leaves transport playing');
    const finished = Buffer.from(await (await download()).arrayBuffer());
    assert(finished.length > 44 && finished.length < wav.length);
    assert(Array.from({ length: (finished.length - 44) / 2 }, (_, index) => finished.readInt16LE(44 + index * 2))
      .some(sample => sample !== 8192), 'The enabled song click is included in the mono-input stereo mix');

    controller.setAudio('off');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    assert.deepEqual(Buffer.from(await (await download()).arrayBuffer()), finished);
  } finally {
    await controller.close();
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.deepEqual(await readdir(profile.runtimeRoot), [], 'Runtime recordings are cleaned up on desk shutdown');
    await rm(directory, { recursive: true, force: true });
  }
});
