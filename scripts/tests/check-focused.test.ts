import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-focused.ts', ...args], {
    cwd: new URL('../../', import.meta.url),
    encoding: 'utf8',
  });
}

for (const domain of ['cues', 'musicxml', 'commands']) {
  test(`${domain} lists its behavior checks and remaining integration`, () => {
    const result = run(domain, '--list');
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, new RegExp(`Focused check: ${domain}\\.`));
    assert.match(result.stdout, /Prerequisites: npm ci/);
    assert.match(result.stdout, /Selected: .*\.test\.ts/);
    assert.match(result.stdout, /Remaining integration: npm run typecheck; npm test/);
    assert.doesNotMatch(result.stdout, /# tests/);
  });
}

for (const args of [[], ['unknown'], ['cues', '--skip'], ['cues', '--list', 'extra'], ['--list']]) {
  test(`invalid selection ${JSON.stringify(args)} fails closed`, () => {
    const result = run(...args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Shared or unknown changes require broader integration/);
    assert.doesNotMatch(result.stdout, /Selected:|# tests/);
  });
}

test('a selected check that cannot run returns failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'focused-check-missing-'));
  try {
    await mkdir(join(root, 'scripts'));
    await cp(new URL('../check-focused.ts', import.meta.url), join(root, 'scripts/check-focused.ts'));
    await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(root, 'node_modules'));
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-focused.ts', 'cues'], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Selected: lib\/performance\/tests\/sheet-cues.test.ts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('both native workflows select transitive tuner and patch changes', async () => {
  for (const workflow of ['native-host', 'peripherals']) {
    const text = await readFile(new URL(`../../.github/workflows/${workflow}.yml`, import.meta.url), 'utf8');
    for (const dependency of ['tuner', 'patches']) {
      assert(text.includes(`      - 'lib/${dependency}/**'`), `${workflow} must run for ${dependency} changes`);
    }
  }
});
