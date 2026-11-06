import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(new URL('./verify.ts', import.meta.url));
function fixture(run: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'capture-runner-negative-'));
  try { run(directory); } finally { rmSync(directory, { recursive: true }); }
}

test('an existing explicit result directory is never adopted or overwritten', () => fixture(directory => {
  const output = join(directory, 'occupied');
  mkdirSync(output); writeFileSync(join(output, 'receipt.json'), 'prior result');
  const result = spawnSync(process.execPath, [entry, '--out', output], { encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /EEXIST/);
  assert.equal(readFileSync(join(output, 'receipt.json'), 'utf8'), 'prior result');
  assert.deepEqual(readdirSync(output), ['receipt.json']);
}));

test('a relative output is rejected before publication', () => fixture(directory => {
  const result = spawnSync(process.execPath, [entry, '--out', 'relative-result'], { cwd: directory, encoding: 'utf8' });
  assert.notEqual(result.status, 0); assert.match(result.stderr, /new absolute directory/);
  assert.deepEqual(readdirSync(directory), []);
}));

test('missing Java and a wrong TLC jar fail before model or compiler execution', () => fixture(directory => {
  const missing = { ...process.env }; delete missing.JAVA;
  const missingOutput = join(directory, 'missing');
  const first = spawnSync(process.execPath, [entry, '--out', missingOutput], { env: missing, encoding: 'utf8' });
  assert.notEqual(first.status, 0); assert.match(first.stderr, /Set JAVA/);
  assert.deepEqual(readdirSync(missingOutput), []);
  const jar = join(directory, 'wrong.jar'); writeFileSync(jar, 'not the pinned jar');
  const wrongOutput = join(directory, 'wrong');
  const second = spawnSync(process.execPath, [entry, '--out', wrongOutput], {
    env: { ...process.env, JAVA: process.execPath, TLA2TOOLS: jar, CXX: '/missing-compiler' }, encoding: 'utf8',
  });
  assert.notEqual(second.status, 0); assert.match(second.stderr, /TLC jar differs from pinned/);
  assert.deepEqual(readdirSync(wrongOutput), []);
}));
