import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { PF } from '../../performance/wasm-abi.js';
import { PersistentDesk } from '../controller.js';
import { encodeFrame, FrameDecoder } from '../framing.js';
import { HostDisconnected } from '../host-connection.js';
import { prepareInstalledPackage } from '../prepare.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

async function peer(onConnection: (socket: Socket) => void) {
  const directory = await mkdtemp(join(tmpdir(), 'prepare-'));
  const path = join(directory, 'socket');
  const sockets = new Set<Socket>();
  let accepts = 0;
  const server = createServer(socket => {
    accepts++;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    onConnection(socket);
  });
  return { directory, path, server, accepts: () => accepts,
    async listen() { server.listen(path); await once(server, 'listening'); },
    async dispose() {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function handshake(socket: Socket, command: () => void, incompatible = false) {
  const hello = Buffer.alloc(40, 7);
  hello.writeUInt32LE(PF.ABI_VERSION + (incompatible ? 1 : 0), 32);
  hello.writeUInt32LE(PF.COMPILED_VERSION, 36);
  socket.write(encodeFrame({ tag: 1, sequence: 0, payload: hello }));
  const decoder = new FrameDecoder();
  socket.on('data', data => {
    for (const frame of decoder.push(Buffer.from(data))) {
      if (frame.tag === 2) socket.write(encodeFrame({ tag: 5, sequence: 0, payload: Buffer.alloc(0) }));
      else if (frame.tag === 3) {
        assert.equal(frame.payload.readUInt16LE(32), 9);
        command();
      }
    }
  });
}

test('a connected peer closing before HELLO or rejecting the ABI is never retried', async () => {
  for (const incompatible of [false, true]) {
    const fixture = await peer(socket => {
      if (incompatible) handshake(socket, () => assert.fail('Incompatible host received preparation'), true);
      else socket.destroy();
    });
    try {
      await fixture.listen();
      await assert.rejects(prepareInstalledPackage(fixture.path, installedPackage().installed), HostDisconnected);
      await delay(40);
      assert.equal(fixture.accepts(), 1);
    } finally { await fixture.dispose(); }
  }
});

test('disconnect after preparation reaches the host never replays the operation', async () => {
  let commands = 0;
  const fixture = await peer(socket => handshake(socket, () => { commands++; socket.destroy(); }));
  try {
    await fixture.listen();
    await assert.rejects(prepareInstalledPackage(fixture.path, installedPackage().installed), HostDisconnected);
    await delay(40);
    assert.equal(commands, 1);
    assert.equal(fixture.accepts(), 1);
  } finally { await fixture.dispose(); }
});

test('cancellation during readiness handoff closes the connection without sending preparation', async () => {
  let commands = 0;
  let closed = false;
  const fixture = await peer(socket => {
    socket.once('close', () => { closed = true; });
    handshake(socket, () => { commands++; });
  });
  const abort = new AbortController();
  const enqueue = globalThis.queueMicrotask;
  let scheduled = false;
  try {
    await fixture.listen();
    globalThis.queueMicrotask = callback => enqueue(() => {
      callback();
      if (!scheduled) { scheduled = true; enqueue(() => abort.abort()); }
    });
    await assert.rejects(prepareInstalledPackage(fixture.path, installedPackage().installed, abort.signal), /canceled/);
    await until(() => closed ? true : undefined);
    assert.equal(scheduled, true);
    assert.equal(commands, 0);
    assert.equal(fixture.accepts(), 1);
  } finally { globalThis.queueMicrotask = enqueue; await fixture.dispose(); }
});

test('already canceled preparation makes no connection and cancellation stops admission retries', async () => {
  const fixture = await peer(socket => socket.destroy());
  try {
    const already = new AbortController(); already.abort();
    await assert.rejects(prepareInstalledPackage(fixture.path, installedPackage().installed, already.signal), /canceled/);
    const canceled = new AbortController();
    const preparing = prepareInstalledPackage(fixture.path, installedPackage().installed, canceled.signal);
    const rejected = assert.rejects(preparing, /canceled/);
    await delay(30); canceled.abort();
    await rejected;
    await fixture.listen();
    await delay(60);
    assert.equal(fixture.accepts(), 0);
  } finally { await fixture.dispose(); }
});

test('permission errors are terminal rather than unavailable admission', { skip: process.getuid?.() === 0 }, async () => {
  const fixture = await peer(socket => socket.destroy());
  try {
    await chmod(fixture.directory, 0);
    await assert.rejects(prepareInstalledPackage(fixture.path, installedPackage().installed), HostDisconnected);
    assert.equal(fixture.accepts(), 0);
  } finally { await chmod(fixture.directory, 0o700); await fixture.dispose(); }
});

test('one deadline bounds missing admission and delayed admission with a withheld command result', { timeout: 10000 }, async () => {
  let commands = 0;
  const fixture = await peer(socket => handshake(socket, () => { commands++; }));
  const start = performance.now();
  const listening = setTimeout(() => { void fixture.listen(); }, 3000);
  try {
    await Promise.all([
      assert.rejects(prepareInstalledPackage(join(fixture.directory, 'missing'), installedPackage().installed), /timed out/),
      assert.rejects(prepareInstalledPackage(fixture.path, installedPackage().installed), /timed out/),
    ]);
    assert.equal(commands, 1);
    assert.equal(fixture.accepts(), 1);
    assert.ok(performance.now() - start < 7000, 'Admission must not reset the five-second preparation deadline');
  } finally { clearTimeout(listening); await fixture.dispose(); }
});

test('native startup tolerates an early bound socket and cancellation still reaps its owner', { timeout: 15000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-admission-'));
  const base = sessionProfile(directory);
  const executable = join(directory, 'delayed-native');
  const marker = join(directory, 'bound-pid');
  await writeFile(executable, `#!/usr/bin/env python3
import os, socket, sys, time
bound = socket.socket(socket.AF_UNIX)
bound.bind(sys.argv[1])
with open(${JSON.stringify(marker)}, 'w') as marker:
    marker.write(str(os.getpid()))
time.sleep(0.25)
bound.close()
os.unlink(sys.argv[1])
binary = ${JSON.stringify(base.native.executable)}
os.execv(binary, [binary, *sys.argv[1:]])
`, { mode: 0o700 });
  const controller = new PersistentDesk({ ...base, native: { ...base.native, executable } }, installedPackage().installed);
  try {
    controller.setAudio('on');
    await until(() => {
      const audio = controller.snapshot().audio;
      if (audio.kind === 'fault') throw new Error(audio.error);
      return audio.kind === 'ready' ? true : undefined;
    });
    const firstPid = Number(await readFile(marker, 'utf8'));
    controller.setAudio('off');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    assert.throws(() => process.kill(firstPid, 0));
    await rm(marker);
    controller.setAudio('on');
    const secondPid = await until(() => {
      try { const pid = Number(readFileSync(marker, 'utf8')); return Number.isInteger(pid) && pid > 1 ? pid : undefined; }
      catch { return undefined; }
    });
    controller.setAudio('off');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    assert.throws(() => process.kill(secondPid, 0));
    assert.deepEqual(await readdir(base.runtimeRoot), []);
  } finally { await controller.close(); await rm(directory, { recursive: true, force: true }); }
});
