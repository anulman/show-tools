import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OutputConflict, publishDirectory, publishReport } from './atomic-output.mjs';

test('a full output set publishes once and repeats without changing bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-publish-'));
  try {
    const output = join(root, 'reads'), files = new Map([['pose.txt', 'pose\n'], ['motion.txt', 'motion\n']]);
    await publishDirectory(output, files);
    await publishDirectory(output, new Map([...files].reverse()));
    assert.deepEqual((await readdir(output)).sort(), ['motion.txt', 'pose.txt']);
    assert.equal(await readFile(join(output, 'pose.txt'), 'utf8'), 'pose\n');
    assert.deepEqual(await readdir(root), ['reads']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a real write failure leaves no published partial directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-publish-'));
  try {
    await assert.rejects(publishDirectory(join(root, 'reads'), new Map([['a.txt', 'first file\n'], ['z'.repeat(1024), 'invalid filesystem name\n']])));
    assert.deepEqual(await readdir(root), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('conflicting directories and reports retain their previous complete contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-publish-'));
  try {
    const output = join(root, 'reads');
    await publishDirectory(output, new Map([['pose.txt', 'approved\n']]));
    await assert.rejects(publishDirectory(output, new Map([['pose.txt', 'changed\n']])), OutputConflict);
    assert.equal(await readFile(join(output, 'pose.txt'), 'utf8'), 'approved\n');
    const report = join(root, 'report.json');
    await publishReport(report, '{"status":"PASS"}\n');
    await publishReport(report, '{"status":"PASS"}\n');
    await assert.rejects(publishReport(report, '{"status":"FAIL"}\n'), OutputConflict);
    assert.equal(await readFile(report, 'utf8'), '{"status":"PASS"}\n');
    assert.deepEqual((await readdir(root)).sort(), ['reads', 'report.json']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('output symlinks and active locks never redirect or overwrite publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'figma-publish-'));
  try {
    const original = join(root, 'original'); await writeFile(original, 'keep\n');
    const alias = join(root, 'alias'); await symlink(original, alias);
    await assert.rejects(publishReport(alias, 'replace\n'), OutputConflict);
    assert.equal(await readFile(original, 'utf8'), 'keep\n');
    const lock = join(root, '.reads.figma-publish.lock'); await writeFile(lock, 'another writer\n');
    await assert.rejects(publishDirectory(join(root, 'reads'), new Map([['pose.txt', 'pose\n']])), error => error instanceof OutputConflict && error.reason === 'busy');
    assert.equal(await readFile(lock, 'utf8'), 'another writer\n');
  } finally { await rm(root, { recursive: true, force: true }); }
});
