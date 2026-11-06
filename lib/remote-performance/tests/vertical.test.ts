import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import song from '../../../songs/dance-yrself-clean.js';
import { compiledProgramBytes } from '../../performance/compiled-native.js';
import { encodeInitialProfiles } from '../commands.js';
import { createGateway } from '../gateway.js';
import { NativeInstrument } from '../instrument.js';
import { prepareHost } from '../prepare.js';
import { decodePublication } from '../../../ui/practice/remote-schema.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('gateway commands reach the native engine and attachment does not stop it', async () => {
  const binary = resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host');
  await stat(binary);
  const directory = await mkdtemp(join(tmpdir(), 'remote-vertical-'));
  const socket = join(directory, 'socket');
  const host = spawn(binary, [socket, '8000', '127', '32', '30', '.25']);
  let instrument: NativeInstrument | undefined;
  let server: ReturnType<typeof createGateway> | undefined;
  try {
    for (let i = 0; i < 200; i++) {
      if (host.exitCode !== null) throw new Error('Native host exited');
      try { await stat(socket); break; } catch { await delay(10); }
    }
    assert.ok(song.compiled);
    const packet = Buffer.from(compiledProgramBytes(song.compiled));
    const configurations = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));
    const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    const manifest = Buffer.from(JSON.stringify({ id: song.id, description: song.description, compiled: song.compiled, practice: song.practice,
      takeCount: song.compiled.takes.length, packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(configurations)) }));
    await prepareHost(socket, manifest, packet, configurations);
    instrument = new NativeInstrument(socket);
    for (let i = 0; i < 300 && !instrument.snapshot(); i++) await delay(10);
    assert.ok(instrument.snapshot(), 'native snapshot arrives');
    const token = Buffer.from('012345678901234567890123456789ab');
    const origin = 'http://127.0.0.1';
    server = createGateway({ host: '127.0.0.1', port: 0, origin, token, staticRoot: directory }, instrument);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = `http://127.0.0.1:${address.port}`;
    const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
    const bootstrap = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(bootstrap.song.id, song.id);
    const command = async (sequence: number, name: string, args: object) => (await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence, command: name, args }) })).json();
    const second = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(bootstrap.song.compiled.parts.length, 6);
    const slapback = [{ kind: 'slapback', delayMs: 100, feedback: .2, wet: .3 }];
    const edit = async (sessionId: string, sequence: number, profile: number, expectedRevision: number, effects: object[]) =>
      (await fetch(`${base}/api/command`, { method: 'POST', headers, body: JSON.stringify({ sessionId, sequence, command: 'configureVoiceProfile', args: { profile, expectedRevision, effects } }) })).json();
    assert.equal((await edit(second.sessionId, 1, 0, 1, slapback)).outcome, 'applied');
    const updated = await edit(bootstrap.sessionId, 1, 1, 1, slapback);
    assert.equal(updated.outcome, 'applied');
    assert.deepEqual(updated.state.voiceEffects[0].effects, slapback);
    assert.deepEqual(updated.state.voiceEffects[1].effects, slapback);
    assert.equal((await edit(bootstrap.sessionId, 2, 0, 1, [])).outcome, 'rejected');
    const stream = await fetch(`${base}/api/events`, { headers: { ...headers, 'x-session-id': bootstrap.sessionId } });
    assert.ok(stream.body);
    const reader = stream.body.pipeThrough(new TextDecoderStream()).getReader();
    const fractionalBeat = (async () => {
      let pending = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) throw new Error('Event stream ended before a fractional beat');
        pending += chunk.value;
        const messages = pending.split('\n\n');
        pending = messages.pop() ?? '';
        for (const message of messages) {
          if (!message.startsWith('data: ')) continue;
          const decoded = decodePublication(JSON.parse(message.slice(6)));
          if (decoded.type === 'event' && decoded.event.type === 'beat' && decoded.event.frame !== undefined && !Number.isInteger(decoded.event.frame)) return decoded.event.frame;
        }
      }
    })();
    const started = await command(3, 'start', { bpm: 134, startBar: 1, endBar: 10, countInBars: 1 });
    assert.equal(started.outcome, 'applied');
    assert.notEqual(started.state.runId, bootstrap.state.runId);
    const frame = await Promise.race([fractionalBeat, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('No fractional beat arrived')), 5000).unref())]);
    assert.ok(frame > 0);
    const again = await (await fetch(`${base}/api/session`, { headers })).json();
    assert.equal(again.state.runId, started.state.runId);
    const stopped = await command(4, 'stop', {});
    assert.equal(stopped.outcome, 'applied');
    await reader.cancel();
  } finally {
    instrument?.close();
    server?.close();
    host.kill('SIGTERM');
    if (host.exitCode === null) await once(host, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
});
