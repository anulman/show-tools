import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PersistentDesk } from '../controller.js';
import { createGateway } from '../gateway.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';
import { decodeRecordingArchive, RECORDING_ARCHIVE_BATCH } from '../recording-archive-schema.js';

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

test('completed takes remain distinct and retryable across a hardware desk restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wav-'));
  const recordingArchiveRoot = join(directory, 'retained');
  await mkdir(recordingArchiveRoot, { mode: 0o700 });
  const profile = { ...sessionProfile(directory), recordingArchiveRoot };
  const origin = 'http://127.0.0.1', key = '012345678901234567890123456789ab';
  const headers = { authorization: 'Bearer ' + key, origin, 'content-type': 'application/json' };
  const run = async (work: (controller: PersistentDesk, base: string) => Promise<void>) => {
    const controller = new PersistentDesk(profile, installedPackage().installed);
    const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(key), staticRoot: directory }, controller);
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const address = server.address();
      assert(address && typeof address !== 'string');
      await work(controller, 'http://127.0.0.1:' + address.port + '/api/');
    } finally {
      await controller.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  };
  const archive = 'recording-archive';
  const pending = async (base: string) => {
    const response = await fetch(base + archive, { headers });
    assert.equal(response.status, 200);
    return decodeRecordingArchive(await response.json()).pending;
  };
  try {
    const originals = new Map<string, Buffer>();
    await run(async (controller, base) => {
      assert.equal((await fetch(base + archive)).status, 401);
      assert.deepEqual(await pending(base), []);
      controller.setAudio('on');
      const audio = await until(() => {
        const view = controller.snapshot().audio;
        if (view.kind === 'fault') assert.fail(view.error);
        return view.kind === 'ready' ? view : undefined;
      });
      const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
      const bootstrap = await fetch(base + 'session', { headers }).then(response => response.json());
      for (let sequence = 1; sequence <= 2; ++sequence) {
        const start = await fetch(base + 'command', { method: 'POST', headers,
          body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence, target, command: 'start',
            args: { bpm: 240, countInBars: 0, startBar: 1, endBar: 1, loop: false, recordDemo: true } }) });
        assert.equal((await start.json()).outcome, 'applied');
        await until(() => {
          const view = controller.snapshot().audio;
          return view.kind === 'ready' && view.performance.demo === 'saved' ? true : undefined;
        });
        assert.equal((await pending(base)).length, sequence);
      }
      for (const take of await pending(base)) {
        assert('bytes' in take, 'Native writer publishes valid PCM');
        const endpoint = base + archive + '/' + take.id;
        assert.equal((await fetch(endpoint, { method: 'POST', headers: { authorization: headers.authorization } })).status, 403);
        const wav = Buffer.from(await (await fetch(endpoint, { headers })).arrayBuffer());
        assert.equal(wav.length, take.bytes);
        assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
        originals.set(take.id, wav);
      }
      assert.equal(originals.size, 2);
    });
    await run(async (_controller, base) => {
      assert.deepEqual((await pending(base)).map(take => take.id), [...originals.keys()]);
      for (const [id, wav] of originals) {
        const endpoint = base + archive + '/' + id;
        assert.deepEqual(Buffer.from(await (await fetch(endpoint, { headers })).arrayBuffer()), wav);
        assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 200);
        assert.equal((await fetch(endpoint, { method: 'POST', headers })).status, 200, 'Lost ACK can be retried');
      }
      assert.deepEqual(await pending(base), []);
      assert.equal((await fetch(base + 'demo-recording', { method: 'HEAD', headers })).status, 200);
    });
    await run(async (_controller, base) => {
      assert.deepEqual(await pending(base), [], 'Receipts survive restart');
      assert.equal((await fetch(base + 'demo-recording', { method: 'HEAD', headers })).status, 200);

      const source = originals.values().next().value;
      assert(source);
      for (let index = 0; index <= RECORDING_ARCHIVE_BATCH; index++) {
        const name = 'take-Z' + String(index).padStart(5, '0');
        const directory = join(recordingArchiveRoot, name);
        await mkdir(directory, { mode: 0o700 });
        await writeFile(join(directory, 'recording.wav'), index === 0 ? Buffer.alloc(0) : source, { mode: 0o600 });
      }
      const page = decodeRecordingArchive(await (await fetch(base + archive, { headers })).json());
      assert.equal(page.pending.length, RECORDING_ARCHIVE_BATCH);
      assert.deepEqual(page.pending[0], { id: 'take-Z00000', kind: 'unavailable' });
      assert.equal(page.next, 'take-Z00015');
      const later = decodeRecordingArchive(await (await fetch(base + archive + '?after=' + page.next, { headers })).json());
      assert.deepEqual(later, { pending: [{ id: 'take-Z00016', bytes: source.length }] });
      assert.equal((await fetch(base + archive + '?after=../invalid', { headers })).status, 400);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
