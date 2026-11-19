import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import tribulations from '../../../songs/tribulations.js';
import { PersistentDesk } from '../controller.js';
import { createGateway } from '../gateway.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

test('the hardware desk admits Tribulations shake hits through the authenticated command route', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tambourine-audition-'));
  assert(tribulations.compiled);
  const fixture = sessionProfile(directory);
  const controller = new PersistentDesk({ ...fixture, native: { ...fixture.native, sampleRate: 48000 } },
    installedPackage(tribulations.compiled).installed);
  const origin = 'http://127.0.0.1', key = '012345678901234567890123456789ab';
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(key), staticRoot: directory }, controller);
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}/api/`;
    const headers = { authorization: `Bearer ${key}`, origin, 'content-type': 'application/json' };
    controller.setAudio('on');
    const audio = await until(() => {
      const value = controller.snapshot().audio;
      if (value.kind === 'fault') throw new Error(value.error);
      return value.kind === 'ready' ? value : undefined;
    });
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    const bootstrap = await fetch(base + 'session', { headers }).then(response => response.json());
    let sequence = 0;
    async function command(name: string, args: object) {
      const response = await fetch(base + 'command', { method: 'POST', headers,
        body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: ++sequence, target, command: name, args }) });
      assert.equal(response.status, 200);
      return response.json();
    }
    const audition = (velocity: number) => command('auditionTambourine', { velocity });

    assert.equal((await audition(100)).outcome, 'rejected');
    assert.equal((await audition(0)).outcome, 'applied');
    assert.equal((await audition(128)).outcome, 'rejected');
    const hit = await audition(100);
    assert.equal(hit.outcome, 'applied', JSON.stringify(hit));
    assert.equal(hit.state.phase, 'idle');
    assert.equal((await audition(-1)).outcome, 'applied');
    assert.equal((await audition(100)).outcome, 'rejected');
    assert.equal((await audition(0)).outcome, 'applied');
    assert.equal((await command('start', { bpm: 120, countInBars: 0, startBar: 1, endBar: 2, loop: false })).outcome, 'applied');
    assert.equal((await audition(100)).outcome, 'rejected');
    assert.equal((await command('stop', {})).outcome, 'applied');
    assert.equal((await audition(100)).outcome, 'rejected');
  } finally {
    await controller.close();
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
