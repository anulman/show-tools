import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, chmod, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { decodePeripheralBridgeConfig, decodePeripheralInputMap } from '../bridge.js';
import { decodeSessionProfile } from '../../remote-performance/session-profile.js';
import { renderPeripheralUnit } from '../service-unit.js';

const options = parseArgs({ options: {
  release: { type: 'string' }, 'source-revision': { type: 'string' }, out: { type: 'string' },
  'installer-source-revision': { type: 'string' }, 'web-profile': { type: 'string' }, 'web-source-revision': { type: 'string' },
  'input-map': { type: 'string' }, 'waiting-configuration': { type: 'boolean' },
  'disable-jiggle': { type: 'boolean' }, 'jiggle-travel': { type: 'string' }, 'jiggle-reversal': { type: 'string' },
} }).values;
function revision(value: string | undefined) {
  if (!value || !/^[a-f0-9]{40}$/.test(value)) throw new Error('An explicit full source revision is required');
  return value;
}
if (options['waiting-configuration'] && [options['input-map'], options['disable-jiggle'], options['jiggle-travel'], options['jiggle-reversal'], options['web-profile'], options['web-source-revision']].some(value => value !== undefined)) throw new Error('--waiting-configuration cannot be combined with profile, map or jiggle options');
const source = revision(options['source-revision']);
if (!options.release || !options.out) throw new Error('--release and --out NEW_DIRECTORY are required');
const release = resolve(options.release);
const releaseRoot = '/home/anulman/.local/share/show-tools/releases';
const destination = `${releaseRoot}/session-${source.slice(0, 7)}`;
const profilePath = '/home/anulman/.config/show-tools/peripheral.json';
const unitName = 'show-tools-peripheral.service';
let inputMap: ReturnType<typeof decodePeripheralInputMap> | undefined;
if (options['input-map']) {
  const metadata = await stat(options['input-map']);
  if (!metadata.isFile() || metadata.size > 16384) throw new Error('Input map must be a JSON file of at most 16 KiB');
  inputMap = decodePeripheralInputMap(JSON.parse(await readFile(options['input-map'], 'utf8')));
  if (inputMap.sources.some(source => source.kind !== 'linux')) throw new Error('EliteDesk requires observed Linux source selectors');
}
const fields = { version: 2, origin: 'https://proxmox.tail54fc55.ts.net:8443', connectAddress: '100.93.139.99', tokenFile: '/home/anulman/.config/show-tools/credentials/token', helperExecutable: `${destination}/native/peripheral/peripheral-host`, bindingRevision: 1, ...(inputMap === undefined ? {} : { inputMap }) };
const hasThreshold = options['jiggle-travel'] !== undefined || options['jiggle-reversal'] !== undefined;
if (options['disable-jiggle'] && hasThreshold) throw new Error('--disable-jiggle cannot be combined with thresholds');
if (hasThreshold && (options['jiggle-travel'] === undefined || options['jiggle-reversal'] === undefined)) throw new Error('Both explicit jiggle thresholds are required');
let jiggle: { minimumTravel: number; minimumReversal: number } | null | undefined;
if (options['disable-jiggle']) jiggle = null;
else if (hasThreshold) {
  for (const key of ['jiggle-travel', 'jiggle-reversal'] as const) if (!/^[1-9][0-9]{0,4}$/.test(options[key]!)) throw new Error('Explicit integer jiggle thresholds required');
  jiggle = { minimumTravel: Number(options['jiggle-travel']), minimumReversal: Number(options['jiggle-reversal']) };
}
const unit = renderPeripheralUnit(`${destination}/bin/show-tools-peripheral`, profilePath);
const sha = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex');
const base = dirname(fileURLToPath(import.meta.url));
const releasePins: Record<string, string> = {};
for (const name of ['release.json', 'runtime/node', 'bin/show-tools-peripheral', 'gateway/peripheral-cli.mjs', 'native/peripheral/peripheral-host', 'bin/show-tools-session', 'gateway/session-cli.mjs']) releasePins[name] = sha(await readFile(join(release, name)));
const info = JSON.parse(await readFile(join(release, 'release.json'), 'utf8'));
if (info.sourceRevision !== source) throw new Error('Wrong peripheral release source');
const out = resolve(options.out);
await mkdir(out, { mode: 0o700 });
await cp(join(base, 'install.py'), join(out, 'install.py'));
await chmod(join(out, 'install.py'), 0o600);
await writeFile(join(out, unitName), unit, { mode: 0o600, flag: 'wx' });
if (options['waiting-configuration']) {
  const installerSource = revision(options['installer-source-revision']);
  const repository = fileURLToPath(new URL('../../../', import.meta.url));
  const reviewedInstaller = execFileSync('git', ['show', `${installerSource}:lib/peripherals/operator-service/install.py`], { cwd: repository, stdio: 'pipe' });
  if (sha(reviewedInstaller) !== sha(await readFile(join(out, 'install.py')))) throw new Error('Standalone installer does not match its explicit source revision');
  const sourcePath = 'lib/peripherals/bridge-cli.ts';
  const waitingSource = await readFile(new URL('../bridge-cli.ts', import.meta.url));
  const committedSource = execFileSync('git', ['show', `${source}:${sourcePath}`], { cwd: repository, stdio: 'pipe' });
  const releasedSource = await readFile(join(release, 'provenance/source', sourcePath));
  if (sha(waitingSource) !== sha(committedSource) || sha(releasedSource) !== sha(waitingSource)) throw new Error('Waiting CLI source differs from the reviewed missing-configuration implementation');
  releasePins[`provenance/source/${sourcePath}`] = sha(releasedSource);
  const manifest = { schemaVersion: 3, mode: 'waiting-configuration', sourceRevision: source, installerSourceRevision: installerSource, waitingCliSourceSha256: sha(waitingSource), files: { 'install.py': sha(await readFile(join(out, 'install.py'))), [unitName]: sha(unit) }, releaseFiles: releasePins };
  await writeFile(join(out, 'README.txt'), 'Run OPERATOR-COMMAND.txt locally as anulman on proxmox, without sudo. This installs, enables and starts only show-tools-peripheral.service with no peripheral.json. The service waits for foreground setup without opening USB or audio. Existing configuration is refused. No token is read and no audio or LED command is sent. Later foreground setup explicitly creates the configuration. The existing web service, audio engine and host grants are unchanged.\n', { mode: 0o600, flag: 'wx' });
  await publishPacket(manifest, installerSource);
} else if (!options['installer-source-revision'] || !options['web-profile'] || !options['web-source-revision'] || jiggle === undefined || inputMap === undefined) {
  await writeFile(join(out, 'profile-fields.proposal.json'), JSON.stringify({ ...fields, ...(jiggle !== undefined ? { jiggle } : {}) }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  await writeFile(join(out, 'pending.json'), JSON.stringify({ ready: false, missing: ['observed installation map via --input-map FILE', 'explicit jiggle object or --disable-jiggle', 'exact reviewed installed web profile and its independent source revision', 'explicit standalone installer source revision'], releaseSource: source, releasePins }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ ready: false, out, activationCommand: null }) + '\n');
} else {
  const installerSource = revision(options['installer-source-revision']);
  const reviewedInstaller = execFileSync('git', ['show', `${installerSource}:lib/peripherals/operator-service/install.py`], { cwd: fileURLToPath(new URL('../../../', import.meta.url)), stdio: 'pipe' });
  if (sha(reviewedInstaller) !== sha(await readFile(join(out, 'install.py')))) throw new Error('Standalone installer does not match its explicit source revision');
  const profile = decodePeripheralBridgeConfig({ ...fields, jiggle });
  const profileData = JSON.stringify(profile, null, 2) + '\n';
  const webSource = revision(options['web-source-revision']);
  const webDestination = `${releaseRoot}/session-${webSource.slice(0, 7)}`;
  const webData = await readFile(options['web-profile']);
  const web = decodeSessionProfile(JSON.parse(webData.toString('utf8')));
  if (web.serviceName !== 'show-tools-web.service' || web.origin !== fields.origin || web.connectAddress !== fields.connectAddress || web.tokenFile !== fields.tokenFile || web.caFile !== undefined || web.server.nodeExecutable !== `${webDestination}/runtime/node` || web.server.entrypoint !== `${webDestination}/gateway/server.mjs`) throw new Error('Reviewed web profile differs from its separate source/target/TLS contract');
  await writeFile(join(out, 'profile.json'), profileData, { mode: 0o600, flag: 'wx' });
  const manifest = { schemaVersion: 2, sourceRevision: source, webSourceRevision: webSource, installerSourceRevision: installerSource, webProfileSha256: sha(webData), files: { 'install.py': sha(await readFile(join(out, 'install.py'))), 'profile.json': sha(profileData), [unitName]: sha(unit) }, releaseFiles: releasePins };
  await publishPacket(manifest, installerSource);
}

async function publishPacket(manifest: { files: Record<string, string>; webSourceRevision?: string }, installerSource: string) {
  const manifestData = JSON.stringify(manifest, null, 2) + '\n';
  await writeFile(join(out, 'manifest.json'), manifestData, { mode: 0o600, flag: 'wx' });
  const stage = `/home/anulman/.local/share/show-tools/staging/peripheral-service-${source.slice(0, 7)}-${installerSource.slice(0, 7)}`;
  const sourcePin = manifest.files['install.py'];
  const command = `/usr/bin/env -i HOME=/home/anulman USER=anulman LOGNAME=anulman PATH=/usr/bin:/bin XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus /usr/bin/python3 -I -c 'import hashlib; p="${stage}/install.py"; b=open(p,"rb").read(65537); assert len(b)<=65536 and hashlib.sha256(b).hexdigest()=="${sourcePin}"; __file__=p; exec(compile(b,p,"exec"))' --manifest-sha256 ${sha(manifestData)} --activate`;
  const commandData = command + '\n';
  await writeFile(join(out, 'OPERATOR-COMMAND.txt'), commandData, { mode: 0o600, flag: 'wx' });
  const reference = { schemaVersion: 1, applicationSourceRevision: source, installerSourceRevision: installerSource, manifestSha256: sha(manifestData), command: { path: `${stage}/OPERATOR-COMMAND.txt`, bytes: Buffer.byteLength(commandData, 'utf8'), sha256: sha(commandData) } };
  await writeFile(join(out, 'BOOTSTRAP-REFERENCE.json'), JSON.stringify(reference, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  process.stdout.write(JSON.stringify({ ready: true, out, sourceRevision: source, ...(manifest.webSourceRevision === undefined ? {} : { webSourceRevision: manifest.webSourceRevision }), installerSourceRevision: installerSource, manifestSha256: sha(manifestData), installerSha256: sourcePin }) + '\n');
}
