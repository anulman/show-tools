import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const directory = dirname(fileURLToPath(import.meta.url));
const repository = resolve(directory, '../..');
const { values } = parseArgs({ options: { out: { type: 'string' } } });
assert(values.out === undefined || isAbsolute(values.out), 'Pass --out with a new absolute directory');
const output = values.out ?? join(mkdtempSync(join(tmpdir(), 'show-tools-capture-verification-')), 'result');
mkdirSync(output);
function requiredPath(name: string): string {
  const value = process.env[name];
  assert(value && isAbsolute(value), `Set ${name} to its pinned toolchain absolute path`);
  return value;
}
const java = requiredPath('JAVA');
const jar = requiredPath('TLA2TOOLS');
const lock: { tlc: { sha256: string; version: string }; java: { version: string } } = JSON.parse(readFileSync(join(repository, 'verification/tools/toolchain.lock.json'), 'utf8'));
const toolchainHash = lock.tlc.sha256;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
assert.equal(digest(readFileSync(jar)), toolchainHash, `TLC jar differs from pinned ${lock.tlc.version}`);
function run(command: string, args: string[], name: string, cwd = repository) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
  if (result.error) throw result.error;
  const log = result.stdout + result.stderr;
  writeFileSync(join(output, name + '.log'), log);
  return { status: result.status, signal: result.signal, log };
}
function accepted(command: string, args: string[], name: string, cwd = repository) {
  const result = run(command, args, name, cwd);
  assert.equal(result.status, 0, `${name} failed; inspect ${join(output, name + '.log')}`);
  return result;
}
const javaVersion = accepted(java, ['-version'], 'java-version').log.trim();
assert(javaVersion.includes('Temurin-' + lock.java.version.replace(/\.0\.LTS$/, '')), 'Java runtime differs from pinned Temurin build');
const sourceRecord: { sourceCommit: string; files: Record<string, string> } = JSON.parse(readFileSync(join(directory, 'source-record.json'), 'utf8'));
for (const [file, hash] of Object.entries(sourceRecord.files)) {
  assert.equal(digest(readFileSync(join(repository, file))), hash, `${file} changed since model/source mapping; inspect before updating source-record.json`);
}
const config = readFileSync(join(directory, 'CaptureHandoff.cfg'), 'utf8');
const mutations = [
  { name: 'discardOnRejectedArm', scenario: 'combined-admission', invariant: 'CombinedRejectPreservesDraft', message: 'unavailable CRB target rejects whole cue',
    edits: [{ before: 'if (available_bank(cue.take) < 0) return PF_TAKE_UNAVAILABLE;',
      after: 'if (available_bank(cue.take) < 0) { if (cue.kind == PF_COMMIT_ARM) discard_invalid_draft(cue); return PF_TAKE_UNAVAILABLE; }' }] },
  { name: 'admitAfterInvalid', scenario: 'invalid-outgoing', invariant: 'InvalidReleaseCannotAdmit', message: 'period cleanup reports both source cues and clears the cancelled incoming reservation',
    edits: [
      { before: 'if (cue.kind == PF_ARM) action.result = failed_commit ? PF_CAPTURE_BUSY : preflight_start(cue, staged_commit, staged_period, action.bank);', after: 'if (cue.kind == PF_ARM) action.result = failed_commit ? PF_OK : preflight_start(cue, staged_commit, staged_period, action.bank);' },
      { before: 'if (cue.kind == PF_ARM && failed_commit) result = PF_CAPTURE_BUSY;', after: 'if (cue.kind == PF_ARM && failed_commit) result = PF_OK;' },
    ] },
  { name: 'overwriteLatest', scenario: 'retained-bank', invariant: 'CaptureBankNotLatest', message: 'Stop discards an incompatible partial draft and preserves latest complete PCM/period/revision',
    edits: [{ before: 'if (bank != take.latest && !(active_capture_.take == id', after: 'if (!(active_capture_.take == id' }] },
  { name: 'noAutoplay', scenario: 'autoplay', invariant: 'SuccessfulPublicationAutoplays', message: 'commit autoplays processed mono-to-stereo take once',
    edits: [{ before: 'int Program::finish_capture(const Cue& cue, const CommitPlan& plan, bool starts_next) noexcept {',
      after: 'int Program::finish_capture(const Cue& incoming, const CommitPlan& plan, bool starts_next) noexcept {\n  Cue cue = incoming; cue.launch = PF_STORE_ONLY;' }] },
  { name: 'storeAutoplays', scenario: 'store-only-endpoint', invariant: 'StoreOnlyPublicationDoesNotLaunch', message: 'store-only completion never starts playback',
    edits: [{ before: 'int Program::finish_capture(const Cue& cue, const CommitPlan& plan, bool starts_next) noexcept {',
      after: 'int Program::finish_capture(const Cue& incoming, const CommitPlan& plan, bool starts_next) noexcept {\n  Cue cue = incoming; cue.launch = PF_AUTOPLAY;' }] },
  { name: 'missEndpoint', scenario: 'automatic-endpoint', invariant: 'AutomaticEndpointCompletes', message: 'missing finish press commits at the authored endpoint',
    edits: [{ before: 'if (active_capture_.take >= 0 && frame >= boundary_frame(frame_at(takes_[active_capture_.take].end))', after: 'if (false && active_capture_.take >= 0 && frame >= boundary_frame(frame_at(takes_[active_capture_.take].end))' }] },
];
function checkModel(name: string, mutation: string, configuration = config) {
  const folder = join(output, name);
  mkdirSync(folder);
  copyFileSync(join(directory, 'CaptureHandoff.tla'), join(folder, 'CaptureHandoff.tla'));
  writeFileSync(join(folder, 'CaptureHandoff.cfg'), configuration.replace('Mutation = "none"', `Mutation = "${mutation}"`));
  const result = run(java, ['-Xmx512m', '-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC', '-workers', '1', '-metadir', join(folder, 'states'), '-config', join(folder, 'CaptureHandoff.cfg'), join(folder, 'CaptureHandoff.tla')], name);
  return result;
}
const checked = checkModel('model-pristine', 'none');
assert.equal(checked.status, 0, 'Pristine capture model did not pass');
assert.match(checked.log, /Model checking completed\. No error has been found\./);
assert.match(checked.log, /0 states left on queue/);
const displayChecked = checkModel('model-display', 'none', readFileSync(join(directory, 'CaptureHandoff-chart.cfg'), 'utf8'));
assert.equal(displayChecked.status, 0, 'Smaller display model did not pass');
assert.match(displayChecked.log, /Model checking completed\. No error has been found\./);
assert.match(displayChecked.log, /0 states left on queue/);
const overviewChecked = checkModel('model-overview', 'none', readFileSync(join(directory, 'CaptureHandoff-overview.cfg'), 'utf8'));
assert.equal(overviewChecked.status, 0, 'One-capture overview model did not pass');
assert.match(overviewChecked.log, /Model checking completed\. No error has been found\./);
assert.match(overviewChecked.log, /0 states left on queue/);
const modelWitnesses = [];
for (const mutation of mutations) {
  const result = checkModel('model-' + mutation.name, mutation.name);
  assert.notEqual(result.status, 0, `Model mutant ${mutation.name} passed`);
  assert.match(result.log, new RegExp(`Invariant ${mutation.invariant} is violated`), `Expected ${mutation.invariant} witness`);
  assert.match(result.log, /behavior up to this point/i);
  modelWitnesses.push({ mutation: mutation.name, invariant: mutation.invariant, log: 'model-' + mutation.name + '.log' });
}
const sourceFiles = [
  'verification/capture/replay.cpp', 'lib/performance/src/performance_engine.cpp', 'lib/performance/src/compiled_program.cpp',
  'lib/beat-tracker/src/beat_tracker.cpp', 'lib/beat-tracker/src/beat_clock.cpp', 'lib/beat-tracker/src/tempo_follower.cpp',
  'lib/sampler/src/sample_engine.cpp', 'lib/sequencer/src/audio_sequence_engine.cpp', 'lib/patches/src/patch_engine.cpp',
  'lib/patches/src/shake_percussion.cpp',
  'lib/tuner/src/tuner.cpp',
  'lib/patches/src/tribulations_guitar.cpp', 'lib/patches/src/tribulations_string.cpp', 'lib/patches/src/tribulations_filter.cpp', 'lib/patches/src/tribulations_amp.cpp',
  'lib/peripherals/src/peripheral_controls.cpp',
];
const build = join(output, 'native');
mkdirSync(build);
const flags = ['-std=c++17', '-O0', '-DBT_MANUAL_ONLY', ...['beat-tracker', 'sampler', 'sequencer', 'performance', 'patches', 'tuner', 'peripherals'].map(name => '-I' + join(repository, 'lib', name, 'include'))];
const compiler = process.env.CXX || 'c++';
const objects = sourceFiles.map((file, index) => {
  const object = join(build, index + '.o');
  accepted(compiler, [...flags, '-c', join(repository, file), '-o', object], 'compile-' + index);
  return object;
});
const executable = join(build, 'replay');
accepted(compiler, objects.concat(['-o', executable]), 'link-pristine');
const scenarios = ['combined-admission', 'independent-admission', 'invalid-outgoing', 'retained-bank', 'autoplay', 'stop-complete', 'automatic-endpoint', 'selection-preflight', 'boundary-orders', 'wrap-preserves-latest', 'tuner-isolation', 'store-only-endpoint'];
for (const scenario of scenarios) accepted(executable, [scenario], 'replay-' + scenario, build);
const nativeWitnesses = [];
const nativeMutations = [
  ...mutations.map(mutation => ({ ...mutation, file: 'lib/performance/src/compiled_program.cpp', objectIndex: 2 })),
  { name: 'tunerDuringCapture', scenario: 'tuner-isolation', message: 'reference playback rejects during capture',
    file: 'lib/performance/src/performance_engine.cpp', objectIndex: 1,
    edits: [{ before: 'if (command != PF_TUNER_CLOSE && command != PF_TUNER_SILENCE && running(engine))', after: 'if (false)' }] },
];
for (const mutation of nativeMutations) {
  const folder = join(build, mutation.name);
  mkdirSync(folder);
  let source = readFileSync(join(repository, mutation.file), 'utf8');
  for (const edit of mutation.edits) {
    assert.equal(source.split(edit.before).length, 2, `Source mutation anchor changed for ${mutation.name}`);
    source = source.replace(edit.before, edit.after);
  }
  const changed = join(folder, 'mutant.cpp');
  writeFileSync(changed, source);
  copyFileSync(join(repository, 'lib/performance/src/compiled_program.h'), join(folder, 'compiled_program.h'));
  copyFileSync(join(repository, 'lib/performance/src/input_router.h'), join(folder, 'input_router.h'));
  const object = join(folder, 'mutant.o');
  accepted(compiler, [...flags, '-c', changed, '-o', object], 'compile-mutant-' + mutation.name);
  const mutant = join(folder, 'replay');
  accepted(compiler, objects.map((item, index) => index === mutation.objectIndex ? object : item).concat(['-o', mutant]), 'link-mutant-' + mutation.name);
  const result = run(mutant, [mutation.scenario], 'replay-mutant-' + mutation.name, folder);
  assert(result.status !== 0 || result.signal !== null, `Actual C++ mutant ${mutation.name} passed`);
  assert(result.log.includes(mutation.message), `Actual C++ mutant failed for an unrelated reason; inspect replay-mutant-${mutation.name}.log`);
  nativeWitnesses.push({ mutation: mutation.name, scenario: mutation.scenario, status: result.status, signal: result.signal, log: 'replay-mutant-' + mutation.name + '.log' });
}
for (const scenario of scenarios) accepted(executable, [scenario], 'restored-' + scenario, build);
for (const [file, hash] of Object.entries(sourceRecord.files)) assert.equal(digest(readFileSync(join(repository, file))), hash, `${file} was changed by verification`);
const receipt = { status: 'PASS', scope: 'Bounded capture handoff model plus real C++ witness and source-mutation sensitivity; not an unrestricted implementation proof', sourceCommit: sourceRecord.sourceCommit,
  model: { takeCount: 3, banksPerTake: 2, maximumCaptureBeginnings: 3, completeQueueExhaustion: true, stats: checked.log.match(/\d+ states generated, \d+ distinct states found, 0 states left on queue\./)?.[0], witnesses: modelWitnesses },
  displayModel: { takeCount: 2, banksPerTake: 2, maximumCaptureBeginnings: 2, completeQueueExhaustion: true, stats: displayChecked.log.match(/\d+ states generated, \d+ distinct states found, 0 states left on queue\./)?.[0], purpose: 'Smaller separately checked statechart model, not the full proof bound' },
  overviewModel: { takeCount: 2, banksPerTake: 2, maximumCaptureBeginnings: 1, completeQueueExhaustion: true, stats: overviewChecked.log.match(/\d+ states generated, \d+ distinct states found, 0 states left on queue\./)?.[0], purpose: 'Readable one-capture overview, not the main or two-capture display proof' },
  native: { scenarios, witnesses: nativeWitnesses, pristineRerunPassed: true }, toolchain: { tlcJarSha256: toolchainHash, java: javaVersion, compiler: accepted(compiler, ['--version'], 'compiler-version').log.split('\n')[0] },
  sourceFiles: sourceRecord.files, verificationFiles: Object.fromEntries(['CaptureHandoff.tla', 'CaptureHandoff.cfg', 'CaptureHandoff-chart.cfg', 'CaptureHandoff-overview.cfg', 'view.ts', 'statechart.mmd', 'replay.cpp', 'verify.ts'].map(file => [file, digest(readFileSync(join(directory, file)))])), outputDirectory: output };
writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
process.stdout.write(JSON.stringify({ status: receipt.status, model: receipt.model.stats, nativeScenarios: scenarios.length, actualSourceMutantsRejected: nativeWitnesses.length, receipt: join(output, 'receipt.json') }) + '\n');
