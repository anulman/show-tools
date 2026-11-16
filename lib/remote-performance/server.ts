import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createGateway } from './gateway.js';
import { PersistentDesk } from './controller.js';
import { SongBindingAuthority, prepareSongBindings } from './song-bindings.js';
import { loadInstalledSongCatalog } from './song-catalog.js';
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
  const bindings = SongBindingAuthority.open(profile.authoringDatabase);
  let installed;
  try { const initial = catalog.get(catalog.initialSongId), authored = bindings.read(initial);
    installed = authored.revision ? (await prepareSongBindings(initial, authored.bindings)).installed : initial.installed;
  } catch (error) { bindings.close(); throw error; }
  const controller = new PersistentDesk(profile, installed, { catalog, bindings });
  const server = createGateway({ host: profile.host, port: profile.port, origin: profile.origin,
    token: Buffer.from(tokenFile.toString('utf8').trim()), staticRoot: root, tls }, controller, {
      choices: () => controller.songChoices(), select: (id, expected) => controller.selectSong(id, expected),
      bindings: (id, expected, values) => controller.configureSongBindings(id, expected, values),
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
