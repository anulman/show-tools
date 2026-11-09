import { Schema } from 'effect';
import { execFileSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { artifactHash, PERIPHERAL_ARTIFACT_FILES, PERIPHERAL_FLAGS, PERIPHERAL_INPUTS, PERIPHERAL_LICENSES } from './peripheral-artifact.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string' }, compiler: { type: 'string', default: 'zig' } } });
if (!values.out) throw new Error('Usage: build-peripheral-artifact --out NEW_DIRECTORY [--compiler ZIG]');
if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) throw new Error('Commit source before building a peripheral artifact');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const compiler = `Zig ${execFileSync(values.compiler, ['version'], { encoding: 'utf8' }).trim()}`;
const environment = execFileSync(values.compiler, ['env'], { encoding: 'utf8' });
const libraryPath = /^\s*\.lib_dir = ("[^"\r\n]+"),$/m.exec(environment);
if (!libraryPath) throw new Error('Cannot locate the Zig runtime library directory');
const libraryDirectory = Schema.decodeUnknownSync(Schema.NonEmptyString)(JSON.parse(libraryPath[1]));
let zigLicense: Buffer | undefined;
for (const path of [resolve(libraryDirectory, '..', 'LICENSE'), resolve(libraryDirectory, '../..', 'LICENSE')]) {
  try { zigLicense = await readFile(path); break; }
  catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error; }
}
if (!zigLicense) throw new Error('Cannot locate the Zig distribution license');
const target = 'x86_64-linux-musl';
const flags = PERIPHERAL_FLAGS;
const output = resolve(values.out);
await mkdir(output);
execFileSync(values.compiler, ['c++', '-target', target, ...flags, '-Ilib/peripherals/include', '-Ilib/peripherals/host', '-Ilib/performance/include',
  ...PERIPHERAL_INPUTS.filter(path => path.endsWith('.cpp')), '-o', join(output, 'peripheral-host')], { cwd: root, stdio: 'inherit' });
await chmod(join(output, 'peripheral-host'), 0o755);
const sourceFiles = Object.fromEntries(await Promise.all(PERIPHERAL_INPUTS.map(async path => [path, artifactHash(await readFile(join(root, path)))])));
await writeFile(join(output, 'source-revision.txt'), sourceRevision + '\n');
await writeFile(join(output, 'compiler.txt'), compiler + '\n');
await writeFile(join(output, 'ZIG-LICENSE'), zigLicense);
for (const [name, path] of Object.entries(PERIPHERAL_LICENSES)) await writeFile(join(output, name), await readFile(join(libraryDirectory, path)));
await writeFile(join(output, 'build.json'), JSON.stringify({ schemaVersion: 1, sourceRevision, target, compiler, flags, sourceFiles }, null, 2) + '\n');
const sums = await Promise.all(PERIPHERAL_ARTIFACT_FILES.map(async name => `${artifactHash(await readFile(join(output, name)))}  ${name}\n`));
await writeFile(join(output, 'SHA256SUMS'), sums.join(''));
process.stdout.write(JSON.stringify({ directory: output, sourceRevision, executableStarted: false }) + '\n');
