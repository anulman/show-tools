import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WASI } from 'node:wasi';

const source = fileURLToPath(new URL('..', import.meta.url));
const build = resolve(process.argv[2] ?? `${source}/build`);
if (process.argv.length > 3) throw new Error('Usage: node --import tsx lib/peripherals/scripts/verify.ts [build-directory]');
mkdirSync(build, { recursive: true });

function run(command: string, args: string[], capture = false): string {
  const result = spawnSync(command, args, {
    encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit',
    env: { ...process.env, EM_CACHE: `${build}/emscripten-cache` },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr ?? ''}`);
  return result.stdout ?? '';
}

run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build', build, '--parallel']);
run('ctest', ['--test-dir', build, '--output-on-failure']);
run('em++', ['-O2', '-std=c++17', '-DPP_WASM_CASES', `-I${source}/include`, `-I${source}/../performance/include`,
  `${source}/src/peripheral_controls.cpp`, `${source}/src/peripheral_lights.cpp`, `${source}/src/peripheral_light_delivery.cpp`,
  `${source}/tests/core_cases.cpp`, `${source}/tests/delivery_cases.cpp`, '--no-entry',
  '-sSTANDALONE_WASM=1', '-sALLOW_MEMORY_GROWTH=0', '-sINITIAL_MEMORY=16777216',
  '-sEXPORTED_FUNCTIONS=["_pp_run_cases","_pp_case_value","_pp_create","_pp_destroy","_pp_begin","_pp_key","_pp_rotate","_pp_pattern_value","_pp_trigger_value","_pp_abi_version","_pp_ipac_led_report","_pp_ipac_led_descriptor","_pp_light_off","_pp_light_on","_pp_light_pulse","_pp_light_blink","_pp_light_evaluate","_pp_light_delivery_create","_pp_light_delivery_destroy","_pp_light_delivery_bind","_pp_light_delivery_prepare","_pp_light_delivery_commit"]',
  '-o', `${build}/peripheral-controls.wasm`]);

const parsed: unknown = JSON.parse(run(`${build}/peripheral_controls_tests`, [], true));
if (!Array.isArray(parsed)) throw new Error('Native fixture output must be an array');
const native: number[] = [];
for (const value of parsed) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid native fixture value');
  native.push(value);
}
const wasi = new WASI({ version: 'preview1', args: [], env: {}, preopens: {}, returnOnExit: true });
const { instance } = await WebAssembly.instantiate(readFileSync(`${build}/peripheral-controls.wasm`), {
  wasi_snapshot_preview1: wasi.wasiImport,
});
wasi.initialize(instance);
function call(name: string, ...args: number[]): number {
  const method = instance.exports[name];
  if (typeof method !== 'function') throw new Error(`Missing WASM export ${name}`);
  const result: unknown = method(...args);
  if (typeof result !== 'number') throw new Error(`${name} did not return a number`);
  return result;
}
for (const name of ['pp_light_off', 'pp_light_on', 'pp_light_pulse', 'pp_light_blink', 'pp_light_evaluate',
  'pp_light_delivery_create', 'pp_light_delivery_destroy', 'pp_light_delivery_bind', 'pp_light_delivery_prepare', 'pp_light_delivery_commit']) {
  assert.equal(typeof instance.exports[name], 'function', `Missing peripheral light export ${name}`);
}
assert.equal(call('pp_abi_version'), 1);
assert.equal(call('pp_run_cases'), native.length);
for (let index = 0; index < native.length; index++) {
  const wasm = call('pp_case_value', index);
  assert.ok(Math.abs(native[index] - wasm) <= 1e-12, `native/WASM mismatch at ${index}: ${native[index]} != ${wasm}`);
}
console.log(`Native/WASM agreement on ${native.length} control, light, and LED-encoder observations. No devices opened.`);
run(process.execPath, ['--import', 'tsx', '--test', `${source}/tests/capture.test.ts`]);
