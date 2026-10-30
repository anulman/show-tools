import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, access, rm, mkdir, readdir, link, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeCompiledSong } from '../../lib/performance/compiled-song.js';
import { compiledProgramBytes } from '../../lib/performance/compiled-native.js';
import { parseSongSource } from '../../lib/performance/song-source.js';
import { runChartCompiler } from '../chart-compiler.js';
import mapping from '../../songs/dance-yrself-clean.mapping.json';

const execute = promisify(execFile);
const root = new URL('../../', import.meta.url);
const run = (args: string[]) => execute(process.execPath, ['--import', 'tsx', 'scripts/show-tools.ts', 'chart', ...args], { cwd: root, maxBuffer: 1024 * 1024 });

test('chart CLI compiles the actual DYC source into deterministic reviewable JSON and portable native bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-resolved-'));
  try {
    const first = join(directory, 'song.json'), second = join(directory, 'same.json'), native = join(directory, 'song.pfp');
    const inputs = ['--source', 'songs/dance-yrself-clean.source.json', '--mapping', 'songs/dance-yrself-clean.mapping.json'];
    const result = await run(['compile', ...inputs, '--out', first]);
    await run(['encode', '--song', first, '--out', native]);
    assert.match(result.stdout, /capture 7:1\.\.8:3 \(6 counts\).*rest 8:3\.\.9:1 \(2 counts, zero source\).*loop 7:1\.\.9:1 \(8 counts\)/);
    const song = decodeCompiledSong(JSON.parse(await readFile(first, 'utf8')));
    assert.equal(song.executable, true);
    assert.deepEqual(new Uint8Array(await readFile(native)), compiledProgramBytes(song));
    const firstBytes = await readFile(native);
    await run(['encode', '--song', first, '--out', native]);
    assert.deepEqual(await readFile(native), firstBytes);
    await run(['compile', ...inputs, '--out', second]);
    assert.equal(await readFile(first, 'utf8'), await readFile(second, 'utf8'));
    assert.match((await run(['inspect', first])).stdout, /Schema 5.*executable/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI preserves unresolved mapping diagnostics and cannot emit executable bytes for drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-'));
  try {
    const first = join(directory, 'first.json'), second = join(directory, 'second.json'), native = join(directory, 'song.pfp');
    const unresolved = join(directory, 'unresolved-mapping.json');
    await writeFile(unresolved, JSON.stringify({ ...mapping, rotationRule: undefined }));
    const inputs = ['--source', 'songs/dance-yrself-clean.source.json', '--mapping', unresolved];
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
    await assert.rejects(run(['encode', '--song', second, '--out', native]), /Native encoding is blocked/);
    await assert.rejects(access(native));
    await assert.rejects(run(['compile', ...inputs, '--out', second, '--out', first]), /repeated chart option/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI rejects the removed dual-output option before replacing any artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-publication-'));
  try {
    const output = join(directory, 'song.json'), native = join(directory, 'occupied');
    await writeFile(output, 'last good song\n');
    await mkdir(native);
    await assert.rejects(run(['compile', '--source', 'songs/dance-yrself-clean.source.json',
      '--mapping', 'songs/dance-yrself-clean.mapping.json', '--out', output, '--native-out', native]), /chart encode/);
    assert.equal(await readFile(output, 'utf8'), 'last good song\n');
    assert.deepEqual((await readdir(directory)).sort(), ['occupied', 'song.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI reports unknown cells and preserves the last good output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-unknown-'));
  try {
    const sourcePath = join(directory, 'source.json'), output = join(directory, 'song.json');
    const source = parseSongSource(JSON.parse(await readFile(new URL('../../songs/dance-yrself-clean.source.json', import.meta.url), 'utf8')));
    const values = source.values.map(row => [...row]);
    values[17][5] = 'not-a-cue';
    await writeFile(sourcePath, JSON.stringify({ ...source, values }));
    await writeFile(output, 'last good song\n');
    await assert.rejects(run(['compile', '--source', sourcePath, '--mapping', 'songs/dance-yrself-clean.mapping.json', '--out', output]),
      error => error instanceof Error && 'stdout' in error && typeof error.stdout === 'string'
        && /unknown-cue\s+F18\s+"not-a-cue"/.test(error.stdout));
    assert.equal(await readFile(output, 'utf8'), 'last good song\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI does not overwrite an input or another invocation’s temporary file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-input-'));
  try {
    const sourcePath = join(directory, 'source.json'), output = join(directory, 'song.json');
    const source = await readFile(new URL('../../songs/dance-yrself-clean.source.json', import.meta.url), 'utf8');
    await writeFile(sourcePath, source);
    const inputs = ['--source', sourcePath, '--mapping', 'songs/dance-yrself-clean.mapping.json'];
    await assert.rejects(run(['compile', ...inputs, '--out', sourcePath]), /input|source/i);
    assert.equal(await readFile(sourcePath, 'utf8'), source);
    const hardlink = join(directory, 'hardlink.json'), symbolic = join(directory, 'symbolic.json');
    await link(sourcePath, hardlink);
    await symlink(sourcePath, symbolic);
    for (const alias of [hardlink, symbolic]) await assert.rejects(run(['compile', ...inputs, '--out', alias]), /input file/);
    const unrelated = `${output}.${process.pid}.tmp`;
    await writeFile(unrelated, 'another invocation');
    await runChartCompiler(['compile', ...inputs, '--out', output]);
    assert.equal(await readFile(unrelated, 'utf8'), 'another invocation');
    assert.equal(decodeCompiledSong(JSON.parse(await readFile(output, 'utf8'))).executable, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI preserves native bytes for malformed input and cleans up failed publication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-native-'));
  try {
    const song = join(directory, 'song.json'), native = join(directory, 'song.pfp'), occupied = join(directory, 'occupied');
    await writeFile(song, '{broken');
    await writeFile(native, 'last good native');
    await assert.rejects(run(['encode', '--song', song, '--out', native]));
    assert.equal(await readFile(native, 'utf8'), 'last good native');
    await run(['compile', '--source', 'songs/dance-yrself-clean.source.json', '--mapping', 'songs/dance-yrself-clean.mapping.json', '--out', song]);
    await mkdir(occupied);
    await writeFile(join(occupied, 'keep'), 'unrelated');
    await assert.rejects(run(['encode', '--song', song, '--out', occupied]));
    assert.equal(await readFile(join(occupied, 'keep'), 'utf8'), 'unrelated');
    assert.deepEqual((await readdir(directory)).sort(), ['occupied', 'song.json', 'song.pfp']);
    await assert.rejects(run(['encode', '--song', song, '--out', song]), /input file/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI concurrent builds publish a complete decodable output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-concurrent-'));
  try {
    const output = join(directory, 'song.json');
    const args = ['compile', '--source', 'songs/dance-yrself-clean.source.json', '--mapping', 'songs/dance-yrself-clean.mapping.json', '--out', output];
    await Promise.all([run(args), run(args)]);
    assert.equal(decodeCompiledSong(JSON.parse(await readFile(output, 'utf8'))).executable, true);
    assert.deepEqual(await readdir(directory), ['song.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
