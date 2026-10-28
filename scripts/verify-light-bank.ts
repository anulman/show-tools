import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
if (process.argv[2] === '--wasm-fixture') {
  const { WASI } = await import('node:wasi');
  const wasi = new WASI({ version: 'preview1', args: [], env: {}, returnOnExit: true });
  const { instance } = await WebAssembly.instantiate(readFileSync(process.argv[3]), {
    wasi_snapshot_preview1: wasi.wasiImport,
  });
  const code = wasi.start(instance);
  if (code !== 0) throw new Error(`WASM light-bank fixture exited ${code}`);
} else {
  const artifacts = realpathSync(mkdtempSync(join(tmpdir(), 'show-tools-light-bank-')));
  const sources = ['lib/performance/src/performance_lights.cpp', 'lib/peripherals/src/peripheral_lights.cpp',
    'lib/performance/tests/light_bank_tests.cpp'];
  const flags = ['-std=c++17', '-O2', '-Ilib/performance/src', '-Ilib/peripherals/include'];
  function run(command: string, args: readonly string[]) {
    return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, EM_CACHE: process.env.EM_CACHE ?? join(artifacts, 'emscripten-cache') } });
  }

  const native = join(artifacts, 'native');
  run('c++', [...flags, ...sources, '-o', native]);
  const nativeResult = run(native, []);
  const wasm = join(artifacts, 'bank.wasm');
  run('em++', [...flags, ...sources, '-sSTANDALONE_WASM=1', '-sALLOW_MEMORY_GROWTH=0', '-o', wasm]);
  const wasmResult = run(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--wasm-fixture', wasm]);
  if (nativeResult !== wasmResult) throw new Error('Native and WASM light-bank fixtures disagree');
  run(process.execPath, ['--import', 'tsx', '--test', 'lib/performance/tests/lights.test.ts', 'scripts/tests/sampler-abi.test.ts']);
  process.stdout.write(`${nativeResult}Native/WASM domain and TypeScript boundary checks passed. Artifacts: ${artifacts}\n`);
}
