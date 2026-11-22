import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { decodePeripheralInputMap, runPeripheralBridge, type PeripheralDevice } from '../../peripherals/bridge.js';
import type { HelperInput } from '../../peripherals/browser-protocol.js';
import { PF as LIGHT } from '../../performance/light-abi.js';
import { DEFAULT_BUTTON_BINDINGS, decodeInputBindings } from '../../performance/input-bindings.js';
import type { LiveEffectDefinition, VoiceEffectConfiguration } from '../../performance/model.js';
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
    assert.deepEqual(bootstrap.view.defaultVoiceEffects, installedPackage().configurations);
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

test('installed catalog switches all three songs while stopped without replacing the native host and persists button bindings', async () => {
  const { directory, profile, headers } = await fixture();
  const [{ default: drunkGirls }, { default: tribulations }] = await Promise.all([import('../../../songs/drunk-girls.js'), import('../../../songs/tribulations.js')]);
  const entries = [profile.catalog.entries[0]];
  const dry = installedPackage().configurations;
  const defaults = new Map<string, readonly VoiceEffectConfiguration[]>([['dance-yrself-clean', dry]]);
  const songs = [
    [drunkGirls, { kind: 'chorus', rateHz: 1.2, depthMs: 4.5, baseDelayMs: 28, wet: 0.6 }],
    [tribulations, { kind: 'slapback', delayMs: 121, feedback: 0.15, wet: 0.2 }],
  ] satisfies readonly [typeof drunkGirls | typeof tribulations, LiveEffectDefinition][];
  for (const [song, effect] of songs) {
    const path = join(directory, song.id); await mkdir(path);
    const configurations = dry.map(configuration => configuration.profile === 4 ? { ...configuration, effects: [effect] } : configuration);
    defaults.set(song.id, configurations);
    const files = installedPackage(song.compiled, configurations);
    await writeFile(join(path, 'manifest.json'), files.manifest);
    await writeFile(join(path, 'song.pfp'), files.packet);
    await writeFile(join(path, 'effects.json'), JSON.stringify(files.configurations));
    await writeFile(join(path, 'source.musicxml'), await readFile(`songs/${song.id}.musicxml`));
    entries.push({ id: song.id, path });
  }
  const configured = decodeSessionProfile({ ...profile, catalog: { ...profile.catalog, entries: [entries[0], ...entries.slice(1)] } });
  let app = await serveProfile(configured);
  const abort = new AbortController();
  let bridge: Promise<void> | undefined;
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
      assert.deepEqual(selected.view.song.compiled.inputBindings, DEFAULT_BUTTON_BINDINGS);
      assert.deepEqual(selected.view.defaultVoiceEffects, defaults.get(songId), 'Standby publishes the newly selected package defaults');
      if (songId === 'drunk-girls') {
        assert.equal(selected.view.song.compiled.authoredCues, undefined);
        assert.equal(selected.view.song.compiled.playbackPairs.length, 41);
        assert.ok(app.controller.snapshot().song.compiled?.authoredCues?.some(cell => cell.actions.some(action => action.operation === 'pp')));
        const status = await (await fetch(`${profile.origin}/api/status`, { headers })).json();
        assert.deepEqual(status.song.compiled, selected.view.song.compiled);
        const fresh = decodeDeskBootstrap(await (await fetch(`${profile.origin}/api/session`, { headers })).json());
        const events = await fetch(`${profile.origin}/api/events`, { headers: { ...headers, 'X-Session-Id': fresh.sessionId } });
        const reader = events.body!.pipeThrough(new TextDecoderStream()).getReader();
        try {
          let data = '';
          while (!data.includes('\n\n')) {
            const chunk = await reader.read();
            assert.equal(chunk.done, false);
            data += chunk.value;
          }
          const publication = JSON.parse(data.split('\n')[0].slice(6));
          assert.equal(publication.type, 'desk');
          assert.deepEqual(publication.view.song.compiled, fresh.view.song.compiled);
          assert.equal(publication.view.song.compiled.authoredCues, undefined);
        } finally { await reader.cancel(); }
      }
    }
    await assert.rejects(stat(profile.runtimeRoot), { code: 'ENOENT' });
    const before = app.controller.snapshot();
    const unknown = await post('/api/song', { songId: 'not-installed', expectedRevision: before.revision });
    assert.equal(unknown.outcome, 'rejected'); assert.equal(app.controller.snapshot(), before);
    const bindings = decodeInputBindings([{ controlId: 'blue', target: { kind: 'cue-rows', rows: ['L1', 'L2'] } }, { controlId: 'yellow', target: { kind: 'cue-rows', rows: ['R1', 'R2'] } }]);
    const saved = await post('/api/button-bindings', { expectedRevision: before.revision, bindings });
    assert.equal(saved.outcome, 'accepted'); assert.deepEqual(saved.view.song.compiled.inputBindings, bindings);
    const stale = await post('/api/button-bindings', { expectedRevision: before.revision, bindings: [] });
    assert.equal(stale.outcome, 'rejected'); assert.deepEqual(app.controller.snapshot().song.compiled?.inputBindings, bindings);
    await post('/api/audio', { goal: 'on' });
    const ready = await until(() => {
      const view = app.controller.snapshot();
      return view.audio.kind === 'ready' ? { view, audio: view.audio } : undefined;
    });
    const target = { attempt: ready.audio.attempt, hostEpoch: ready.audio.performance.hostEpoch };
    const bindingGeneration = ready.audio.performance.state.inputRouting?.bindingGeneration;
    assert.ok(bindingGeneration);
    const command = (command: string, args: object) => post('/api/command', { target, command, args });
    const inputMap = decodePeripheralInputMap({
      sources: [
        { kind: 'linux', id: 'keys', interfaceNumber: 2, eventTypes: [0, 1], keyCodes: [41], relativeAxes: [] },
        { kind: 'linux', id: 'motion', interfaceNumber: 3, eventTypes: [0, 2], keyCodes: [], relativeAxes: [1] },
      ],
      switches: [{ controlId: 'blue', sourceId: 'keys', type: 1, code: 41 }],
      axis: { sourceId: 'motion', type: 2, code: 1 }, leds: [], confirmWiring: false,
    });
    let emitInput: ((event: HelperInput) => void) | undefined;
    let bridgeFailure: unknown;
    let binds = 0;
    let lightImage: number[] = [];
    const device: PeripheralDevice = {
      session: 1,
      snapshot: () => ({ type: 'ready', session: 1, version: 2, switches: [{ controlId: 'blue', state: 'released' }] }),
      subscribe: listener => { emitInput = listener; return () => { emitInput = undefined; }; },
      bind: () => { binds++; return '1 1 1 1'; },
      write: line => {
        if (!line.startsWith('light ')) return;
        const next = line.split(' ').slice(5).map(Number);
        if (lightImage.length) {
          assert.ok(next[LIGHT.LIGHT_SEQUENCE] >= lightImage[LIGHT.LIGHT_SEQUENCE], 'the I-PAC delivery fence rejects earlier light images');
          if (next[LIGHT.LIGHT_SEQUENCE] === lightImage[LIGHT.LIGHT_SEQUENCE]) assert.deepEqual(next, lightImage);
        }
        lightImage = next;
      },
      close: async () => {},
    };
    bridge = runPeripheralBridge({ version: 2, origin: profile.origin, tokenFile: profile.tokenFile, helperExecutable: '/unused/helpers/IPAC',
      inputMap, bindingRevision: 1, jiggle: { minimumTravel: 8, minimumReversal: 3 } }, abort.signal, device)
      .catch(error => { bridgeFailure = error; });
    const performance = () => {
      if (bridgeFailure) throw bridgeFailure;
      const audio = app.controller.snapshot().audio;
      assert.equal(audio.kind, 'ready', 'song switching leaves the original audio connection running');
      return audio.performance.state;
    };
    const producer = () => performance().inputRouting?.producers[0];
    const attached = await until(() => lightImage.length ? producer() : undefined);
    let observationSequence = 0;
    const button = async (down: boolean) => {
      assert.ok(emitInput, 'the original physical helper is still relaying');
      emitInput({ type: 'button', controlId: 'blue', session: device.session, sequence: ++observationSequence, down });
      return until(() => producer()?.lastSequence === observationSequence ? true : undefined, 'native did not acknowledge the physical observation');
    };
    assert.equal((await command('start', { bpm: 240, startBar: 1, endBar: 4, countInBars: 1 })).outcome, 'applied');
    await until(() => performance().recording ? true : undefined, 'DYC opening recording did not start');
    assert.equal((await command('stop', {})).outcome, 'applied');
    await button(true);
    let previous = app.controller.snapshot();
    for (const songId of ['tribulations', 'drunk-girls', 'dance-yrself-clean']) {
      await until(() => app.controller.snapshot().revision !== previous.revision ? true : undefined);
      const selected = await post('/api/song', { songId, expectedRevision: previous.revision });
      assert.equal(selected.outcome, 'accepted', JSON.stringify(selected.error));
      assert.equal(selected.view.song.id, songId);
      assert.deepEqual(selected.view.song.compiled.inputBindings, bindings, 'the same saved assignments are sent with every song');
      assert.equal(selected.view.audio.kind, 'ready');
      assert.equal(selected.view.audio.attempt, target.attempt);
      assert.equal(selected.view.audio.performance.hostEpoch, target.hostEpoch);
      assert.equal(selected.view.audio.performance.state.phase, 'idle');
      const routing = selected.view.audio.performance.state.inputRouting;
      assert.equal(routing?.bindingGeneration, bindingGeneration, 'switching songs with the same binding table preserves the connected board');
      assert.equal(routing?.producers[0]?.session, attached.session);
      assert.equal(routing?.producers[0]?.heldMask, 1, 'holding a button through selection preserves its release barrier');
      assert.equal(routing?.producers[0]?.lastSequence, observationSequence);
      assert.equal(binds, 1, 'all songs use the same continuous peripheral bridge and LED binding');
      if (songId === 'tribulations') {
        const strum = tribulations.compiled?.takes.findIndex(take => take.id === 'tribulations/guitar/take-1');
        assert.ok(strum !== undefined && strum >= 0);
        assert.equal((await command('start', { bpm: 240, startBar: 14, endBar: 21, countInBars: 0 })).outcome, 'applied');
        assert.equal((await command('configureJiggle', { minimumTravel: 8, minimumReversal: 3 })).outcome, 'applied',
          'the board’s calibrated thresholds survive replacement');
        await until(() => performance().bar === 18 ? true : undefined);
        assert.equal(performance().compiledTakes?.[strum]?.ready, true, 'the real Tribulations chart recorded its guitar take');
        await button(true);
        assert.equal(performance().compiledTakes?.[strum]?.playback, 'idle', 'holding through selection does not launch a new-song cue');
        await button(false);
        await button(true);
        await until(() => performance().compiledTakes?.[strum]?.playback === 'playing' ? true : undefined,
          'the fresh board press did not launch the written Tribulations guitar cue');
        assert.equal((await command('stop', {})).outcome, 'applied');
      } else {
        await button(false);
        await button(true);
      }
      const expected = defaults.get(songId);
      assert.deepEqual(selected.view.defaultVoiceEffects, expected);
      assert.deepEqual(selected.view.audio.performance.state.voiceEffects.map(({ profile, effects }: VoiceEffectConfiguration) => ({ profile, effects })), expected);
      assert.notEqual(selected.view.audio.performance.state.runId, previous.audio.kind === 'ready' && previous.audio.performance.state.runId);
      const staleSelection = await post('/api/song', { songId, expectedRevision: previous.revision });
      assert.equal(staleSelection.outcome, 'rejected');
      previous = app.controller.snapshot();
    }
    assert.equal((await app.controller.command(target, { command: 'start', args: {} })).outcome, 'applied');
    const whilePlaying = await post('/api/song', { songId: 'tribulations', expectedRevision: app.controller.snapshot().revision });
    assert.equal(whilePlaying.outcome, 'rejected');
    assert.match(whilePlaying.error, /Stop practice/);
    assert.equal((await app.controller.command(target, { command: 'stop', args: {} })).outcome, 'applied');
    abort.abort();
    await bridge;
    assert.equal(bridgeFailure, undefined);
    await until(() => performance().inputRouting?.producers.length === 0 ? true : undefined, 'closing the original bridge revokes its retained native lease');
    await app.close(); app = await serveProfile(configured);
    assert.deepEqual(app.controller.snapshot().song.compiled?.inputBindings, bindings, 'the next server reads the actual SQLite authoring record');
    assert.equal(app.controller.snapshot().audio.kind, 'off');
  } finally {
    abort.abort();
    await bridge;
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
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
  const bindings = decodeInputBindings([{ controlId: 'blue', target: { kind: 'tempo' } }]);
  try {
    await writeFile(source, '<invalid/>');
    const failed = await controller.configureButtonBindings(controller.snapshot().revision, bindings);
    assert.equal(failed.outcome, 'rejected'); assert.equal(authority.read().revision, 0);
    await rm(source); execFileSync('/usr/bin/mkfifo', [source]);
    const pending = controller.configureButtonBindings(controller.snapshot().revision, bindings);
    assert.equal(controller.setAudio('on').outcome, 'rejected');
    assert.equal((await controller.selectSong(entry.id, controller.snapshot().revision)).outcome, 'rejected');
    await writeFile(source, original); assert.equal((await pending).outcome, 'accepted');
    assert.equal(controller.snapshot().audio.kind, 'off');
    await rm(source); await writeFile(source, original);
    const prepared = await prepareSongBindings(entry, []);
    await rm(source); execFileSync('/usr/bin/mkfifo', [source]);
    const before = controller.snapshot();
    const conflict = controller.configureButtonBindings(before.revision, bindings);
    const other = SongBindingAuthority.open(profile.authoringDatabase);
    try { other.save(prepared.bindings, authority.read().revision); } finally { other.close(); }
    await writeFile(source, original);
    assert.equal((await conflict).outcome, 'rejected'); assert.equal(controller.snapshot(), before, 'CAS failure cannot activate its prepared package');
    await rm(source); execFileSync('/usr/bin/mkfifo', [source]);
    const canceled = controller.configureButtonBindings(before.revision, bindings);
    const revisionBeforeClose = authority.read().revision;
    const closing = controller.close();
    await writeFile(source, original);
    assert.equal((await canceled).outcome, 'rejected'); await closing;
    assert.equal(authority.read().revision, revisionBeforeClose, 'shutdown before commit preserves authored bindings');
  } finally { await controller.close(); authority.close(); await rm(directory, { recursive: true, force: true }); }
});

test('authoring database cannot be created inside the public static root', async () => {
  const { directory, profile } = await fixture();
  const database = join(profile.staticRoot, 'private.sqlite');
  try { await assert.rejects(serveProfile({ ...profile, authoringDatabase: database }), /outside the static root/); await assert.rejects(stat(database)); }
  finally { await rm(directory, { recursive: true, force: true }); }
});
