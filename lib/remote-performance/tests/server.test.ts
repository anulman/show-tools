import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { decodeSessionProfile } from '../session-profile.js';
import { serveProfile } from '../server.js';
import { decodeDeskBootstrap, decodeDeskPublication } from '../session-schema.js';
import { installedPackage, sessionProfile, until } from './session-fixture.js';
import { buildSessionBundles } from '../../../scripts/session-bundles.js';

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
  const songDirectory = profile.catalog.entries[0].path;
  await mkdir(songDirectory);
  await writeFile(join(songDirectory, 'manifest.json'), files.manifest);
  await writeFile(join(songDirectory, 'song.pfp'), files.packet);
  await writeFile(join(songDirectory, 'effects.json'), JSON.stringify(files.configurations));
  await writeFile(join(songDirectory, 'source.musicxml'), await readFile('songs/dance-yrself-clean.musicxml'));
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
    await until(() => {
      const audio = app.controller.snapshot().audio;
      return audio.kind === 'stopping' && audio.error?.includes('ownership is uncertain') ? true : undefined;
    });
    const replacement = await fetch(`${profile.origin}/api/audio`, { method: 'POST', headers, body: JSON.stringify({ sessionId: controlSession.sessionId, sequence: 2, goal: 'on' }) });
    assert.equal((await replacement.json()).outcome, 'rejected');
    assert.equal((await fetch(`${profile.origin}/api/status`, { headers })).status, 200);
    await assert.rejects(app.close(), /Native cleanup did not confirm exit/);
    assert.equal(app.server.listening, false);
    await assert.rejects(app.close(), /Native cleanup did not confirm exit/);
  } finally {
    app.server.closeAllConnections();
    if (app.server.listening) await new Promise<void>(done => app.server.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('killing the foreground server also releases its real owned fake native host', async () => {
  const { directory, profile, headers } = await fixture();
  await mkdir(join(directory, 'provenance'));
  await buildSessionBundles(resolve('.'), directory);
  const marker = join(directory, 'native-pid');
  const wrapper = join(directory, 'native-wrapper');
  await writeFile(wrapper, `#!/bin/sh\nprintf '%s' "$$" > '${marker}'\nexec '${profile.native.executable}' "$@"\n`, { mode: 0o700 });
  await chmod(wrapper, 0o700);
  const profilePath = join(directory, 'profile.json');
  await writeFile(profilePath, JSON.stringify({ ...profile, native: { ...profile.native, executable: wrapper } }));
  const parent = spawn(process.execPath, [await realpath(join(directory, 'gateway/server.mjs')), '--profile', profilePath], { stdio: 'ignore' });
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


test('failed listener startup can retry later and still publishes audio off without native acquisition', async () => {
  const { directory, profile, headers } = await fixture();
  const blocked = createServer();
  let app: Awaited<ReturnType<typeof serveProfile>> | undefined;
  const offProfile = { ...profile, native: { ...profile.native, executable: '/missing/native-host' } };
  try {
    blocked.listen(profile.port, profile.host); await once(blocked, 'listening');
    await assert.rejects(serveProfile(offProfile), { code: 'EADDRINUSE' });
    await assert.rejects(stat(profile.runtimeRoot), { code: 'ENOENT' });
    await new Promise<void>(resolve => blocked.close(() => resolve()));
    app = await serveProfile(offProfile);
    const bootstrap = decodeDeskBootstrap(await (await fetch(`${profile.origin}/api/session`, { headers })).json());
    assert.equal(bootstrap.view.audio.kind, 'off');
    await assert.rejects(stat(profile.runtimeRoot), { code: 'ENOENT' });
  } finally {
    if (blocked.listening) await new Promise<void>(resolve => blocked.close(() => resolve()));
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});


test('an unassigned configured listener address fails with EADDRNOTAVAIL before native acquisition', async () => {
  const { directory, profile } = await fixture();
  try {
    const assigned = new Set(Object.values(networkInterfaces()).flatMap(values => values?.map(value => value.address) ?? []));
    const unassigned = ['192.0.2.1', '198.51.100.1', '203.0.113.1'].find(value => !assigned.has(value));
    assert.ok(unassigned, 'fixture requires an unassigned documentation IPv4 address');
    const cert = join(directory, 'bind-test.crt'), key = join(directory, 'bind-test.key');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert,
      '-days', '1', '-subj', '/CN=unassigned.invalid'], { stdio: 'ignore' });
    await chmod(key, 0o600);
    await assert.rejects(serveProfile({ ...profile, host: unassigned, origin: `https://unassigned.invalid:${profile.port}`,
      tls: { cert, key }, native: { ...profile.native, executable: '/missing/native-host' } }), { code: 'EADDRNOTAVAIL' });
    await assert.rejects(stat(profile.runtimeRoot), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('installed catalog selects all three songs off-only and persists acknowledged canonical button bindings', async () => {
  const { directory, profile, headers } = await fixture();
  const [{ default: drunkGirls }, { default: tribulations }] = await Promise.all([import('../../../songs/drunk-girls.js'), import('../../../songs/tribulations.js')]);
  const entries = [profile.catalog.entries[0]];
  for (const song of [drunkGirls, tribulations]) {
    const path = join(directory, song.id); await mkdir(path);
    const files = installedPackage(song.compiled);
    await writeFile(join(path, 'manifest.json'), files.manifest);
    await writeFile(join(path, 'song.pfp'), files.packet);
    await writeFile(join(path, 'effects.json'), JSON.stringify(files.configurations));
    await writeFile(join(path, 'source.musicxml'), await readFile(`songs/${song.id}.musicxml`));
    entries.push({ id: song.id, path });
  }
  const configured = decodeSessionProfile({ ...profile, catalog: { ...profile.catalog, entries: [entries[0], ...entries.slice(1)] } });
  let app = await serveProfile(configured);
  try {
    const songs = await (await fetch(`${profile.origin}/api/songs`, { headers })).json();
    assert.deepEqual(songs.songs.map((value: { id: string }) => value.id), ['dance-yrself-clean', 'drunk-girls', 'tribulations']);
    assert.equal((await fetch(`${profile.origin}/api/songs`)).status, 401);
    const bootstrap = decodeDeskBootstrap(await (await fetch(`${profile.origin}/api/session`, { headers })).json());
    let sequence = 0;
    const post = async (route: string, body: object) => (await fetch(`${profile.origin}${route}`, { method: 'POST', headers,
      body: JSON.stringify({ sessionId: bootstrap.sessionId, sequence: ++sequence, ...body }) })).json();
    for (const songId of ['drunk-girls', 'tribulations', 'dance-yrself-clean']) {
      const selected = await post('/api/song', { songId, expectedRevision: app.controller.snapshot().revision });
      assert.equal(selected.outcome, 'accepted'); assert.equal(selected.view.song.id, songId); assert.equal(selected.view.audio.kind, 'off');
    }
    const before = app.controller.snapshot();
    const unknown = await post('/api/song', { songId: 'not-installed', expectedRevision: before.revision });
    assert.equal(unknown.outcome, 'rejected'); assert.equal(app.controller.snapshot(), before);
    const bindings = [{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['R1', 'R2'] } }, { controlId: 'yellow', target: { kind: 'cue-rows', rows: ['L1', 'L2'] } }];
    const saved = await post('/api/song-bindings', { songId: before.song.id, expectedRevision: before.revision, bindings });
    assert.equal(saved.outcome, 'accepted'); assert.deepEqual(saved.view.song.compiled.inputBindings, bindings);
    const stale = await post('/api/song-bindings', { songId: before.song.id, expectedRevision: before.revision, bindings: [] });
    assert.equal(stale.outcome, 'rejected'); assert.deepEqual(app.controller.snapshot().song.compiled?.inputBindings, bindings);
    const wrongSong = await post('/api/song-bindings', { songId: 'drunk-girls', expectedRevision: app.controller.snapshot().revision, bindings: [] });
    assert.equal(wrongSong.outcome, 'rejected');
    await app.close(); app = await serveProfile(configured);
    assert.deepEqual(app.controller.snapshot().song.compiled?.inputBindings, bindings, 'the next server reads the actual SQLite authoring record');
    assert.equal(app.controller.snapshot().audio.kind, 'off');
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});

test('configuration locks audio and selection, commits no data on failure, and checks SQLite revision before activation', async () => {
  const { Effect } = await import('effect');
  const { PersistentDesk } = await import('../controller.js');
  const { loadInstalledSongCatalog } = await import('../song-catalog.js');
  const { SongBindingAuthority, prepareSongBindings } = await import('../song-bindings.js');
  const { directory, profile } = await fixture();
  const catalog = await Effect.runPromise(loadInstalledSongCatalog(profile.catalog));
  const authority = SongBindingAuthority.open(profile.authoringDatabase);
  const entry = catalog.get(catalog.initialSongId);
  const controller = new PersistentDesk(profile, entry.installed, { catalog, bindings: authority });
  const source = join(profile.catalog.entries[0].path, 'source.musicxml');
  const original = await readFile(source);
  const bindings = [{ controlId: 'blue', target: { kind: 'tempo' } }];
  try {
    await writeFile(source, '<invalid/>');
    const failed = await controller.configureSongBindings(entry.id, controller.snapshot().revision, bindings);
    assert.equal(failed.outcome, 'rejected'); assert.equal(authority.read(entry).revision, 0);
    await rm(source); execFileSync('/usr/bin/mkfifo', [source]);
    const pending = controller.configureSongBindings(entry.id, controller.snapshot().revision, bindings);
    assert.equal(controller.setAudio('on').outcome, 'rejected');
    assert.equal((await controller.selectSong(entry.id, controller.snapshot().revision)).outcome, 'rejected');
    await writeFile(source, original); assert.equal((await pending).outcome, 'accepted');
    assert.equal(controller.snapshot().audio.kind, 'off');
    await rm(source); await writeFile(source, original);
    const prepared = await prepareSongBindings(entry, []);
    await rm(source); execFileSync('/usr/bin/mkfifo', [source]);
    const before = controller.snapshot();
    const conflict = controller.configureSongBindings(entry.id, before.revision, bindings);
    const other = SongBindingAuthority.open(profile.authoringDatabase);
    try { other.save(prepared, authority.read(entry).revision); } finally { other.close(); }
    await writeFile(source, original);
    assert.equal((await conflict).outcome, 'rejected'); assert.equal(controller.snapshot(), before, 'CAS failure cannot activate its prepared package');
    await rm(source); execFileSync('/usr/bin/mkfifo', [source]);
    const canceled = controller.configureSongBindings(entry.id, before.revision, bindings);
    const revisionBeforeClose = authority.read(entry).revision;
    const closing = controller.close();
    await writeFile(source, original);
    assert.equal((await canceled).outcome, 'rejected'); await closing;
    assert.equal(authority.read(entry).revision, revisionBeforeClose, 'shutdown before commit preserves authored bindings');
  } finally { await controller.close(); authority.close(); await rm(directory, { recursive: true, force: true }); }
});
