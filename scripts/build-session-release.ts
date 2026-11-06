import { buildSessionBundles } from './session-bundles.js';
import { Schema } from 'effect';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmod, cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { validateInstalledPackage } from '../lib/remote-performance/prepare.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const required = Schema.NonEmptyString;
const revisionString = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const options = Schema.decodeUnknownSync(Schema.Struct({
  'native-artifact': required, 'node-runtime': required, 'song-package': required, out: required,
  'reviewed-revision': Schema.optionalKey(revisionString),
}))(parseArgs({ options: { 'native-artifact': { type: 'string' }, 'node-runtime': { type: 'string' },
  'song-package': { type: 'string' }, out: { type: 'string' }, 'reviewed-revision': { type: 'string' } } }).values);
const native = resolve(options['native-artifact']);
const runtime = resolve(options['node-runtime']);
const song = resolve(options['song-package']);
const output = resolve(options.out);
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');
const assertCommittedSource = () => {
  if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit or remove source changes before building a release');
};
assertCommittedSource();
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (basename(output) !== `show-tools-session-release-${sourceRevision.slice(0, 7)}`) throw new Error('Output directory must identify the exact source revision');
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const commitIdentity = (revision: string) => ({ revision: git('rev-parse', '--verify', `${revision}^{commit}`),
  tree: git('rev-parse', '--verify', `${revision}^{tree}`), parents: git('show', '--no-patch', '--format=%P', revision).split(' ').filter(Boolean) });
const sourceIdentity = commitIdentity(sourceRevision);
const reviewedIdentity = commitIdentity(options['reviewed-revision'] ?? sourceRevision);
if (sourceIdentity.tree !== reviewedIdentity.tree) throw new Error('Reviewed revision and release source have different trees');
const nativeRevision = Schema.decodeUnknownSync(revisionString)((await readFile(join(native, 'source-revision.txt'), 'utf8')).trim());
execFileSync('git', ['diff', '--exit-code', nativeRevision, sourceRevision, '--', 'lib/native-host', 'lib/native-alsa',
  'lib/performance', 'lib/sequencer', 'lib/sampler', 'lib/beat-tracker', 'lib/patches'], { cwd: root, stdio: 'pipe' });
const nativeFiles: string[] = [];
for (const line of (await readFile(join(native, 'SHA256SUMS'), 'utf8')).trim().split('\n')) {
  const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
  if (!match || sha256(await readFile(join(native, match[2]))) !== match[1]) throw new Error('Native artifact checksum mismatch');
  nativeFiles.push(match[2]);
}
const nativeBytes = await readFile(join(native, 'native_alsa_host'));
if (nativeBytes.length < 20 || nativeBytes.readUInt32BE(0) !== 0x7f454c46 || nativeBytes[4] !== 2 || nativeBytes[5] !== 1 || nativeBytes.readUInt16LE(18) !== 62) throw new Error('Expected a Linux x86-64 ELF native host');
const nodeBytes = await readFile(join(runtime, 'bin/node'));
if (sha256(nodeBytes) !== '94efd062ed066c1a0b332e18249859c905e920eeada5df55d24c99b919629a90') throw new Error('Expected the reviewed official Node22.23.4 Linux x64 executable');
validateInstalledPackage(await readFile(join(song, 'manifest.json')), await readFile(join(song, 'song.pfp')),
  JSON.parse(await readFile(join(song, 'effects.json'), 'utf8')));
await mkdir(output);
execFileSync('bash', ['lib/beat-tracker/scripts/build-manual-wasm.sh'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, ['--import', 'tsx', 'scripts/build-ui.ts'], { cwd: root, stdio: 'inherit' });
assertCommittedSource();
await Promise.all([
  mkdir(join(output, 'native')), mkdir(join(output, 'song')),
  cp(join(root, 'dist'), join(output, 'static'), { recursive: true }),
  mkdir(join(output, 'gateway')), mkdir(join(output, 'runtime')), mkdir(join(output, 'bin')),
  mkdir(join(output, 'provenance')), mkdir(join(output, 'licenses')),
]);
for (const name of [...nativeFiles, 'SHA256SUMS']) await cp(join(native, name), join(output, 'native', name));
for (const name of ['manifest.json', 'song.pfp', 'effects.json']) await cp(join(song, name), join(output, 'song', name));
await writeFile(join(output, 'runtime/node'), nodeBytes, { mode: 0o755 });
await chmod(join(output, 'native/native_alsa_host'), 0o755);
await cp(join(runtime, 'LICENSE'), join(output, 'runtime/NODE-LICENSE'));
await cp(join(root, 'package-lock.json'), join(output, 'provenance/package-lock.json'));
await cp(join(root, 'docs/implementation/session-cli.md'), join(output, 'provenance/session-cli.md'));
for (const name of ['manual-clock-build.json', 'manual-clock-compiler.txt']) await cp(join(root, 'ui/practice/wasm', name), join(output, 'provenance', name));
await buildSessionBundles(root, output);
const tracked = new Set(git('ls-files', '-z').split('\0').filter(Boolean));
const reviewSources = new Set(git('ls-files', '-z', '--', 'lib/remote-performance', 'lib/native-host', 'lib/native-alsa',
  'lib/performance', 'lib/sequencer', 'lib/sampler', 'lib/beat-tracker', 'lib/patches', 'scripts/build-session-release.ts',
  'scripts/session-bundles.ts', 'scripts/stage-session-release.py', 'scripts/tests/stage-session-release.test.py',
  'scripts/build-ui.ts', 'scripts/generate-sampler-abi.ts', 'scripts/wasm-exports.ts', '.github/workflows/native-host.yml',
  'package.json', 'package-lock.json').split('\0').filter(Boolean));
for (const name of ['server.mjs', 'session-cli.mjs', 'prepare.mjs']) {
  const inputs = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
    JSON.parse(await readFile(join(output, 'provenance', `${name}.inputs.json`), 'utf8')));
  for (const path of Object.keys(inputs)) if (!path.split('/').includes('node_modules')) {
    if (!tracked.has(path)) throw new Error(`Bundle contains an untracked first-party input: ${path}`);
    reviewSources.add(path);
  }
}
for (const path of [...reviewSources].sort()) {
  const destination = join(output, 'provenance/source', path);
  await mkdir(dirname(destination), { recursive: true });
  await cp(join(root, path), destination);
}
await writeFile(join(output, 'provenance/source.json'), JSON.stringify({ schemaVersion: 1, source: sourceIdentity,
  reviewed: reviewedIdentity, native: commitIdentity(nativeRevision), nativeSourcesEquivalent: true,
  build: { nodeVersion: process.version, platform: process.platform, arch: process.arch },
  runtime: { nodeVersion: '22.23.4', nodeExecutableSha256: sha256(nodeBytes) },
  files: [...reviewSources].sort() }, null, 2));
await writeFile(join(output, 'bin/show-tools-session'), '#!/bin/sh\nset -eu\nST_RELEASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$ST_RELEASE/runtime/node" "$ST_RELEASE/gateway/session-cli.mjs" "$@"\n', { mode: 0o755 });
const LockedPackages = Schema.Struct({ packages: Schema.Record(Schema.String, Schema.Struct({
  version: Schema.optionalKey(Schema.String), dev: Schema.optionalKey(Schema.Boolean),
})) });
const lock = Schema.decodeUnknownSync(LockedPackages)(JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8')));
const PackageIdentity = Schema.Struct({ name: Schema.String, version: Schema.String, license: Schema.optionalKey(Schema.Unknown) });
for (const [path, expected] of Object.entries(lock.packages)) {
  if (!path || expected.dev || !expected.version) continue;
  const directory = join(root, path);
  const identity = Schema.decodeUnknownSync(PackageIdentity)(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')));
  if (identity.version !== expected.version) throw new Error(`Dependency version mismatch: ${path}`);
  const destination = join(output, 'licenses', path.replaceAll('/', '__'));
  await mkdir(destination);
  await writeFile(join(destination, 'package.json'), JSON.stringify(identity, null, 2));
  for (const entry of await readdir(directory, { withFileTypes: true })) if (entry.isFile() && /^(licen[cs]e|notice|copying)/i.test(entry.name)) await cp(join(directory, entry.name), join(destination, entry.name));
}
const files: { path: string; bytes: number; sha256: string }[] = [];
async function collect(directory: string, relative = '') {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name), name = relative ? `${relative}/${entry.name}` : entry.name;
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) throw new Error(`Release contains a symlink: ${name}`);
    if (metadata.isDirectory()) await collect(path, name);
    else if (metadata.isFile()) { const bytes = await readFile(path); files.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) }); }
    else throw new Error(`Unsupported release member: ${name}`);
  }
}
await collect(output);
await writeFile(join(output, 'release.json'), JSON.stringify({ schemaVersion: 1, sourceRevision, nativeRevision,
  nodeVersion: '22.23.4', platform: 'linux-x64', totalFileBytes: files.reduce((sum, file) => sum + file.bytes, 0), files }, null, 2));
await writeFile(join(output, 'SHA256SUMS'), [...files.map(file => `${file.sha256}  ${file.path}`),
  `${sha256(await readFile(join(output, 'release.json')))}  release.json`].join('\n') + '\n');
const archive = `${output}.tar.gz`;
execFileSync('tar', ['-czf', archive, '-C', dirname(output), output.slice(dirname(output).length + 1)], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
await writeFile(`${archive}.sha256`, `${sha256(await readFile(archive))}  ${archive.slice(dirname(archive).length + 1)}\n`);
process.stdout.write(JSON.stringify({ directory: output, archive, sourceRevision, files: files.length }) + '\n');
