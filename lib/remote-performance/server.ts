import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { createGateway } from './gateway.js';
import { PersistentDesk } from './controller.js';
import { SongBindingAuthority, prepareSongBindings } from './song-bindings.js';
import { loadInstalledSongCatalog } from './song-catalog.js';
import { ChartOverrides } from './chart-overrides.js';
import { peripheralConfigurationDirectory } from '../peripherals/maintenance.js';
import { Effect } from 'effect';
import { decodeSessionProfile, type SessionProfile } from './session-profile.js';
import type { SongPreview } from './session-schema.js';
import { validateRecordingArchive } from './recording-archive.js';

export async function serveProfile(input: SessionProfile) {
  const decoded = decodeSessionProfile(input);
  const root = await realpath(decoded.staticRoot);
  const archive = await validateRecordingArchive(decoded, root);
  const profile = archive ? { ...decoded, recordingArchiveRoot: archive } : decoded;
  if (profile.peripheralProfile) await peripheralConfigurationDirectory(profile.peripheralProfile);
  const privateFile = async (path: string) => {
    const actual = await realpath(path);
    const info = await stat(actual);
    if (actual === root || actual.startsWith(root + sep)) throw new Error('Secrets must be outside the static root');
    if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) throw new Error('Secret files must be caller-owned and private');
    return readFile(actual);
  };
  const runtime = resolve(profile.runtimeRoot);
  if (runtime === root || runtime.startsWith(root + sep)) throw new Error('Runtime root must be outside the static root');
  const [tokenFile, catalog, tls] = await Promise.all([
    privateFile(profile.tokenFile), Effect.runPromise(loadInstalledSongCatalog(profile.catalog)),
    profile.tls ? Promise.all([readFile(profile.tls.cert), privateFile(profile.tls.key)]).then(([cert, key]) => ({ cert, key })) : undefined,
  ]);
  const database = resolve(await realpath(dirname(profile.authoringDatabase)), basename(profile.authoringDatabase));
  if (database === root || database.startsWith(root + sep)) throw new Error('Authoring database must be outside the static root');
  const chartDirectory = database + '.charts';
  if (chartDirectory === root || chartDirectory.startsWith(root + sep)) throw new Error('Charts must be outside the static root');
  const charts = new ChartOverrides(chartDirectory);
  const bindings = SongBindingAuthority.open(database);
  const chartPreviews = new Map<string, SongPreview>();
  let initial;
  try {
    const authored = bindings.read();
    for (const choice of catalog.choices) {
      const override = await charts.read(choice.id);
      if (override === undefined && choice.id !== catalog.initialSongId) continue;
      const prepared = await prepareSongBindings(catalog.get(choice.id), authored.bindings, override);
      if (choice.id === catalog.initialSongId) initial = prepared;
      if (override !== undefined) chartPreviews.set(choice.id, {
        song: prepared.installed.song, defaultVoiceEffects: prepared.installed.defaultVoiceEffects, packageDigest: prepared.packageDigest,
      });
    }
    if (!initial) throw new Error('Initial chart preparation did not produce a song');
  } catch (error) { bindings.close(); throw error; }
  const controller = new PersistentDesk(profile, initial.installed, { catalog, bindings, charts, chartPreviews, initialChart: initial.chart });
  const server = createGateway({ host: profile.host, port: profile.port, origin: profile.origin,
    token: Buffer.from(tokenFile.toString('utf8').trim()), staticRoot: root, tls, ...(profile.peripheralProfile ? { peripheralProfile: profile.peripheralProfile } : {}) }, controller, {
      choices: () => controller.songChoices(), preview: id => controller.songPreview(id),
      select: (id, expected) => controller.selectSong(id, expected),
      bindings: (expected, values) => controller.configureButtonBindings(expected, values),
      publishChart: (expected, xml) => controller.publishChart(xml, expected),
      readChart: id => controller.readChart(id),
      publishInstalledChart: (id, xml, expected) => controller.publishInstalledChart(id, xml, expected),
    });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(profile.port, profile.host, () => { server.removeListener('error', reject); resolve(); }); });
  } catch (error) { try { await controller.close(); } finally { bindings.close(); } throw error; }
  controller.recordingArchive?.startRetention();
  let shutdown: Promise<void> | undefined;
  return { server, controller, close() {
    return shutdown ??= (async () => {
      try { await controller.close(); } finally {
        bindings.close(); server.closeAllConnections();
        await controller.recordingArchive?.stopRetention();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    })();
  } };
}
