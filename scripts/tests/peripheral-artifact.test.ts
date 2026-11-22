import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { artifactHash, PERIPHERAL_ARTIFACT_FILES, PERIPHERAL_FLAGS, PERIPHERAL_INPUTS, readPeripheralArtifact } from '../peripheral-artifact.js';
import { buildSessionBundles, writeSessionLaunchers } from '../session-bundles.js';

const root = resolve('.');
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]), Buffer.alloc(12), Buffer.from([0x3e, 0])]);
async function artifact() {
  const directory = await mkdtemp(join(tmpdir(), 'peripheral-artifact-'));
  const sourceFiles = Object.fromEntries(await Promise.all(PERIPHERAL_INPUTS.map(async path => [path, artifactHash(await readFile(join(root, path)))])));
  const build = { schemaVersion: 1, sourceRevision, target: 'x86_64-linux-musl', compiler: 'Fixture compiler', flags: PERIPHERAL_FLAGS, sourceFiles };
  await writeFile(join(directory, 'peripheral-host'), elf);
  await writeFile(join(directory, 'source-revision.txt'), sourceRevision + '\n');
  await writeFile(join(directory, 'compiler.txt'), build.compiler + '\n');
  await writeFile(join(directory, 'build.json'), JSON.stringify(build));
  for (const name of PERIPHERAL_ARTIFACT_FILES.filter(name => name.includes('LICENSE') || name === 'MUSL-COPYRIGHT'))
    await writeFile(join(directory, name), 'Fixture runtime license');
  const seal = async () => {
    await writeFile(join(directory, 'SHA256SUMS'), (await Promise.all(PERIPHERAL_ARTIFACT_FILES.map(async name => `${artifactHash(await readFile(join(directory, name)))}  ${name}\n`))).join(''));
  };
  await seal();
  return { directory, build, seal, close: () => rm(directory, { recursive: true, force: true }) };
}

test('peripheral artifact verifies hashes, architecture and complete committed source provenance without execution', async () => {
  const fixture = await artifact();
  try {
    const result = await readPeripheralArtifact(root, fixture.directory);
    assert.equal(result.sourceRevision, sourceRevision);
    assert.deepEqual(result.executable, elf);
    assert.equal(result.files.size, PERIPHERAL_ARTIFACT_FILES.length + 1);
    assert.deepEqual(Object.keys(result.build.sourceFiles).sort(), [...PERIPHERAL_INPUTS].sort());
  } finally { await fixture.close(); }
});

test('tampered bytes, resealed foreign architecture, incomplete inputs and false provenance are rejected', async () => {
  for (const scenario of ['bytes', 'architecture', 'inputs', 'input-map-header', 'source', 'flags', 'input-hash']) {
    const fixture = await artifact();
    try {
      if (scenario === 'bytes') await writeFile(join(fixture.directory, 'peripheral-host'), 'tampered');
      if (scenario === 'architecture') { await writeFile(join(fixture.directory, 'peripheral-host'), Buffer.alloc(20)); await fixture.seal(); }
      if (scenario === 'inputs') delete fixture.build.sourceFiles[PERIPHERAL_INPUTS[0]];
      if (scenario === 'input-map-header') delete fixture.build.sourceFiles['lib/peripherals/host/linux_input_map.h'];
      if (scenario === 'input-hash') fixture.build.sourceFiles[PERIPHERAL_INPUTS[0]] = '0'.repeat(64);
      if (scenario === 'source') fixture.build.sourceRevision = '0'.repeat(40);
      if (scenario === 'flags') fixture.build.flags = [];
      if (!['bytes', 'architecture'].includes(scenario)) { await writeFile(join(fixture.directory, 'build.json'), JSON.stringify(fixture.build)); await fixture.seal(); }
      await assert.rejects(readPeripheralArtifact(root, fixture.directory), /Peripheral|peripheral|Linux/);
    } finally { await fixture.close(); }
  }
});

test('artifact links and unlisted files are refused', async () => {
  const fixture = await artifact();
  try {
    await writeFile(join(fixture.directory, 'extra'), 'unreviewed');
    await assert.rejects(readPeripheralArtifact(root, fixture.directory), /file set/);
    await rm(join(fixture.directory, 'extra'));
    await rm(join(fixture.directory, 'peripheral-host'));
    await symlink(join(root, 'package.json'), join(fixture.directory, 'peripheral-host'));
    await assert.rejects(readPeripheralArtifact(root, fixture.directory), /regular single-link/);
  } finally { await fixture.close(); }
});

test('installed peripheral command is bundled and relocatable without checkout dependencies or hardware', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'peripheral release '));
  const moved = directory + ' moved';
  try {
    await Promise.all(['gateway', 'provenance', 'bin', 'runtime'].map(name => mkdir(join(directory, name))));
    await buildSessionBundles(root, directory);
    await writeSessionLaunchers(directory);
    await symlink(process.execPath, join(directory, 'runtime/node'));
    await rename(directory, moved);
    const result = execFileSync(join(moved, 'bin/show-tools-peripheral'), ['--help'], { cwd: tmpdir(), encoding: 'utf8' });
    assert.match(result, /peripheral connect --config FILE/);
    assert.match(result, /starts no audio/);
    const inputs = JSON.parse(await readFile(join(moved, 'provenance/peripheral-cli.mjs.inputs.json'), 'utf8'));
    assert('scripts/peripheral-cli.ts' in inputs);
    assert('lib/peripherals/bridge.ts' in inputs);
    assert(!result.includes('Cannot find package'));
    const setup = join(moved, 'bin/show-tools-config');
    const shell = { cwd: tmpdir(), encoding: 'utf8' } as const;
    assert.match(execFileSync(setup, ['--help'], shell), /--check-knob/);
    const preview = JSON.parse(execFileSync(setup, ['--dry-run', '--config', '/dev/null'], shell));
    assert.equal(preview.profilePath, '/dev/null'); assert.equal(preview.planOnly, true);
    await writeFile(join(moved, 'bin/show-tools-peripheral'), '#!/bin/sh\nprintf \'%s\\n\' "$@"\n');
    assert.equal(execFileSync(setup, [], shell), 'setup\n--with-dial\n--stop-performance\n--start\n');
  } finally { await rm(directory, { recursive: true, force: true }); await rm(moved, { recursive: true, force: true }); }
});
