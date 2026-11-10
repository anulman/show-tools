import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import song from '../../../songs/dance-yrself-clean.js';
import { compiledProgramBytes } from '../../performance/compiled-native.js';
import { encodeCommand, encodeInitialProfiles } from '../commands.js';
import { HostConnection } from '../host-connection.js';
import { decodeSnapshot } from '../observation.js';
import { prepareHost } from '../prepare.js';

async function until<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  for (let attempt = 0; attempt < 500; ++attempt) {
    const value = await read();
    if (value !== undefined) return value;
    await delay(10);
  }
  throw new Error('Native IPC readiness timed out');
}

test('native IPC reconnect reapplies jiggle settings without losing partial motion or clock', { timeout: 20000 }, async () => {
  const binary = resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host');
  await stat(binary);
  const directory = await mkdtemp(join(tmpdir(), 'jiggle-host-reconnect-'));
  const socket = join(directory, 'socket');
  const host = spawn(binary, [socket, '8000', '127', '32', '30', '.25', '--step']);
  let connection: HostConnection | undefined;
  let current: ReturnType<typeof decodeSnapshot> = null;
  const snapshot = () => { assert.ok(current); return current; };
  try {
    await until(() => { if (host.exitCode !== null) throw new Error('Native host exited'); return stat(socket).then(() => true).catch(() => undefined); });
    assert.ok(song.compiled?.rotation);
    const window = song.compiled.rotation.windows[0]; assert.ok(window);
    const packet = Buffer.from(compiledProgramBytes(song.compiled));
    const profiles = Array.from({ length: 6 }, (_, profile) => ({ profile, effects: [] }));
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    const manifest = Buffer.from(JSON.stringify({ id: song.id, description: song.description, compiled: song.compiled, practice: song.practice,
      takeCount: song.compiled.takes.length, packetSha256: hash(packet), profilesSha256: hash(encodeInitialProfiles(profiles)) }));
    await prepareHost(socket, manifest, packet, profiles);
    const connect = async () => {
      current = null;
      const opened = new HostConnection(socket, frame => { if (frame.tag === 5) current = decodeSnapshot(frame.payload, opened.processEpoch); });
      connection = opened;
      await until(() => current ?? undefined);
    };
    await connect();
    const send = async (operation: Buffer) => {
      assert.ok(connection);
      const result = await connection.command(operation);
      const revision = result.readBigUInt64LE(8);
      await until(() => current && current.revision >= revision ? true : undefined);
      return { status: result.readUInt32LE(0), code: result.readInt32LE(4) };
    };
    const command = (input: unknown) => send(encodeCommand(input, snapshot().state));
    const configure = (minimumTravel = 4, minimumReversal = 2) => command({ command: 'configureJiggle', args: { minimumTravel, minimumReversal } });
    const move = (value: number) => command({ command: 'control', args: { control: { id: 'knob', value } } });
    const backup = () => { const profile = snapshot().state.voiceEffects?.find(value => value.profile === 5); assert.ok(profile); return profile; };
    const remaining = () => backup().rotationRemainingBeats;
    assert.equal((await configure(6, 2)).status, 0, 'Prepared host permits a changed configuration');
    assert.equal((await configure()).status, 0);
    assert.equal((await command({ command: 'start', args: { bpm: 120, countInBars: 0, startBar: window.begin.bar } })).status, 0);
    const step = Buffer.alloc(6); step.writeUInt16LE(11); step.writeUInt32LE(Math.ceil((window.begin.beat + 1) * 4000) + 1, 2);
    assert.equal((await send(step)).status, 0);
    assert.equal(backup().rotationEligible, true, 'stepped IPC fixture is inside an authored jiggle window');
    assert.equal((await move(2)).status, 0); assert.equal(remaining(), 0);
    const before = snapshot().state;
    connection?.close(); await connect();
    assert.equal((await configure()).status, 0, 'Running host delegates identical configuration to the engine');
    assert.deepEqual(snapshot().state, before, 'socket reconnect and identical configuration preserve native clock/run state');
    const changed = await configure(6, 2);
    assert.equal(changed.status, 1); assert.equal(changed.code, 16, 'engine rejects a changed running configuration');
    assert.equal((await configure()).status, 0);
    assert.deepEqual(snapshot().state, before);
    assert.equal((await move(2)).status, 0); assert.equal(remaining(), .25, 'partial travel survives real IPC reconnect');
    step.writeUInt32LE(200, 2); assert.equal((await send(step)).status, 0);
    const active = remaining(), clock = snapshot().state;
    assert.equal((await configure()).status, 0); assert.equal(remaining(), active);
    assert.deepEqual(snapshot().state, clock, 'same settings neither refresh inactivity nor reset the clock');
    assert.equal((await move(-1)).status, 0); assert.equal((await configure()).status, 0);
    assert.equal((await move(-1)).status, 0); assert.equal(remaining(), .25, 'partial reversal survives real IPC reconfiguration');
  } finally {
    connection?.close(); host.kill('SIGKILL');
    if (host.exitCode === null) await once(host, 'exit');
    await rm(directory, { recursive: true, force: true });
  }
});
