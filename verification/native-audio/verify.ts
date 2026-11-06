import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Schema } from 'effect';
import { version as esbuildVersion } from 'esbuild';
import { replay, replayCounterexample, replayAcquisitionCancellation, replayAcquisitionFailures, replayPreSpawnRecovery, replayCancelBeforeRequest, replayFailedExitQuery, mutateController, type Mutation } from './replay.js';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const lock = Schema.decodeUnknownSync(Schema.Struct({ tlc: Schema.Struct({ version: Schema.String, sha256: Schema.String }) }))(
  JSON.parse(await readFile('verification/tools/toolchain.lock.json', 'utf8')),
);
const coverage = Schema.decodeUnknownSync(Schema.Struct({ revision: Schema.String, files: Schema.Record(Schema.String, Schema.String), effectVersion: Schema.String, platformNodeVersion: Schema.String, platformNodeSharedVersion: Schema.String }))(
  JSON.parse(await readFile('verification/native-audio/coverage.json', 'utf8')),
);
for (const [filename, expected] of Object.entries(coverage.files))
  assert.equal(hash(await readFile(filename)), expected, `Source drift in ${filename}; review model/atomicity and replay before advancing coverage.json`);
const effectVersion = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(JSON.parse(await readFile('node_modules/effect/package.json', 'utf8'))).version;
assert.equal(effectVersion, coverage.effectVersion, 'Effect version changed; review scope/finalizer assumptions');
const packageVersion = async (name: string) => Schema.decodeUnknownSync(Schema.Struct({ version: Schema.String }))(
  JSON.parse(await readFile(`node_modules/${name}/package.json`, 'utf8')),
).version;
const platformNodeVersion = await packageVersion('@effect/platform-node');
const platformNodeSharedVersion = await packageVersion('@effect/platform-node-shared');
assert.equal(platformNodeVersion, coverage.platformNodeVersion, 'Node platform version changed; review process-boundary assumptions');
assert.equal(platformNodeSharedVersion, coverage.platformNodeSharedVersion, 'Shared Node platform version changed; review cleanup assumptions');
const expectedJarSha256 = lock.tlc.sha256;
const java = process.env.JAVA, jar = process.env.TLA2TOOLS;
assert(java && jar, 'Set JAVA and TLA2TOOLS to the pinned toolchain; see verification/native-audio/README.md');
assert.equal(createHash('sha256').update(await readFile(jar)).digest('hex'), expectedJarSha256, `Unexpected TLC JAR; use pinned TLA+${lock.tlc.version}`);
const args = process.argv.slice(2);
assert(args.length <= 1, 'Usage: node --import tsx verification/native-audio/verify.ts [NEW_OUTPUT_DIRECTORY]');
const output = args[0] ? resolve(args[0]) : join(await mkdtemp(join(tmpdir(), 'native-audio-proof-')), 'run');
const { mkdir } = await import('node:fs/promises');
await mkdir(output, { recursive: false });
const source = await readFile('lib/remote-performance/controller.ts');
const sourceSha256 = hash(source);
const cases: Array<{ name: string; mutation: Mutation; status: number; actions: string[]; states: number; invariant: string | null }> = [];
const proof = {
  schemaVersion: 1,
  outputDirectory: output,
  sourceSha256,
  syncedRevision: coverage.revision,
  effectVersion,
  platformNodeVersion,
  platformNodeSharedVersion,
  nodeVersion: process.version,
  esbuildVersion,
  javaVersion: spawnSync(java, ['-version'], { encoding: 'utf8' }).stderr.trim(),
  tlcJarSha256: expectedJarSha256,
  model: { attempts: 2, commandSlots: 1, maxIssuedCommands: 1, workers: 1 },
  modelSha256: hash(await readFile('verification/native-audio/NativeAudio.tla')),
  configSha256: hash(await readFile('verification/native-audio/NativeAudio.cfg')),
  replaySha256: hash(await readFile('verification/native-audio/replay.ts')),
  cases,
};
const expected = { identity: 'ReadyIdentity', ownership: 'UnknownOwnershipHeld', cancel: 'NoCanceledReady', cleanup: 'OneOwnedChild', command: 'NoStaleApplied', observe: 'NoStaleEvent' };
const replayFailures = {
  identity: ['Ready view must keep the reserved attempt identity', 'Ready view must keep the reserved attempt identity'],
  ownership: ['Pending acquisition must retain ownership', 'Pending acquisition must retain ownership'],
  cancel: ['Canceled startup must never publish Ready', 'Canceled startup must never publish Ready'],
  cleanup: ['Unconfirmed cleanup must retain ownership', 'Unconfirmed cleanup must block a replacement'],
  command: ['Unready old command must report unknown', 'Old command completion must not report applied to replacement'],
  observe: ['Canceled observer must not publish', 'Old observer must not publish into replacement'],
} satisfies Record<Exclude<Mutation, 'none'>, [string, string]>;
const runs: Array<{ name: string; mutation: Mutation; omitInvariant?: string; expectedInvariant: string | null }> = [
  { name: 'none', mutation: 'none', expectedInvariant: null },
  ...(['cancel', 'cleanup', 'command', 'observe', 'ownership', 'identity'] satisfies Array<Exclude<Mutation, 'none'>>)
    .map(mutation => ({ name: mutation, mutation, expectedInvariant: expected[mutation] })),
  { name: 'ownership-live-child', mutation: 'ownership', omitInvariant: 'UnknownOwnershipHeld', expectedInvariant: 'OneOwnedChild' },
];
for (const { name, mutation, omitInvariant, expectedInvariant } of runs) {
  const directory = await mkdtemp(join(tmpdir(), 'native-audio-model-'));
  try {
    await cp('verification/native-audio/NativeAudio.tla', join(directory, 'NativeAudio.tla'));
    let cfg = (await readFile('verification/native-audio/NativeAudio.cfg', 'utf8')).replace('Mutation = "none"', `Mutation = "${mutation}"`);
    if (omitInvariant) cfg = cfg.replace(omitInvariant + ' ', '');
    await writeFile(join(directory, 'NativeAudio.cfg'), cfg);
    if (mutation !== 'none') await writeFile(join(output, `${name}.controller.ts`), mutateController(source.toString('utf8'), mutation));
    const result: SpawnSyncReturns<string> = spawnSync(java, ['-Xmx512m', '-XX:+UseParallelGC', '-cp', jar, 'tlc2.TLC', '-workers', '1', '-config', 'NativeAudio.cfg', 'NativeAudio.tla'], { cwd: directory, encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (result.error) throw result.error;
    const text: string = result.stdout + result.stderr;
    await writeFile(join(output, `${name}.tlc.out`), text);
    const invariant = text.match(/Error: Invariant (\w+) is violated\./)?.[1] ?? null;
    const actions = [...text.matchAll(/^State \d+: <(\w+) line/gm)].map(match => match[1]);
    const states: number = Number(text.match(/(\d+) distinct states found/)?.[1]);
    assert(Number.isSafeInteger(states) && states > 0, 'TLC must report explored states');
    if (mutation === 'none') {
      assert.equal(result.status, 0, text);
      assert(text.includes('Model checking completed. No error has been found.'), text);
      await replayAcquisitionCancellation();
      await replayAcquisitionFailures();
      await replayPreSpawnRecovery();
      await replayCancelBeforeRequest();
      await replayFailedExitQuery();
      for (const scenario of ['cancel', 'cleanup', 'command', 'observe', 'ownership', 'identity'] satisfies Array<Exclude<Mutation, 'none'>>) await replay('none', scenario);
    } else {
      assert.equal(result.status, 12, text);
      assert.equal(invariant, expectedInvariant, text);
      assert(actions.length > 0, 'Mutation must produce a counterexample');
      await replayCounterexample('none', actions);
      const expectedFailure = name === 'ownership-live-child' ? 'Released attempt must not leave a live child' : replayFailures[mutation][0];
      await assert.rejects(replayCounterexample(mutation, actions), error => error instanceof assert.AssertionError && error.message.includes(expectedFailure));
      await assert.rejects(replay(mutation, mutation), error => error instanceof assert.AssertionError && error.message.includes(replayFailures[mutation][1]));
    }
    proof.cases.push({ name, mutation, status: result.status ?? -1, actions, states, invariant });
    process.stdout.write(`${name}: ${states} model states; ${mutation === 'none' ? 'invariants hold' : `${invariant} fails and real-source mutant is caught`}\n`);
  } finally { await rm(directory, { recursive: true, force: true }); }
}
assert.equal(createHash('sha256').update(await readFile('lib/remote-performance/controller.ts')).digest('hex'), sourceSha256, 'Production source must remain untouched');
await writeFile(join(output, 'receipt.json'), JSON.stringify(proof, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(`Receipt: ${join(output, 'receipt.json')}\n`);
