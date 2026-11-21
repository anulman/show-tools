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
  const directory = await mkdtemp(join(tmpdir(), 'trib-'));
  assert(tribulations.compiled);
  const fixture = sessionProfile(directory);
  const controller = new PersistentDesk({ ...fixture, native: { ...fixture.native, sampleRate: 48000, driver: { kind: 'fake', inputLevel: 0 } } },
    installedPackage(tribulations.compiled).installed);
  const origin = 'http://127.0.0.1', key = '012345678901234567890123456789ab';
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(key), staticRoot: directory }, controller);
  const streams: AbortController[] = [];
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
    async function client() {
      const bootstrap = await fetch(base + 'session', { headers }).then(response => response.json());
      const stream = new AbortController();
      streams.push(stream);
      let sequence = 0;
      return {
        async attach() {
          const response = await fetch(base + 'events', { headers: { ...headers, 'x-session-id': bootstrap.sessionId }, signal: stream.signal });
          assert.equal(response.status, 200);
          const reader = response.body?.getReader();
          assert(reader);
          void (async () => { while (!(await reader.read()).done) {} })().catch(() => {});
        },
        disconnect() { stream.abort(); },
        async command(name: string, args: object) {
          const response = await fetch(base + 'command', { method: 'POST', headers,
            body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: ++sequence, target, command: name, args }) });
          return { status: response.status, result: await response.json() };
        },
      };
    }
    const owner = await client(), other = await client();
    const command = async (name: string, args: object) => {
      const response = await owner.command(name, args);
      assert.equal(response.status, 200);
      return response.result;
    };
    const audition = (velocity: number) => command('auditionTambourine', { velocity });
    const otherAudition = async (velocity: number) => (await other.command('auditionTambourine', { velocity })).result;
    assert.equal((await audition(0)).outcome, 'rejected', 'an event stream is required before arming');
    await owner.attach();
    await other.attach();

    assert.equal((await audition(100)).outcome, 'rejected');
    assert.equal((await audition(0)).outcome, 'applied');
    assert.equal((await audition(128)).outcome, 'rejected');
    assert.equal((await otherAudition(100)).outcome, 'rejected', 'a different browser cannot send hits');
    assert.equal((await otherAudition(-1)).outcome, 'rejected', 'a different browser cannot end the audition');
    assert.equal((await otherAudition(0)).outcome, 'rejected', 'a different browser cannot take over');
    const hit = await audition(100);
    assert.equal(hit.outcome, 'applied', JSON.stringify(hit));
    assert.equal(hit.state.phase, 'idle');
    assert.equal((await audition(-1)).outcome, 'applied');
    assert.equal((await audition(100)).outcome, 'rejected');
    assert.equal((await audition(0)).outcome, 'applied');
    assert.equal((await command('setClick', { enabled: false })).outcome, 'applied');
    for (const { bar, preview } of [{ bar: 137, preview: false }, { bar: 1, preview: true }]) {
      assert.equal((await command('start', { bpm: 120, countInBars: 0, startBar: bar, endBar: bar, loop: false, recordDemo: true })).outcome, 'applied');
      await until(() => {
        const active = controller.snapshot().audio;
        return active.kind === 'ready' && active.performance.state.bar === bar ? true : undefined;
      });
      assert.equal((await audition(100)).outcome, 'rejected', 'starting transport clears the old audition');
      if (preview) {
        assert.equal((await audition(0)).outcome, 'applied', 'the first in-song audition can arm outside the chart window');
        assert.equal((await command('auditionTambourine', { velocity: 127, slot: 2 })).outcome, 'applied');
      } else {
        assert.equal((await command('control', { control: { id: 'external', slot: 0 }, commandId: 'phone-motion/test/1' })).outcome, 'applied');
      }
      await until(() => {
        const active = controller.snapshot().audio;
        return active.kind === 'ready' && active.performance.demo === 'saved' ? true : undefined;
      });
      const demo = await fetch(base + 'demo-recording', { headers });
      assert.equal(demo.status, 200);
      const wav = Buffer.from(await demo.arrayBuffer());
      assert.equal(wav.toString('ascii', 36, 40), 'data');
      let peak = 0;
      for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
      assert(peak > 400, `tambourine reaches the native song mix at bar ${bar} (peak ${peak})`);
      assert.equal((await command('stop', {})).outcome, 'applied');
    }
    assert.equal((await audition(100)).outcome, 'rejected');
    assert.equal((await audition(0)).outcome, 'applied');
    owner.disconnect();
    let expired = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      expired = (await owner.command('auditionTambourine', { velocity: 100 })).status === 409;
      if (expired) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert(expired, 'the gateway observes the disconnect');
    assert.equal((await otherAudition(100)).outcome, 'rejected', 'a disconnected owner cannot leave a usable audition');
    assert.equal((await otherAudition(0)).outcome, 'applied', 'another browser can arm after disconnect');
    assert.equal((await otherAudition(95)).outcome, 'applied');
  } finally {
    for (const stream of streams) stream.abort();
    await controller.close();
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
    await rm(directory, { recursive: true, force: true });
  }
});
