import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeCompiledSong } from '../../lib/performance/compiled-song.js';

const execute = promisify(execFile);
const root = new URL('../../', import.meta.url);
const run = (args: string[]) => execute(process.execPath, ['--import', 'tsx', 'scripts/show-tools.ts', 'chart', ...args], { cwd: root, maxBuffer: 1024 * 1024 });

test('chart CLI preserves blocked diagnostics, emits deterministic drafts, and never emits an executable for unresolved DYC', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-'));
  try {
    const first = join(directory, 'first.json'), second = join(directory, 'second.json'), native = join(directory, 'song.pfp');
    const inputs = ['--source', 'songs/dance-yrself-clean.source.json', '--mapping', 'songs/dance-yrself-clean.mapping.json'];
    await assert.rejects(run(['compile', ...inputs, '--out', first]), /Compilation is blocked/);
    await assert.rejects(access(first));
    const result = await run(['compile', ...inputs, '--out', first, '--draft']);
    assert.match(result.stdout, /J21/);
    assert.match(result.stdout, /AE18/);
    const song = decodeCompiledSong(JSON.parse(await readFile(first, 'utf8')));
    assert.equal(song.executable, false);
    await run(['compile', ...inputs, '--out', second, '--draft']);
    assert.equal(await readFile(first, 'utf8'), await readFile(second, 'utf8'));
    const report = await run(['inspect', first]);
    assert.match(report.stdout, /BLOCKED/);
    await assert.rejects(run(['compile', ...inputs, '--out', second, '--native-out', native, '--draft']), /Draft inspection cannot emit/);
    await assert.rejects(access(native));
    await assert.rejects(run(['compile', ...inputs, '--out', second, '--out', first]), /repeated chart option/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
