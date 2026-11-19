import { mkdtempSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const moduleRoot = join(root, 'lib/patches');
const artifacts = realpathSync(mkdtempSync(join(tmpdir(), 'show-tools-patches-')));
const nativeBuild = join(artifacts, 'native');

function run(command: string, args: readonly string[]) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, EM_CACHE: join(artifacts, 'emscripten-cache') },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed with status ${result.status}, signal ${result.signal}`);
}

run('cmake', ['-S', moduleRoot, '-B', nativeBuild, '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', nativeBuild, '--parallel', '4']);
const sources = readdirSync(join(moduleRoot, 'src'))
  .filter(name => name.endsWith('.cpp'))
  .sort()
  .map(name => join(moduleRoot, 'src', name));
for (const [target, source] of [
  ['patch_engine_tests', 'native_tests.cpp'],
  ['tribulations_guitar_tests', 'tribulations_guitar_tests.cpp'],
  ['shake_percussion_tests', 'shake_percussion_tests.cpp'],
]) {
  const nativeFixture = join(artifacts, `${target}-native.f32`);
  run(join(nativeBuild, target), ['--fixture', nativeFixture]);
  const wasmRunner = join(artifacts, `${target}.js`);
  run('em++', [
    '-O2', '-std=c++17', '-fno-exceptions', '-ffp-contract=off',
    '-I', join(moduleRoot, 'include'),
    ...sources, join(moduleRoot, 'tests', source),
    '-sENVIRONMENT=node', '-sNODERAWFS=1', '-sALLOW_MEMORY_GROWTH=0',
    '-sINITIAL_MEMORY=134217728', '-sSTACK_SIZE=1048576',
    '-o', wasmRunner,
  ]);
  const wasmFixture = join(artifacts, `${target}-wasm.f32`);
  run(process.execPath, [wasmRunner, '--fixture', wasmFixture]);

  const native = readFileSync(nativeFixture);
  const wasm = readFileSync(wasmFixture);
  if (native.length === 0 || native.length % 8 !== 0 || native.length !== wasm.length) {
    throw new Error(`Invalid stereo fixture lengths: native=${native.length}, wasm=${wasm.length}`);
  }
  let maximumError = 0;
  for (let offset = 0; offset < native.length; offset += 4) {
    const expected = native.readFloatLE(offset);
    const actual = wasm.readFloatLE(offset);
    if (!Number.isFinite(expected) || !Number.isFinite(actual)) throw new Error(`Nonfinite fixture at byte ${offset}`);
    const error = Math.abs(expected - actual);
    if (error > 1e-6) throw new Error(`PCM mismatch at sample ${offset / 4}: native=${expected}, wasm=${actual}`);
    maximumError = Math.max(maximumError, error);
  }
  process.stdout.write(`${target}: native/WASM PCM verified: ${native.length / 8} stereo frames, maximum absolute error ${maximumError}.\n`);
}
process.stdout.write(`Artifacts: ${artifacts}\n`);
