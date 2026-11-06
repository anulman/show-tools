import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { serveProfile } from '../server.js';
import { decodeDeskBootstrap, decodeDeskPublication } from '../session-schema.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'server-'));
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const address = reservation.address(); assert(address && typeof address !== 'string');
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const port = address.port;
  const profile = { ...sessionProfile(directory), port, origin: `http://127.0.0.1:${port}` };
  const files = installedPackage();
  await mkdir(profile.staticRoot);
  await writeFile(join(profile.staticRoot, 'index.html'), '<title>Desk</title>');
  await writeFile(profile.tokenFile, '0123456789abcdef0123456789abcdef', { mode: 0o600 });
  await writeFile(profile.package.manifest, files.manifest);
  await writeFile(profile.package.packet, files.packet);
  await writeFile(profile.package.effects, JSON.stringify(files.configurations));
  const headers = { authorization: 'Bearer 0123456789abcdef0123456789abcdef', origin: profile.origin, 'content-type': 'application/json' };
  return { directory, profile, headers };
}

test('profile server starts off without native executable and SSE bootstraps the desk', async () => {
  const { directory, profile, headers } = await fixture();
  const app = await serveProfile({ ...profile, native: { ...profile.native, executable: '/missing/native-host' } });
  try {
    const bootstrap = decodeDeskBootstrap(await (await fetch(`${profile.origin}/api/session`, { headers })).json());
    assert.equal(bootstrap.view.audio.kind, 'off');
    assert.equal(bootstrap.view.song.id, 'dance-yrself-clean');
    await assert.rejects(stat(profile.runtimeRoot));
    await symlink(profile.tokenFile, join(profile.staticRoot, 'secret.txt'));
    assert.equal((await fetch(`${profile.origin}/secret.txt`)).status, 404);
    const events = await fetch(`${profile.origin}/api/events`, { headers: { ...headers, 'x-session-id': bootstrap.sessionId } });
    const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
    let data = '';
    while (!data.includes('\n\n')) data += (await reader.read()).value;
    assert.equal(decodeDeskPublication(JSON.parse(data.slice(6))).type, 'desk');
    await reader.cancel();
    const controlSession = decodeDeskBootstrap(await (await fetch(`${profile.origin}/api/session`, { headers })).json());
    const result = await fetch(`${profile.origin}/api/audio`, { method: 'POST', headers, body: JSON.stringify({ sessionId: controlSession.sessionId, sequence: 1, goal: 'on' }) });
    assert.equal((await result.json()).outcome, 'accepted');
    await until(() => app.controller.snapshot().audio.kind === 'fault' ? true : undefined);
    assert.equal((await fetch(`${profile.origin}/api/status`, { headers })).status, 200);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('killing the foreground server also releases its real owned fake native host', async () => {
  const { directory, profile, headers } = await fixture();
  const marker = join(directory, 'native-pid');
  const wrapper = join(directory, 'native-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nprintf '%s' "$$" > '${marker}'\nexec '${profile.native.executable}' "$@"\n`, { mode: 0o700 });
  await chmod(wrapper, 0o700);
  const profilePath = join(directory, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ ...profile, native: { ...profile.native, executable: wrapper } }));
  const parent = spawn(process.execPath, ['--import', 'tsx', resolve('lib/remote-performance/server.ts'), '--profile', profilePath], { stdio: 'ignore' });
  let nativePid: number | undefined;
  try {
    for (let count = 0; ; count++) {
      try { if ((await fetch(`${profile.origin}/api/status`, { headers })).ok) break; } catch {}
      if (count > 300 || parent.exitCode !== null) throw new Error('Server did not become ready');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const bootstrap = decodeDeskBootstrap(await (await fetch(`${profile.origin}/api/session`, { headers })).json());
    assert.equal(bootstrap.view.audio.kind, 'off');
    await fetch(`${profile.origin}/api/audio`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: 1, goal: 'on' }) });
    for (let count = 0; ; count++) {
      const status = await (await fetch(`${profile.origin}/api/status`, { headers })).json();
      if (status.audio.kind === 'ready') { assert.equal(status.audio.performance.state.phase, 'idle'); break; }
      if (count > 300 || status.audio.kind === 'fault') throw new Error(JSON.stringify(status.audio));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    nativePid = Number(await readFile(marker, 'utf8'));
    process.kill(nativePid, 'SIGTERM');
    for (let count = 0; ; count++) {
      const status = await (await fetch(`${profile.origin}/api/status`, { headers })).json();
      if (status.audio.kind === 'fault') break;
      if (count > 300) throw new Error('Native failure did not settle to fault');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.throws(() => process.kill(nativePid!, 0));
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal((await (await fetch(`${profile.origin}/api/status`, { headers })).json()).audio.kind, 'fault');
    await fetch(`${profile.origin}/api/audio`, { method: 'POST', headers, body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: 2, goal: 'on' }) });
    for (let count = 0; ; count++) {
      const status = await (await fetch(`${profile.origin}/api/status`, { headers })).json();
      if (status.audio.kind === 'ready') break;
      if (count > 300 || status.audio.kind === 'fault') throw new Error('Explicit restart failed');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    nativePid = Number(await readFile(marker, 'utf8'));
    parent.kill('SIGKILL'); await once(parent, 'exit');
    await until(() => { try { process.kill(nativePid!, 0); return undefined; } catch { return true; } }, 'Native host survived server crash');
  } finally {
    parent.kill('SIGKILL');
    if (nativePid) { try { process.kill(nativePid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  }
});
