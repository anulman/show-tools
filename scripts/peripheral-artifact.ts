import { Schema } from 'effect';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

export const PERIPHERAL_INPUTS = [
  'lib/peripherals/host/linux_host.cpp', 'lib/peripherals/host/linux_runtime.cpp',
  'lib/peripherals/host/linux_runtime.h', 'lib/peripherals/host/linux_order.h',
  'lib/peripherals/host/linux_input_map.h',
  'lib/peripherals/host/control_stream.cpp', 'lib/peripherals/host/control_stream.h',
  'lib/peripherals/src/peripheral_controls.cpp', 'lib/peripherals/src/peripheral_lights.cpp',
  'lib/peripherals/src/peripheral_light_delivery.cpp', 'lib/peripherals/include/peripheral_controls.h',
  'lib/peripherals/include/peripheral_light_delivery.h', 'lib/peripherals/include/peripheral_lights.h',
  'lib/performance/include/performance_light_output.h',
];
export const PERIPHERAL_LICENSES = {
  'MUSL-COPYRIGHT': 'libc/musl/COPYRIGHT', 'LIBCXX-LICENSE': 'libcxx/LICENSE.TXT',
  'LIBCXXABI-LICENSE': 'libcxxabi/LICENSE.TXT', 'LIBUNWIND-LICENSE': 'libunwind/LICENSE.TXT',
};
export const PERIPHERAL_ARTIFACT_FILES = ['peripheral-host', 'source-revision.txt', 'compiler.txt', 'build.json', 'ZIG-LICENSE', ...Object.keys(PERIPHERAL_LICENSES)];
export const PERIPHERAL_FLAGS = ['-std=c++17', '-static', '-O2', '-DNDEBUG'];
const revision = Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/));
const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const PeripheralBuildSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1), sourceRevision: revision,
  target: Schema.Literal('x86_64-linux-musl'), compiler: Schema.NonEmptyString,
  flags: Schema.Array(Schema.String), sourceFiles: Schema.Record(Schema.String, digest),
});
export const artifactHash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export async function readPeripheralArtifact(root: string, directory: string) {
  const names = [...PERIPHERAL_ARTIFACT_FILES, 'SHA256SUMS'].sort();
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(names)) throw new Error('Unexpected peripheral artifact file set');
  const bytes = new Map<string, Buffer>();
  for (const name of names) {
    const path = join(directory, name), info = await lstat(path);
    if (!info.isFile() || info.nlink !== 1 || info.size > 64 * 1024 * 1024) throw new Error('Peripheral artifact must contain bounded regular single-link files');
    bytes.set(name, await readFile(path));
  }
  const required = (name: string) => {
    const value = bytes.get(name);
    if (!value) throw new Error(`Missing peripheral artifact file: ${name}`);
    return value;
  };
  const checksums = new Map<string, string>();
  for (const line of required('SHA256SUMS').toString().trim().split('\n')) {
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || checksums.has(match[2])) throw new Error('Invalid peripheral artifact checksum list');
    checksums.set(match[2], match[1]);
  }
  if (checksums.size !== PERIPHERAL_ARTIFACT_FILES.length || PERIPHERAL_ARTIFACT_FILES.some(name => checksums.get(name) !== artifactHash(required(name))))
    throw new Error('Peripheral artifact checksum mismatch');
  const build = Schema.decodeUnknownSync(PeripheralBuildSchema, { onExcessProperty: 'error' })(JSON.parse(required('build.json').toString()));
  const sourceRevision = Schema.decodeUnknownSync(revision)(required('source-revision.txt').toString().trim());
  if (sourceRevision !== build.sourceRevision || required('compiler.txt').toString().trim() !== build.compiler)
    throw new Error('Peripheral artifact provenance mismatch');
  if (JSON.stringify(build.flags) !== JSON.stringify(PERIPHERAL_FLAGS)) throw new Error('Peripheral compiler flags mismatch');
  if (JSON.stringify(Object.keys(build.sourceFiles).sort()) !== JSON.stringify([...PERIPHERAL_INPUTS].sort()))
    throw new Error('Peripheral artifact source input set mismatch');
  execFileSync('git', ['diff', '--exit-code', sourceRevision, 'HEAD', '--', 'lib/peripherals', 'lib/performance/include/performance_light_output.h'], { cwd: root, stdio: 'pipe' });
  for (const path of PERIPHERAL_INPUTS) {
    const committed = execFileSync('git', ['show', `${sourceRevision}:${path}`], { cwd: root });
    if (artifactHash(committed) !== build.sourceFiles[path] || artifactHash(await readFile(join(root, path))) !== build.sourceFiles[path])
      throw new Error(`Peripheral artifact source input mismatch: ${path}`);
  }
  const executable = required('peripheral-host');
  if (executable.length < 20 || executable.readUInt32BE(0) !== 0x7f454c46 || executable[4] !== 2 || executable[5] !== 1 || executable.readUInt16LE(18) !== 62)
    throw new Error('Expected a Linux x86-64 peripheral executable');
  return { sourceRevision, build, files: bytes, executable };
}
