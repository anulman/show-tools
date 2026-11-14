import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sourcePath = 'lib/performance/sheet-cues.ts';
const source = await readFile(join(root, sourcePath), 'utf8');
function run(cwd: string) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'verification/cues/check.ts'], { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}
const baseline = run(root);
assert.equal(baseline.status, 0, baseline.stderr);
const mutants = [
  { name: 'cx-launches-like-commit', before: 'operation: op,', after: "operation: op === 'cx' ? 'c' : op," },
  { name: 'source-name-discarded', before: 'sourceName: match[4] ?? null', after: 'sourceName: null' },
  { name: 'silent-anchor-shifted', before: 'anchor = Number(match[1]) - 1', after: 'anchor = Number(match[1])' },
  { name: 'next-bar-wrap-lost', before: 'pressBeat !== null && beat < pressBeat ? 1 : 0', after: '0' },
];
const temporary = await mkdtemp(join(tmpdir(), 'terse-cue-proof-'));
try {
  await mkdir(join(temporary, 'lib/performance'), { recursive: true });
  await mkdir(join(temporary, 'verification/cues'), { recursive: true });
  await cp(join(root, 'verification/cues/check.ts'), join(temporary, 'verification/cues/check.ts'));
  await writeFile(join(temporary, 'package.json'), '{"type":"module"}');
  await symlink(join(root, 'node_modules'), join(temporary, 'node_modules'));
  for (const mutant of mutants) {
    assert.equal(source.split(mutant.before).length, 2, 'MUTANT_SOURCE_DRIFT');
    await writeFile(join(temporary, sourcePath), source);
    assert.equal(run(temporary).status, 0, 'PRISTINE_WITNESS');
    await writeFile(join(temporary, sourcePath), source.replace(mutant.before, mutant.after));
    const result = run(temporary);
    assert.equal(result.status, 1, `MUTANT_SURVIVED: ${mutant.name}`);
    assert.match(result.stderr, /AssertionError/, `WRONG_FAILURE: ${mutant.name}`);
    await writeFile(join(temporary, sourcePath), source);
    assert.equal(run(temporary).status, 0, 'RESTORED_WITNESS');
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
assert.equal(await readFile(join(root, sourcePath), 'utf8'), source, 'SOURCE_CHANGED');
process.stdout.write(JSON.stringify({ status: 'PASS-bounded-cues-with-actual-source-mutants', baseline: JSON.parse(baseline.stdout), mutants: mutants.map(m => m.name), exclusions: ['arbitrary strings', 'unbounded cells', 'native execution', 'physical timing', 'source extraction', 'DSP'] }) + '\n');
