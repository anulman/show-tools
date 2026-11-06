import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createGateway } from './gateway.js';
import { PersistentDesk } from './controller.js';
import { validateInstalledPackage } from './prepare.js';
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
  const [tokenFile, manifest, packet, effects, tls] = await Promise.all([
    privateFile(profile.tokenFile), readFile(profile.package.manifest), readFile(profile.package.packet), readFile(profile.package.effects, 'utf8'),
    profile.tls ? Promise.all([readFile(profile.tls.cert), privateFile(profile.tls.key)]).then(([cert, key]) => ({ cert, key })) : undefined,
  ]);
  const installed = validateInstalledPackage(manifest, packet, JSON.parse(effects));
  const controller = new PersistentDesk(profile, installed);
  const server = createGateway({ host: profile.host, port: profile.port, origin: profile.origin,
    token: Buffer.from(tokenFile.toString('utf8').trim()), staticRoot: root, tls }, controller);
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(profile.port, profile.host, () => { server.removeListener('error', reject); resolve(); }); });
  } catch (error) { await controller.close(); throw error; }
  let shutdown: Promise<void> | undefined;
  return { server, controller, close() {
    return shutdown ??= (async () => {
      try { await controller.close(); } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      }
    })();
  } };
}
