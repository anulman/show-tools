import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { compiledCaptureFixture } from '../../performance/tests/fixtures/compiled-capture.js';
import { PersistentDesk } from '../controller.js';
import { prepareHost } from '../prepare.js';
import { HostConnection } from '../host-connection.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

async function desk() {
  const directory = await mkdtemp(join(tmpdir(), 'desk-'));
  const profile = sessionProfile(directory);
  const controller = new PersistentDesk(profile, installedPackage().installed);
  return { directory, profile, controller, async dispose() { await controller.close(); await rm(directory, { recursive: true, force: true }); } };
}

test('audio goals converge, off during start wins, attempts fence stale controls, and close reaps', async () => {
  const fixture = await desk();
  const { controller, profile } = fixture;
  try {
    assert.deepEqual(controller.snapshot().audio, { kind: 'off' });
    assert.equal(controller.setAudio('on').outcome, 'accepted');
    const starting = controller.snapshot().audio;
    assert.equal(controller.setAudio('on').view.audio, starting);
    controller.setAudio('off');
    assert.equal(controller.snapshot().audio.kind, 'stopping');
    assert.equal(controller.setAudio('on').outcome, 'rejected');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    assert.deepEqual(await readdir(profile.runtimeRoot).catch(() => []), []);
    controller.setAudio('on');
    const first = await until(() => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; });
    assert.equal(first.performance.state.phase, 'idle');
    const oldTarget = { attempt: first.attempt, hostEpoch: first.performance.hostEpoch };
    assert.equal((await controller.command(oldTarget, { command: 'stop', args: {} })).outcome, 'applied');
    controller.setAudio('off');
    assert.equal((await controller.command(oldTarget, { command: 'start', args: {} })).outcome, 'rejected');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    controller.setAudio('on');
    const second = await until(() => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; });
    assert.notEqual(first.attempt, second.attempt);
    assert.notEqual(first.performance.hostEpoch, second.performance.hostEpoch);
    assert.equal((await controller.command(oldTarget, { command: 'stop', args: {} })).outcome, 'rejected');
    await controller.close();
    assert.deepEqual(await readdir(profile.runtimeRoot), []);
    assert.equal(controller.snapshot().audio.kind, 'off');
    assert.equal(controller.setAudio('on').outcome, 'rejected');
  } finally { await fixture.dispose(); }
});

test('failed startup reaps before fault and never automatically retries', async () => {
  const fixture = await desk();
  try {
    const executable = join(fixture.directory, 'fails');
    await writeFile(executable, '#!/bin/sh\nexit 7\n'); await chmod(executable, 0o700);
    const controller = new PersistentDesk({ ...fixture.profile, native: { ...fixture.profile.native, executable } }, installedPackage().installed);
    try {
      controller.setAudio('on');
      await until(() => controller.snapshot().audio.kind === 'fault' ? true : undefined);
      assert.deepEqual(await readdir(fixture.profile.runtimeRoot), []);
      const fault = controller.snapshot();
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(controller.snapshot(), fault);
      controller.setAudio('off');
      assert.equal(controller.snapshot().audio.kind, 'off');
    } finally { await controller.close(); }
  } finally { await fixture.dispose(); }
});

test('SIGTERM refusal is force killed and reaped before off', async () => {
  const fixture = await desk();
  try {
    const executable = join(fixture.directory, 'stubborn');
    const marker = join(fixture.directory, 'pid');
    await writeFile(executable, `#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o700);
    const controller = new PersistentDesk({ ...fixture.profile, native: { ...fixture.profile.native, executable } }, installedPackage().installed);
    try {
      controller.setAudio('on');
      const { readFile } = await import('node:fs/promises');
      let pid: number | undefined;
      for (let count = 0; pid === undefined; count++) {
        try { pid = Number(await readFile(marker, 'utf8')); } catch { if (count > 300) throw new Error('No child marker'); await new Promise(resolve => setTimeout(resolve, 10)); }
      }
      controller.setAudio('off');
      await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
      assert.throws(() => process.kill(pid!, 0));
      assert.deepEqual(await readdir(fixture.profile.runtimeRoot), []);
    } finally { await controller.close(); }
  } finally { await fixture.dispose(); }
});

test('standalone preparation cancellation is bounded', async () => {
  const fixture = installedPackage();
  const abort = new AbortController(); abort.abort();
  await assert.rejects(prepareHost('/missing', fixture.manifest, fixture.packet, fixture.configurations, abort.signal), /canceled|disconnected/);
});

test('native managed host exits after its actual parent crashes and rejects forged owners', async () => {
  const binary = resolve(process.env.NATIVE_FAKE_HOST ?? 'build/native-host/native_fake_host');
  const directory = await mkdtemp(join(tmpdir(), 'owner-'));
  const socket = join(directory, 'native.sock');
  const parentSource = `const {spawn}=require('node:child_process'); const child=spawn(${JSON.stringify(binary)},[${JSON.stringify(socket)},'8000','127','32','30','.25','--owner-pid',String(process.pid)],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);`;
  const parent = spawn(process.execPath, ['-e', parentSource], { stdio: ['ignore', 'pipe', 'inherit'] });
  let nativePid: number | undefined;
  try {
    const [output] = await once(parent.stdout, 'data');
    nativePid = Number(String(output).trim());
    const { stat } = await import('node:fs/promises');
    for (let count = 0; ; count++) { try { await stat(socket); break; } catch { if (count > 300) throw new Error('No native socket'); await new Promise(resolve => setTimeout(resolve, 10)); } }
    const connected = new Promise<void>((resolve, reject) => { const connection = new HostConnection(socket, () => { connection.close(); resolve(); }, () => reject(new Error('Native failed handshake'))); });
    await connected;
    parent.kill('SIGKILL'); await once(parent, 'exit');
    await until(() => { try { process.kill(nativePid!, 0); return undefined; } catch { return true; } }, 'orphan native process survived parent crash');
    const forged = spawn(binary, [socket, '8000', '127', '32', '30', '.25', '--owner-pid', String(process.pid + 1)], { stdio: 'ignore' });
    assert.equal((await once(forged, 'exit'))[0], 2);
  } finally {
    parent.kill('SIGKILL');
    if (nativePid) { try { process.kill(nativePid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});

test('transport Stop retains a captured take while terminate and re-enable discard it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'capture-desk-'));
  const controller = new PersistentDesk(sessionProfile(directory), installedPackage(await compiledCaptureFixture()).installed);
  const ready = () => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; };
  try {
    controller.setAudio('on');
    const initial = await until(ready);
    const target = { attempt: initial.attempt, hostEpoch: initial.performance.hostEpoch };
    assert.equal((await controller.command(target, { command: 'start', args: { bpm: 240, countInBars: 1, startBar: 1, endBar: 4, loop: false } })).outcome, 'applied');
    assert.equal((await controller.command(target, { command: 'control', args: { control: { id: 'R1' }, commandId: 'capture' } })).outcome, 'applied');
    await until(() => ready()?.performance.state.compiledTakes?.[0]?.ready ? true : undefined, 'Synthetic take never committed');
    const stopped = await controller.command(target, { command: 'stop', args: {} });
    assert.equal(stopped.outcome, 'applied');
    if (stopped.outcome !== 'applied') throw new Error('Stop failed');
    assert.equal(stopped.state.compiledTakes?.[0]?.ready, true);
    assert.ok((stopped.state.compiledTakes?.[0]?.frames ?? 0) > 0);
    controller.setAudio('off');
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    controller.setAudio('on');
    const replacement = await until(ready);
    assert.notEqual(replacement.performance.hostEpoch, target.hostEpoch);
    assert.ok(replacement.performance.state.compiledTakes?.every(take => !take.ready && take.frames === 0));
  } finally { await controller.close(); await rm(directory, { recursive: true, force: true }); }
});
