import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import coverage from './coverage.json' with { type: 'json' };

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceFile = 'lib/performance/musicxml-song.ts';
const checkFile = 'verification/musicxml/check.ts';

async function sourceHashes() {
  const hashes: Record<string, string> = {};
  for (const [path, expected] of Object.entries(coverage.files)) {
    const actual = createHash('sha256').update(await readFile(join(root, path))).digest('hex');
    assert.equal(actual, expected, `SOURCE_DRIFT: ${path}. Review the grammar and properties, rerun verification, then advance coverage.json.`);
    hashes[path] = actual;
  }
  return hashes;
}
function run(directory: string, witness?: string) {
  const args = ['--import', 'tsx', checkFile, ...(witness === undefined ? [] : ['--witness', witness])];
  const result = spawnSync(process.execPath, args, { cwd: directory, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}
function replaceExactlyOnce(source: string, before: string, after: string): string {
  assert.equal(source.split(before).length, 2, 'MUTANT_SOURCE_SHAPE_DRIFT');
  return source.replace(before, after);
}

assert.equal(process.argv.length, 2, 'Run without arguments; redirect stdout to a new report file if needed.');
const hashes = await sourceHashes();
const baseline = run(root);
assert.equal(baseline.status, 0, baseline.stderr);
const baselineReport: unknown = JSON.parse(baseline.stdout);
const original = await readFile(join(root, sourceFile), 'utf8');
const displayLine = original.split('\n').find(line => line.includes('if (shown !== cue.source.text.trim()) throw new MusicXmlValidationError('));
assert(displayLine, 'DISPLAY_GUARD_MISSING');
const mutants = [
  { name: 'display-action-guard-removed', witness: 'display', marker: 'DISPLAY_ACTION_AGREEMENT',
    source: replaceExactlyOnce(original, displayLine, '      void shown;') },
  { name: 'voices-omitted-from-semantic-digest', witness: 'voices', marker: 'VOICE_SEMANTIC_IDENTITY',
    source: replaceExactlyOnce(original, 'chartBinding: { ...data.chartBinding, controlNames } }, voices };',
      'chartBinding: { ...data.chartBinding, controlNames } }, voices: null };') },
];
const temporary = await mkdtemp(join(tmpdir(), 'musicxml-verification-'));
const outcomes: { name: string; witness: string; status: string; expectedFailure: string }[] = [];
try {
  await cp(join(root, 'lib'), join(temporary, 'lib'), { recursive: true, filter: path => !/(?:^|\/)(?:node_modules|build[^/]*)(?:\/|$)/.test(path) });
  await mkdir(join(temporary, 'verification'));
  await cp(join(root, 'verification/musicxml'), join(temporary, 'verification/musicxml'), { recursive: true });
  await writeFile(join(temporary, 'package.json'), JSON.stringify({ type: 'module' }));
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'), 'dir');
  for (const mutant of mutants) {
    assert.equal(run(temporary, mutant.witness).status, 0, 'PRISTINE_WITNESS_MUST_PASS');
    await writeFile(join(temporary, sourceFile), mutant.source);
    try {
      const broken = run(temporary, mutant.witness);
      assert.notEqual(broken.status, 0, `MUTANT_SURVIVED: ${mutant.name}`);
      assert.equal(broken.status, 1, `WRONG_MUTANT_FAILURE: ${mutant.name}\n${broken.stderr}`);
      assert.equal(broken.stderr, '', `WRONG_MUTANT_FAILURE: ${mutant.name}\n${broken.stderr}`);
      const failure: unknown = JSON.parse(broken.stdout);
      assert.deepEqual(failure, { status: 'FAIL-witness-property', property: mutant.witness,
        marker: mutant.marker, assertionCode: 'ERR_ASSERTION' }, `WRONG_MUTANT_FAILURE: ${mutant.name}`);
      outcomes.push({ name: mutant.name, witness: mutant.witness, status: 'CAUGHT-real-source-mutation', expectedFailure: mutant.marker });
    } finally { await writeFile(join(temporary, sourceFile), original); }
    const restored = run(temporary, mutant.witness);
    assert.equal(restored.status, 0, restored.stderr);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
assert.deepEqual(await sourceHashes(), hashes, 'PRODUCTION_SOURCE_CHANGED');
process.stdout.write(JSON.stringify({ status: 'PASS-bounded-musicxml-with-source-mutants', baseline: baselineReport,
  mutants: outcomes, sourceSyncCommit: coverage.syncCommit, sourceHashes: hashes, node: process.version,
  exclusions: ['arbitrary XML', 'unbounded documents', 'XML library internals', 'cryptographic collisions', 'DSP/playback', 'atomic filesystem publication'] }) + '\n');
