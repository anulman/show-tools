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
import { decodePublication } from '../native-schema.js';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('stopped native tuner publishes telemetry and Panic clears tuning and fences old revisions', { timeout: 20000 }, async () => {
  const binary = resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host');
  await stat(binary);
  const directory = await mkdtemp(join(tmpdir(), 'remote-panic-'));
  const socket = join(directory, 'socket');
  const host = spawn(binary, [socket, '8000', '509', '32', '30', '.25']);
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
    const initial = connected.snapshot();
    assert.ok(initial && initial.type === 'session');
    const tuner = () => {
      const snapshot = decodePublication(connected.snapshot());
      if (snapshot.type !== 'session') throw new Error('Missing native session');
      return snapshot.tuner;
    };
    const command = (args: object) => connected.command({ command: 'tuner', args });
    assert.equal((await command({ kind: 'configure', expectedRevision: tuner().revision, root: 60, scale: 'major' })).outcome, 'applied');
    const stale = tuner().revision;
    assert.equal((await command({ kind: 'cue', expectedRevision: stale })).outcome, 'applied');
    assert.equal(tuner().preview.kind, 'note');
    assert.equal((await command({ kind: 'confirm', expectedRevision: stale })).outcome, 'rejected');
    for (let i = 0; i < 300 && tuner().preview.kind !== 'silent'; i++) await delay(10);
    assert.equal(tuner().preview.kind, 'silent', 'bounded cue publishes idle completion');
    assert.equal((await command({ kind: 'listen', expectedRevision: tuner().revision, enabled: true })).outcome, 'applied');
    const listeningRevision = tuner().revision;
    for (let i = 0; i < 100 && tuner().pitch.kind !== 'unvoiced'; i++) await delay(10);
    assert.equal(tuner().pitch.kind, 'unvoiced', 'constant fake input is not an acoustic pitch fixture');
    assert.equal(tuner().revision, listeningRevision, 'telemetry does not mutate control revision');
    assert.equal((await command({ kind: 'confirm', expectedRevision: listeningRevision })).outcome, 'applied');
    assert.equal(tuner().step, 1);
    assert.equal((await connected.command({ command: 'stop', args: {} })).outcome, 'applied');
    assert.equal(tuner().listening, false);
    assert.equal((await command({ kind: 'listen', expectedRevision: listeningRevision, enabled: true })).outcome, 'rejected');
    assert.equal((await command({ kind: 'listen', expectedRevision: tuner().revision, enabled: true })).outcome, 'applied');
    assert.equal(tuner().listening, true, 'listening is acknowledged before Panic is sent');
    const beforePanic = tuner().revision;
    const panic = await connected.command({ command: 'control', args: { control: { id: 'mushroom' } } });
    assert.equal(panic.outcome, 'applied');
    assert.equal(tuner().listening, false, 'Panic clears acknowledged listening');
    assert.ok(tuner().revision > beforePanic, 'Panic advances the tuner control fence');
    assert.equal((await command({ kind: 'listen', expectedRevision: beforePanic, enabled: true })).outcome, 'rejected');
    assert.equal(tuner().listening, false, 'an old revision cannot restore listening after Panic');
    const after = decodePublication(connected.snapshot());
    if (after.type !== 'session') throw new Error('Missing native session');
    assert.equal(after.state.phase, 'idle');
    assert.equal(after.state.runId, before.state.runId);
    assert.equal((await connected.command({ command: 'start', args: { countInBars: 0, startBar: 1, endBar: 2 } })).outcome, 'applied');
    assert.equal((await command({ kind: 'close', expectedRevision: tuner().revision })).outcome, 'applied');
    const running = decodePublication(connected.snapshot());
    if (running.type !== 'session') throw new Error('Missing native session');
    assert.equal(running.state.phase, 'playing', 'Closing a sibling tuner view does not stop another controller\'s performance');
  } finally {
    instrument?.close();
    host.kill('SIGKILL');
    if (host.exitCode === null) await once(host, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
});
