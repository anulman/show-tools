import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runCadCandidate } from '../candidate-command.js';
import { parseCommandFailure } from '../../../scripts/lib/command-diagnostics.js';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../candidate-command.ts');
const root = resolve(here, '../../..');

function fixture(raw: string) {
  const directory = mkdtempSync(join(tmpdir(), 'cad-command-protocol-'));
  const executable = join(directory, 'protocol-fixture');
  const quoted = "'" + raw.replaceAll("'", "'\\''") + "'";
  writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' ${quoted}\n`, { mode: 0o700 });
  return { directory, executable, output: join(directory, 'new-trial') };
}

function cli(args: readonly string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', entry, ...args], { cwd: root, encoding: 'utf8' });
}

test('invalid request is an operator block without invoking a Python runtime', () => {
  const result = runCadCandidate({ recipe: 'unregistered-model', python: '/no/runtime', output: '/unused/output' });
  assert.equal(result.status, 'blocked');
  if (result.status === 'blocked') assert.equal(result.code, 'CAD_INPUT_INVALID');
});

test('help describes explicit inputs without requiring a CAD runtime', () => {
  const child = cli(['--help']);
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.match(child.stdout, /--python/);
  assert.match(child.stdout, /No publication or service discovery/);
});

test('missing Python is a Chief handoff, not a product input failure', () => {
  const result = runCadCandidate({ recipe: 'measured-hex-joint', python: '/no/such/cad-python', output: '/unused/output' });
  assert.equal(result.status, 'needs-chief');
});

test('JSON product failure is exactly one shared result with cause and next steps', t => {
  const f = fixture(JSON.stringify({ protocol: 1, kind: 'gate-failed', stage: 'validation', cause: 'Hex allowance below the declared minimum.' }));
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const child = cli(['measured-hex-joint', '--python', f.executable, '--output', f.output, '--json']);
  assert.equal(child.status, 2);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.trim().split('\n').length, 1);
  const failure = parseCommandFailure(JSON.parse(child.stdout));
  assert.equal(failure.status, 'blocked');
  assert.match(failure.message, /Hex allowance/);
  assert.ok(failure.nextSteps.length > 0);
});

test('human failure explains the operator action on stderr without a stack', t => {
  const f = fixture(JSON.stringify({ protocol: 1, kind: 'gate-failed', stage: 'input', cause: 'The output already exists.' }));
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const child = cli(['measured-hex-joint', '--python', f.executable, '--output', f.output]);
  assert.equal(child.status, 2);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /output already exists/);
  assert.match(child.stderr, /Next steps:/);
  assert.doesNotMatch(child.stderr, /\n\s+at /);
});

test('unknown bridge output and false success cannot bypass actual receipt verification', t => {
  for (const reply of ['not JSON', JSON.stringify({ protocol: 1, kind: 'validated', recipe: 'measured-hex-joint', receipt: { path: '/missing/receipt.json', sha256: '0'.repeat(64) } })]) {
    const f = fixture(reply);
    t.after(() => rmSync(f.directory, { recursive: true, force: true }));
    const result = runCadCandidate({ recipe: 'measured-hex-joint', python: f.executable, output: f.output });
    assert.equal(result.status, 'needs-chief');
    if (result.status === 'needs-chief') assert.equal(result.code, 'CAD_PROTOCOL_INVALID');
  }
});

test('unexpected bridge exception routes to Chief with no raw stack or secret text', t => {
  const f = fixture(JSON.stringify({ protocol: 1, kind: 'execution-failed', stage: 'runtime', cause: 'ModuleNotFoundError' }));
  t.after(() => rmSync(f.directory, { recursive: true, force: true }));
  const child = cli(['measured-hex-joint', '--python', f.executable, '--output', f.output, '--json']);
  assert.equal(child.status, 3);
  const failure = parseCommandFailure(JSON.parse(child.stdout));
  assert.equal(failure.status, 'needs-chief');
  assert.match(failure.message, /ModuleNotFoundError/);
});

test('publication and discovery requests require Chief without executing them', () => {
  for (const command of ['publish', 'discover']) {
    const child = cli([command, '--json']);
    assert.equal(child.status, 3);
    const failure = parseCommandFailure(JSON.parse(child.stdout));
    assert.equal(failure.code, 'CAD_INFRASTRUCTURE_MANUAL');
  }
});
