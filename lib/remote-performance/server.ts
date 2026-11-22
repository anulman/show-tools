import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, resolve, sep } from 'node:path';
import { createGateway } from './gateway.js';
import { PersistentDesk } from './controller.js';
import { SongBindingAuthority, prepareSongBindings } from './song-bindings.js';
import { loadInstalledSongCatalog, type InstalledSong } from './song-catalog.js';
import { ChartOverrides } from './chart-overrides.js';
import { Effect } from 'effect';
import { decodeSessionProfile, type SessionProfile } from './session-profile.js';

export async function serveProfile(input: SessionProfile) {
  const profile = decodeSessionProfile(input);
  const root = await realpath(profile.staticRoot);
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
  const chartChoices = new Map<string, Pick<InstalledSong, 'id' | 'title' | 'packageDigest'>>();
  let installed;
  try {
    const authored = bindings.read();
    for (const choice of catalog.choices) {
      const override = await charts.read(choice.id);
      if (override === undefined && choice.id !== catalog.initialSongId) continue;
      const prepared = await prepareSongBindings(catalog.get(choice.id), authored.bindings, override);
      if (choice.id === catalog.initialSongId) installed = prepared.installed;
      if (override !== undefined) chartChoices.set(choice.id, { id: choice.id, title: prepared.installed.song.chart.title, packageDigest: prepared.packageDigest });
    }
    if (!installed) throw new Error('Initial chart preparation did not produce a song');
  } catch (error) { bindings.close(); throw error; }
  const controller = new PersistentDesk(profile, installed, { catalog, bindings, charts, chartChoices });
  const server = createGateway({ host: profile.host, port: profile.port, origin: profile.origin,
    token: Buffer.from(tokenFile.toString('utf8').trim()), staticRoot: root, tls }, controller, {
      choices: () => controller.songChoices(), select: (id, expected) => controller.selectSong(id, expected),
      bindings: (expected, values) => controller.configureButtonBindings(expected, values),
      publishChart: (expected, xml) => controller.publishChart(xml, expected),
    });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(profile.port, profile.host, () => { server.removeListener('error', reject); resolve(); }); });
  } catch (error) { try { await controller.close(); } finally { bindings.close(); } throw error; }
  let shutdown: Promise<void> | undefined;
  return { server, controller, close() {
    return shutdown ??= (async () => {
      try { await controller.close(); } finally {
        bindings.close(); server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    })();
  } };
}
