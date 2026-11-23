import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { buildSongCatalog } from '../../../scripts/build-song-catalog.js';
import { test } from 'node:test';
import { readMusicXmlSong, writeMusicXmlSong } from '../../performance/musicxml-song.js';
import { DEFAULT_BUTTON_BINDINGS } from '../../performance/input-bindings.js';
import { serveProfile } from '../server.js';
import { decodeSessionProfile } from '../session-profile.js';
import { withPeripheralMaintenance } from '../../peripherals/maintenance.js';
import { sessionProfile, until } from './session-fixture.js';

const ids = ['dance-yrself-clean', 'drunk-girls', 'tribulations'];

test('packaged catalog supports named publication without disturbing the loaded desk', async () => {
  const root = await realpath(await mkdtemp('/tmp/named-chart-'));
  const reservation = createServer().listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const address = reservation.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  const origin = `http://127.0.0.1:${address.port}`;
  const config = sessionProfile(root);
  const peripheralProfile = join(root, 'peripheral.json');
  const profile = decodeSessionProfile({
    ...config, port: address.port, origin, peripheralProfile,
    catalog: { initialSongId: ids[0], entries: ids.map(id => ({ id, path: join(root, 'catalog', 'songs', id) })) },
  });
  const token = '00000000000000000000000000000000';
  const headers = { authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' };
  const get = async (path: string) => {
    const response = await fetch(origin + path, { headers });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return response.json();
  };
  const named = (id: string) => get(`/api/charts/${id}`);
  const put = (id: string, musicXml: string, expectedChartVersion: string) =>
    fetch(`${origin}/api/charts/${id}`, { method: 'PUT', headers, body: JSON.stringify({ musicXml, expectedChartVersion }) });
  let app: Awaited<ReturnType<typeof serveProfile>> | undefined;
  try {
    await buildSongCatalog({ schemaVersion: 1, initialSongId: ids[0],
      songs: ids.map(id => ({ id, musicXml: resolve('songs', id + '.musicxml') })) }, join(root, 'catalog'));
    await mkdir(profile.staticRoot);
    await writeFile(profile.tokenFile, token, { mode: 0o600 });
    await mkdir(profile.runtimeRoot, { mode: 0o700 });
    const capture = join(profile.runtimeRoot, 'demo-latest.wav');
    const take = Buffer.from('disposable take sentinel');
    await writeFile(capture, take, { mode: 0o600 });
    app = await serveProfile(profile);
    const before = await get('/api/status');
    const db = await readFile(profile.authoringDatabase);
    const original = await named(ids[1]);
    const untouched = await named(ids[2]);
    assert.equal((await fetch(`${origin}/api/charts/${ids[1]}`)).status, 401);
    assert.equal((await fetch(`${origin}/api/charts/unregistered`, { headers })).status, 404);
    assert.equal((await fetch(`${origin}/api/charts/${ids[1]}`, { method: 'PUT', headers: { ...headers, origin: 'https://example.invalid' } })).status, 403);
    const parsed = await readMusicXmlSong(original.musicXml);
    const rename = (title: string) => writeMusicXmlSong({ song: parsed.song, report: { ...parsed.report, title } });
    const [a, b] = await Promise.all([rename('Drunk Girls chart boundary A'), rename('Drunk Girls chart boundary B')]);
    await withPeripheralMaintenance(peripheralProfile, async () => {
      assert.equal((await put(ids[1], a, original.chartVersion)).status, 409);
      assert.deepEqual(await named(ids[1]), original);
    });
    const attempts = await Promise.all([put(ids[1], '\uFEFF' + a, original.chartVersion), put(ids[1], '\uFEFF' + b, original.chartVersion)]);
    assert.deepEqual(attempts.map(res => res.status).sort(), [200, 409]);
    const winner = await attempts.find(res => res.status === 200)!.json();
    assert.deepEqual(await named(ids[1]), winner);
    assert.deepEqual(await named(ids[2]), untouched);
    assert.equal((await put(ids[1], untouched.musicXml, winner.chartVersion)).status, 409);
    assert.deepEqual(await get('/api/status'), before);
    assert.deepEqual(await readFile(capture), take);
    assert.deepEqual(await readFile(profile.authoringDatabase), db);
    const preview = await get(`/api/songs/${ids[1]}`);
    assert.match(preview.song.chart.title, /^Drunk Girls chart boundary [AB]$/);
    assert.deepEqual(preview.defaultVoiceEffects[4]?.effects, [{ kind: 'slapback', delayMs: 100, feedback: 0, wet: .25 }]);
    const session = await get('/api/session');
    const post = async (route: string, sequence: number, expectedRevision: string, fields: object) => {
      const response = await fetch(origin + route, { method: 'POST', headers, body: JSON.stringify({
        sessionId: session.sessionId, sequence, expectedRevision, ...fields,
      }) });
      assert.equal(response.status, 200);
      return response.json();
    };
    const result = await post('/api/song', 1, session.view.revision, { songId: ids[1] });
    assert.equal(result.outcome, 'accepted');
    assert.equal(result.view.song.chart.title, preview.song.chart.title);
    assert.equal(result.view.audio.kind, 'off');
    assert.equal(result.view.serverEpoch, before.serverEpoch);
    const sameSongXml = await rename('Drunk Girls next load');
    const saved = await put(ids[1], sameSongXml, winner.chartVersion);
    assert.equal(saved.status, 200);
    const current = await saved.json();
    assert.deepEqual(await get('/api/status'), result.view);
    const oldWriter = await post('/api/chart', 2, result.view.revision, { musicXml: winner.musicXml });
    assert.equal(oldWriter.outcome, 'rejected');
    assert.deepEqual(await named(ids[1]), current);
    const rebound = await post('/api/button-bindings', 3, result.view.revision, { bindings: DEFAULT_BUTTON_BINDINGS });
    assert.equal(rebound.outcome, 'accepted');
    assert.equal(rebound.view.song.chart.title, preview.song.chart.title);
    assert.deepEqual(await named(ids[1]), current);
    const reloaded = await post('/api/song', 4, rebound.view.revision, { songId: ids[1] });
    assert.equal(reloaded.outcome, 'accepted');
    assert.equal(reloaded.view.song.chart.title, 'Drunk Girls next load');
    const controller = app.controller;
    assert.equal(controller.setAudio('on').outcome, 'accepted');
    const performance = () => {
      const audio = controller.snapshot().audio;
      return audio.kind === 'ready' ? audio : undefined;
    };
    const ready = await until(performance, () => JSON.stringify(controller.snapshot().audio));
    const target = { attempt: ready.attempt, hostEpoch: ready.performance.hostEpoch };
    assert.equal((await controller.command(target, { command: 'start',
      args: { bpm: 144, countInBars: 0, startBar: 1, endBar: 8, loop: true } })).outcome, 'applied');
    const playing = await until(() => {
      const now = performance();
      return now?.performance.state.phase === 'playing' ? now : undefined;
    });
    const duringPlayback = await rename('Drunk Girls future load');
    const published = await put(ids[1], duringPlayback, current.chartVersion);
    assert.equal(published.status, 200);
    const after = performance();
    assert(after);
    assert.equal(after.attempt, playing.attempt);
    assert.equal(after.performance.hostEpoch, playing.performance.hostEpoch);
    assert.equal(after.performance.state.runId, playing.performance.state.runId);
    assert.equal(after.performance.state.phase, 'playing');
    assert.equal(controller.snapshot().song.chart.title, 'Drunk Girls next load');
    const latest = await published.json();
    await app.close();
    app = await serveProfile(profile);
    assert.deepEqual(await named(ids[1]), latest);
    assert.equal((await get(`/api/songs/${ids[1]}`)).song.chart.title, 'Drunk Girls future load');
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});
