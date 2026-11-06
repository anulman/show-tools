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
import { NativeInstrument } from '../instrument.js';
import { prepareHost } from '../prepare.js';
import { decodePublication } from '../../../ui/practice/remote-schema.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('Panic uses the reserved native slot, cancels older Starts, and remains a control event', { timeout: 20000 }, async () => {
  const binary = resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host');
  await stat(binary);
  const directory = await mkdtemp(join(tmpdir(), 'remote-panic-'));
  const socket = join(directory, 'socket');
  const host = spawn(binary, [socket, '8000', '16384', '32', '30', '.25', '--step']);
  let instrument: NativeInstrument | undefined;
  try {
    for (let i = 0; i < 200; i++) {
      if (host.exitCode !== null) throw new Error('Native host exited');
      try { await stat(socket); break; } catch { await delay(10); }
    }
    assert.ok(song.compiled);
    const packet = Buffer.from(compiledProgramBytes(song.compiled));
    const profiles = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));
    const hash = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
    const manifest = Buffer.from(JSON.stringify({ id: song.id, description: song.description, compiled: song.compiled, practice: song.practice,
      takeCount: song.compiled.takes.length, packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(profiles)) }));
    await prepareHost(socket, manifest, packet, profiles);
    const connected = new NativeInstrument(socket);
    instrument = connected;
    for (let i = 0; i < 500 && !connected.snapshot(); i++) await delay(10);
    const before = decodePublication(connected.snapshot());
    assert.equal(before.type, 'session');
    if (before.type !== 'session') throw new Error('Expected a session');
    let observedPanic = false;
    connected.subscribe(publication => {
      const decoded = decodePublication(publication);
      if (decoded.type === 'event' && decoded.event.type === 'control' && decoded.event.control?.id === 'mushroom') {
        assert.equal(decoded.event.applied, true);
        assert.equal(decoded.event.state.phase, 'idle');
        observedPanic = true;
      }
    });
    const older = Array.from({ length: 256 }, () => connected.command({ command: 'start', args: {} }));
    const results = Promise.allSettled(older);
    const panic = connected.command({ command: 'control', args: { control: { id: 'mushroom' }, commandId: 'panic-1' } });
    assert.equal((await panic).outcome, 'applied');
    for (const result of await results) {
      if (result.status !== 'fulfilled') throw result.reason;
      assert.equal(result.value.outcome, 'rejected', 'Panic cancels every older queued Start');
    }
    const after = decodePublication(connected.snapshot());
    assert.equal(after.type, 'session');
    if (after.type !== 'session') throw new Error('Expected a session');
    assert.equal(after.state.phase, 'idle');
    assert.equal(after.state.runId, before.state.runId, 'canceled Starts never create a run');
    for (let i = 0; i < 100 && !observedPanic; i++) await delay(10);
    assert.equal(observedPanic, true);
  } finally {
    instrument?.close();
    host.kill('SIGKILL');
    if (host.exitCode === null) await once(host, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
});
