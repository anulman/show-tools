import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import coverage from './coverage.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../', import.meta.url));
assert.equal(process.argv.length, 2, 'Run without arguments; redirect stdout to retain the receipt.');
const output = await mkdtemp(join(tmpdir(), 'show-tools-physical-controls-'));
const source = join(output, 'source');
const project = join(output, 'project');
const build = join(output, 'build');
const expected = { status: 'PASS', heldPairs: 4096, physicalControls: 6, outputLayouts: 2,
  mappingOrders: 24, levelAssignments: 256, deliveryCases: 12288, baselineWitnesses: 1 };
const logFiles: string[] = [];

async function sourceHashes() {
  const result: Record<string, string> = {};
  for (const [path, hash] of Object.entries(coverage.files)) {
    const actual = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
    assert.equal(actual, hash, `SOURCE_DRIFT: ${path}. Review the finite domain and source correspondence before refreshing coverage.json.`);
    result[path] = actual;
  }
  return result;
}
async function run(name: string, command: string, args: string[]) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000, env: { ...process.env, CMAKE_BUILD_PARALLEL_LEVEL: '4' } });
  const log = join(output, `${name}.log`);
  await writeFile(log, `${command} ${args.join(' ')}\n${result.stdout ?? ''}${result.stderr ?? ''}`);
  logFiles.push(log);
  if (result.error) throw result.error;
  return result;
}
async function success(name: string, command: string, args: string[]) {
  const result = await run(name, command, args);
  assert.equal(result.status, 0, `${name} failed. See ${logFiles.at(-1)}\n${result.stderr}`);
  return result;
}
async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}
async function verifyCompilerInputs() {
  const declared = new Set(Object.keys(coverage.files));
  const dependencies = (await walk(build)).filter(path => path.endsWith('.o.d'));
  assert(dependencies.length > 0, 'COMPILER_DEPENDENCY_READBACK_REQUIRED');
  const seen = new Set<string>();
  for (const path of dependencies) {
    const data = (await readFile(path, 'utf8')).replace(/\\\r?\n/g, ' ');
    for (const dependency of data.split(/\s+/)) {
      if (!dependency.startsWith(`${source}/`)) continue;
      const name = relative(source, dependency);
      assert(declared.has(name), `UNRECORDED_COMPILER_INPUT: ${name}`);
      seen.add(name);
    }
  }
  return [...seen].sort();
}
async function invalidateObject(sourceFile: string) {
  const objects = (await walk(build)).filter(path => basename(path) === `${basename(sourceFile)}.o`);
  assert.equal(objects.length, 1, `MUTATED_OBJECT_IDENTITY: ${sourceFile}`);
  await rm(objects[0]);
  await rm(join(build, 'performance/libperformance_engine.a'), { force: true });
  await rm(join(build, 'physical_controls_replay'), { force: true });
}
function replaceOnce(original: string, before: string, after: string) {
  assert.equal(original.split(before).length, 2, `MUTANT_SOURCE_SHAPE_DRIFT: ${before}`);
  return original.replace(before, after);
}
const hashes = await sourceHashes();
await mkdir(project);
for (const library of ['performance', 'sequencer', 'sampler', 'patches', 'tuner', 'beat-tracker', 'peripherals']) {
  await cp(join(root, 'lib', library), join(source, 'lib', library), {
    recursive: true,
    filter: async path => !/(?:^|\/)(?:node_modules|build[^/]*)(?:\/|$)/.test(path)
      && ((await stat(path)).isDirectory() || /\.(?:cpp|h|cmake)$/.test(path) || path.endsWith('/CMakeLists.txt')),
  });
}
await cp(join(root, 'verification/physical-controls/replay.cpp'), join(project, 'replay.cpp'));
await writeFile(join(project, 'CMakeLists.txt'), `cmake_minimum_required(VERSION 3.20)
project(physical_controls_verification LANGUAGES CXX)
set(BUILD_TESTING ON CACHE BOOL "Build actual native witnesses" FORCE)
add_subdirectory("${source}/lib/performance" performance)
add_executable(physical_controls_replay replay.cpp "${source}/lib/peripherals/src/peripheral_light_delivery.cpp")
target_link_libraries(physical_controls_replay PRIVATE performance_engine)
target_compile_features(physical_controls_replay PRIVATE cxx_std_17)
target_compile_options(physical_controls_replay PRIVATE -Wall -Wextra -Wpedantic)
`);
const cmake = await success('cmake-version', 'cmake', ['--version']);
await success('configure', 'cmake', ['-S', project, '-B', build, '-DCMAKE_BUILD_TYPE=Release']);
await success('build-pristine', 'cmake', ['--build', build, '--target', 'physical_controls_replay', 'physical_input_tests', 'cue_light_tests']);
const compilerInputs = await verifyCompilerInputs();
const cache = await readFile(join(build, 'CMakeCache.txt'), 'utf8');
const compiler = cache.match(/^CMAKE_CXX_COMPILER:FILEPATH=(.+)$/m)?.[1];
assert(compiler, 'COMPILER_PATH_READBACK_REQUIRED');
const compilerVersion = await success('compiler-version', compiler, ['--version']);
const executable = join(build, 'physical_controls_replay');
const baseline = await success('pristine', executable, []);
assert.deepEqual(JSON.parse(baseline.stdout), expected, 'FINITE_DOMAIN_RECEIPT');
await success('existing-input-witnesses', join(build, 'performance/physical_input_tests'), []);
await success('existing-cue-light-witnesses', join(build, 'performance/cue_light_tests'), []);

const enginePath = 'lib/performance/src/performance_engine.cpp';
const deliveryPath = 'lib/peripherals/src/peripheral_light_delivery.cpp';
const engine = await readFile(join(source, enginePath), 'utf8');
const delivery = await readFile(join(source, deliveryPath), 'utf8');
const mutants = [
  { name: 'unbound-lights-skipped', path: enginePath, marker: 'HELD_IMAGE_COMPLETE', original: engine,
    changed: replaceOnce(engine, '    const uint32_t rows = binding.kind == PF_INPUT_CUES ? binding.rows : 0;',
      '    if (binding.kind != PF_INPUT_CUES) continue;\n    const uint32_t rows = binding.rows;') },
  { name: 'held-peak-limited-to-seventy', path: enginePath, marker: 'HELD_IMAGE_OR', original: engine,
    changed: replaceOnce(engine, '    if (engine->inputs.physical_held(input)) physical_level = 1;',
      '    if (engine->inputs.physical_held(input)) physical_level = .7;') },
  { name: 'recording-baseline-removed', path: enginePath, marker: 'BASELINE_RECORDING_PULSE', original: engine,
    changed: replaceOnce(engine, '    else if (recording_rows || (rows && engine->compiled && engine->compiled->cue_warning(engine->end, rows)))',
      '    else if (false)') },
  { name: 'playing-baseline-removed', path: enginePath, marker: 'BASELINE_PLAYING_LEVEL', original: engine,
    changed: replaceOnce(engine, '    else if (playing_rows) physical_level = .7;',
      '    else if (playing_rows) physical_level = 0;') },
  { name: 'revoke-clears-other-source-held-bits', path: enginePath, marker: 'HELD_REVOKE_ISOLATION', original: engine,
    changed: replaceOnce(engine, '  producer->active = false; std::fill(std::begin(producer->ownership), std::end(producer->ownership), 0);',
      '  for (unsigned index = 0; index < PF_INPUT_PRODUCERS; ++index) engine->inputs.producer(index)->held = 0;\n  producer->active = false; std::fill(std::begin(producer->ownership), std::end(producer->ownership), 0);') },
  { name: 'all-led-reports-target-channel-zero', path: deliveryPath, marker: 'FOUR_LED_REPORT_BYTES', original: delivery,
    changed: replaceOnce(delivery, 'pp_ipac_led_report(state->bindings[index].sdk_channel, uint32_t', 'pp_ipac_led_report(0, uint32_t') },
  { name: 'committed-publication-replayed', path: deliveryPath, marker: 'DELIVERY_COMMITTED_REPLAY', original: delivery,
    changed: replaceOnce(delivery, '  if (sequence <= state->committed || sequence < state->newest) return PP_STALE;',
      '  if (false) return PP_STALE;') },
  { name: 'partial-frame-committed', path: deliveryPath, marker: 'DELIVERY_COMPLETE_COMMIT', original: delivery,
    changed: replaceOnce(delivery, '  if (frame->count != state->prepared.count) return PP_INVALID;', '  (void)frame->count;') },
];
const outcomes: { name: string; status: string; expectedFailure: string }[] = [];
for (const mutant of mutants) {
  const path = join(source, mutant.path);
  await writeFile(path, mutant.changed);
  await invalidateObject(mutant.path);
  try {
    await success(`build-${mutant.name}`, 'cmake', ['--build', build, '--target', 'physical_controls_replay']);
    const result = await run(mutant.name, executable, []);
    assert.equal(result.status, 1, `MUTANT_NOT_REJECTED_BY_PROPERTY: ${mutant.name}`);
    assert.equal(result.stderr.trim(), mutant.marker, `WRONG_MUTANT_FAILURE: ${mutant.name}`);
    assert.equal(result.stdout, '', `WRONG_MUTANT_FAILURE: ${mutant.name}`);
    outcomes.push({ name: mutant.name, status: 'CAUGHT-real-source-mutation', expectedFailure: mutant.marker });
  } finally { await writeFile(path, mutant.original); }
  await invalidateObject(mutant.path);
  await success(`build-restored-${mutant.name}`, 'cmake', ['--build', build, '--target', 'physical_controls_replay']);
  const restored = await success(`restored-${mutant.name}`, executable, []);
  assert.deepEqual(JSON.parse(restored.stdout), expected, 'RESTORED_DOMAIN_RECEIPT');
}
const final = await success('final-pristine', executable, []);
assert.deepEqual(JSON.parse(final.stdout), expected, 'FINAL_DOMAIN_RECEIPT');
assert.deepEqual(await sourceHashes(), hashes, 'PRODUCTION_SOURCES_UNCHANGED');
for (const [path, hash] of Object.entries(hashes))
  assert.equal(createHash('sha256').update(await readFile(join(source, path))).digest('hex'), hash, `COPIED_SOURCE_NOT_RESTORED: ${path}`);
const report = { status: 'PASS-bounded-actual-source-physical-controls', baseline: expected,
  sourceSyncCommit: coverage.syncCommit, sourceHashes: hashes, compilerInputs, mutants: outcomes,
  node: process.version, cmake: cmake.stdout.trim(), compiler: compilerVersion.stdout.trim(), output, logFiles,
  exclusions: coverage.exclusions };
await writeFile(join(output, 'receipt.json'), JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report) + '\n');
