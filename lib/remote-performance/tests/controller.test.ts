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

test('an unarmed physical mushroom press terminates audio without a browser', async () => {
  const fixture = await desk();
  const { controller, profile } = fixture;
  try {
    controller.setAudio('on');
    const audio = await until(() => { const current = controller.snapshot().audio; return current.kind === 'ready' ? current : undefined; });
    const target = { attempt: audio.attempt, hostEpoch: audio.performance.hostEpoch };
    const routing = audio.performance.state.inputRouting;
    assert.ok(routing);
    const bindingGeneration = routing.bindingGeneration;
    const producer = 0, session = routing.sessionHighWatermark + 1;
    assert.equal((await controller.command(target, { command: 'inputAttach', args: {
      producer, session, bindingGeneration, kind: 'physical', releasedMask: 32, heldMask: 0,
    } })).outcome, 'applied');
    const result = await controller.command(target, { command: 'inputEvent', args: {
      producer, session, bindingGeneration, sequence: 1, input: 5, value: 1,
    } });
    assert.notEqual(result.outcome, 'rejected', JSON.stringify(result));
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined,
      () => `Physical panic failed to terminate audio (command: ${result.outcome}, audio: ${controller.snapshot().audio.kind})`);
    assert.deepEqual(await readdir(profile.runtimeRoot), []);
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
  const ready = () => {
    const audio = controller.snapshot().audio;
    if (audio.kind === 'fault') throw new Error(audio.error);
    return audio.kind === 'ready' ? audio : undefined;
  };
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
    const replacement = await until(ready, () => `Replacement engine did not become ready: ${JSON.stringify(controller.snapshot().audio)}`);
    assert.notEqual(replacement.performance.hostEpoch, target.hostEpoch);
    assert.ok(replacement.performance.state.compiledTakes?.every(take => !take.ready && take.frames === 0));
  } finally { await controller.close(); await rm(directory, { recursive: true, force: true }); }
});

test('startup faults retain a bounded sanitized diagnostic tail while draining past capacity', async () => {
  const fixture = await desk();
  try {
    const executable = join(fixture.directory, 'diagnostic-failure');
    await writeFile(executable, `#!${process.execPath}\nprocess.stderr.write('discarded-prefix\\n' + 'x'.repeat(1024 * 1024) + '\\n\\u001b[31mALSA open failed: configured capture device is busy\\u001b[0m\\u0000\\n', () => process.exit(7));\n`, { mode: 0o700 });
    const controller = new PersistentDesk({ ...fixture.profile, native: { ...fixture.profile.native, executable } }, installedPackage().installed);
    try {
      controller.setAudio('on');
      const fault = await until(() => { const audio = controller.snapshot().audio; return audio.kind === 'fault' ? audio : undefined; });
      assert.match(fault.error, /ALSA open failed: configured capture device is busy/);
      assert.ok(fault.error.length <= 8192);
      assert.doesNotMatch(fault.error, /discarded-prefix|\u001b|\u0000/);
      assert.deepEqual(await readdir(fixture.profile.runtimeRoot), []);
    } finally { await controller.close(); }
  } finally { await fixture.dispose(); }
});

test('a healthy native child remains ready after writing more than the diagnostic capacity', async () => {
  const fixture = await desk();
  try {
    const executable = join(fixture.directory, 'verbose-native');
    await writeFile(executable, `#!/bin/sh\ni=0\nwhile [ "$i" -lt 128 ]; do printf '%s' '${'x'.repeat(1024)}' >&2; i=$((i + 1)); done\nexec '${fixture.profile.native.executable}' "$@"\n`, { mode: 0o700 });
    const controller = new PersistentDesk({ ...fixture.profile, native: { ...fixture.profile.native, executable } }, installedPackage().installed);
    try {
      controller.setAudio('on');
      await until(() => controller.snapshot().audio.kind === 'ready' ? true : undefined);
      assert.equal(controller.snapshot().audio.kind, 'ready');
    } finally { await controller.close(); }
  } finally { await fixture.dispose(); }
});

test('retirement proof follows actual ready host exit and stays scoped across replacements', async () => {
  const fixture = await desk();
  try {
    fixture.controller.setAudio('on');
    const first = await until(() => { const audio = fixture.controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; });
    const target = { attempt: first.attempt, hostEpoch: first.performance.hostEpoch };
    assert.equal(fixture.controller.confirmedRetirement(target), null);
    fixture.controller.setAudio('off');
    assert.equal(fixture.controller.snapshot().audio.kind, 'stopping');
    assert.equal(fixture.controller.confirmedRetirement(target), null, 'requested termination is not confirmed exit');
    await until(() => fixture.controller.snapshot().audio.kind === 'off' ? true : undefined);
    const proof = fixture.controller.confirmedRetirement(target);
    assert(proof);
    assert.deepEqual(proof.target, target);
    assert.equal(proof.serverEpoch, fixture.controller.snapshot().serverEpoch);
    assert.equal(proof.retirementDeskRevision, fixture.controller.snapshot().revision);
    fixture.controller.setAudio('on');
    const second = await until(() => { const audio = fixture.controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; });
    assert.equal(fixture.controller.confirmedRetirement({ attempt: second.attempt, hostEpoch: second.performance.hostEpoch }), null);
    assert.deepEqual(fixture.controller.confirmedRetirement(target), proof);
    assert.equal(fixture.controller.confirmedRetirement({ ...target, hostEpoch: second.performance.hostEpoch }), null);
  } finally { await fixture.dispose(); }
});

test('unknown launch, running child, cleanup failure and canceled startup cannot mint retirement proof', async () => {
  const { Effect } = await import('effect');
  const { target } = await import('./session-fixture.js');
  const fixture = await desk();
  try {
    for (const [index, child] of [
      { kind: 'pending' }, { kind: 'known', handle: { isRunning: Effect.succeed(true) } },
      { kind: 'known', handle: { isRunning: Effect.fail(new Error('Exit status unavailable')) } },
      { kind: 'not-requested' }, { kind: 'known', handle: { isRunning: Effect.succeed(false) } },
    ].entries()) {
      const attempt = { id: target.attempt, readyTarget: index < 3 ? target : undefined, abort: new AbortController(), done: Promise.resolve(), finish: 'off', stderr: Buffer.alloc(0), child };
      Reflect.set(fixture.controller, 'attempt', attempt);
      await Reflect.get(fixture.controller, 'finished').call(fixture.controller, attempt, 'Synthetic cleanup');
      assert.equal(fixture.controller.confirmedRetirement(target), null);
      Reflect.set(fixture.controller, 'attempt', undefined);
    }
  } finally { await fixture.dispose(); }
});

test('delayed old exit callback cannot retire or overwrite a replacement attempt', async () => {
  const { Effect } = await import('effect');
  const { target } = await import('./session-fixture.js');
  const fixture = await desk();
  let release!: (running: boolean) => void;
  const pending = new Promise<boolean>(resolve => { release = resolve; });
  const attempt = { id: target.attempt, readyTarget: target, abort: new AbortController(), done: Promise.resolve(), finish: 'off', stderr: Buffer.alloc(0),
    child: { kind: 'known', handle: { isRunning: Effect.promise(() => pending) } } };
  try {
    Reflect.set(fixture.controller, 'attempt', attempt);
    const finishing = Reflect.get(fixture.controller, 'finished').call(fixture.controller, attempt, 'Delayed cleanup');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fixture.controller.confirmedRetirement(target), null);
    const replacement = { ...attempt, readyTarget: undefined, child: { kind: 'pending' } };
    Reflect.set(fixture.controller, 'attempt', replacement);
    release(false); await finishing;
    assert.equal(Reflect.get(fixture.controller, 'attempt'), replacement);
    assert.equal(fixture.controller.confirmedRetirement(target), null);
  } finally { release(false); Reflect.set(fixture.controller, 'attempt', undefined); await fixture.dispose(); }
});

test('explicit Terminate of the actual old child retires an unknown original input intent', async () => {
  const { createGateway } = await import('../gateway.js');
  const { RemoteDesk } = await import('../../../ui/practice/remote-session.js');
  const { createMusicalInputProducer } = await import('../../../ui/practice/peripheral-input.js');
  const { Schema } = await import('effect');
  const fixture = await desk();
  const originalFetch = globalThis.fetch;
  const token = 'b'.repeat(32), origin = 'http://127.0.0.1:9999';
  let unknown = true;
  const controller = fixture.controller;
  const server = createGateway({ host: '127.0.0.1', port: 0, origin, token: Buffer.from(token), staticRoot: '.' }, {
    snapshot: () => controller.snapshot(), subscribe: listener => controller.subscribe(listener), setAudio: goal => controller.setAudio(goal),
    confirmedRetirement: target => controller.confirmedRetirement(target), close: () => controller.close(),
    async command(target, input) {
      const result = await controller.command(target, input);
      if (unknown && Schema.decodeUnknownSync(Schema.Struct({ command: Schema.String }))(input).command === 'inputAttach') {
        unknown = false; return { outcome: 'unknown' };
      }
      return result;
    },
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  globalThis.fetch = (input, init) => {
    const headers = new Headers(init?.headers); headers.set('origin', origin);
    return originalFetch(new URL(String(input), `http://127.0.0.1:${address.port}`), { ...init, headers });
  };
  let old: Awaited<ReturnType<typeof RemoteDesk.connect>> | undefined, next: Awaited<ReturnType<typeof RemoteDesk.connect>> | undefined;
  try {
    controller.setAudio('on');
    const initial = await until(() => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; });
    const target = { attempt: initial.attempt, hostEpoch: initial.performance.hostEpoch };
    old = await RemoteDesk.connect(token); void old.listen();
    await until(() => old?.connection.kind === 'connected' ? true : undefined);
    let selected = old;
    const producer = createMusicalInputProducer({ kind: 'pointer', releasedMask: 223, endpoint: async () => selected.performance() });
    await assert.rejects(producer.event(0, 0), /unknown/);
    await assert.rejects(producer.pause(), /cleanup is unconfirmed/);
    assert.equal(controller.snapshot().audio.kind, 'ready', 'readback cannot terminate or restart audio automatically');
    assert.equal(controller.confirmedRetirement(target), null);
    controller.setAudio('off');
    assert.equal(controller.confirmedRetirement(target), null);
    await until(() => controller.snapshot().audio.kind === 'off' ? true : undefined);
    const proof = controller.confirmedRetirement(target);
    assert(proof);
    await producer.pause();
    controller.setAudio('on');
    const replacement = await until(() => { const audio = controller.snapshot().audio; return audio.kind === 'ready' ? audio : undefined; });
    assert.notEqual(replacement.performance.hostEpoch, target.hostEpoch);
    next = await RemoteDesk.connect(token); selected = next; void next.listen();
    await until(() => next?.connection.kind === 'connected' ? true : undefined);
    producer.resume(); await producer.event(0, 0);
    assert.equal(next.performance().snapshot().inputRouting?.producers.some(value => value.kind === 'pointer'), true);
    assert.deepEqual(controller.confirmedRetirement(target), proof);
  } finally {
    await old?.dispose(); await next?.dispose();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    globalThis.fetch = originalFetch; await fixture.dispose();
  }
});

test('bounded process retirement cache makes pruned and missing scopes unknown', async () => {
  const { Effect, Schema } = await import('effect');
  const { NativeTargetSchema } = await import('../session-schema.js');
  const fixture = await desk();
  const targets = Array.from({ length: 129 }, (_, index) => Schema.decodeUnknownSync(NativeTargetSchema)({ attempt: `attempt-${index}`, hostEpoch: `host-${index}` }));
  try {
    for (const target of targets) {
      const attempt = { id: target.attempt, readyTarget: target, abort: new AbortController(), done: Promise.resolve(), finish: 'off', stderr: Buffer.alloc(0),
        child: { kind: 'known', handle: { isRunning: Effect.succeed(false) } } };
      Reflect.set(fixture.controller, 'attempt', attempt);
      await Reflect.get(fixture.controller, 'finished').call(fixture.controller, attempt, 'Confirmed synthetic exit');
    }
    assert.equal(fixture.controller.confirmedRetirement(targets[0]), null);
    assert(fixture.controller.confirmedRetirement(targets[1]));
    assert(fixture.controller.confirmedRetirement(targets[128]));
  } finally { Reflect.set(fixture.controller, 'attempt', undefined); await fixture.dispose(); }
});
