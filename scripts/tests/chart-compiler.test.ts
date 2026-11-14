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
import { parseCommandFailure } from '../lib/command-diagnostics.js';
import mapping from '../../songs/dance-yrself-clean.cutover.mapping.json';
import source from '../../songs/dance-yrself-clean.source.json';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';

const execute = promisify(execFile);
const root = new URL('../../', import.meta.url);
const run = (args: string[]) => execute(process.execPath, ['--import', 'tsx', 'scripts/show-tools.ts', 'chart', ...args], { cwd: root, maxBuffer: 1024 * 1024 });
async function rejectedCommand(args: string[]) {
  try { await run(args); }
  catch (error) {
    assert(error instanceof Error && 'code' in error && 'stdout' in error && 'stderr' in error);
    assert.equal(typeof error.stdout, 'string'); assert.equal(typeof error.stderr, 'string');
    return error;
  }
  assert.fail('Expected a rejected chart command');
}

test('chart CLI compiles the canonical DYC MusicXML into deterministic reviewable JSON and portable native bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-resolved-'));
  try {
    const first = join(directory, 'song.json'), second = join(directory, 'same.json'), native = join(directory, 'song.pfp');
    const inputs = ['--musicxml', 'songs/dance-yrself-clean.musicxml'];
    const result = await run(['compile', ...inputs, '--out', first]);
    await run(['encode', '--song', first, '--out', native]);
    assert.match(result.stdout, /capture 8:1\.\.13:1 \(20 counts\)/);
    const song = decodeCompiledSong(JSON.parse(await readFile(first, 'utf8')));
    assert.equal(song.executable, true);
    assert.deepEqual(new Uint8Array(await readFile(native)), compiledProgramBytes(song));
    const firstBytes = await readFile(native);
    await run(['encode', '--song', first, '--out', native]);
    assert.deepEqual(await readFile(native), firstBytes);
    await run(['compile', ...inputs, '--out', second]);
    assert.equal(await readFile(first, 'utf8'), await readFile(second, 'utf8'));
    assert.match((await run(['inspect', 'songs/dance-yrself-clean.musicxml'])).stdout, /Schema 7.*executable/);
    await assert.rejects(run(['compile', '--source', 'songs/dance-yrself-clean.source.json', '--out', first]), /Unknown or repeated chart option --source/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI preserves unresolved mapping diagnostics and cannot emit executable bytes for drafts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-'));
  try {
    const first = join(directory, 'first.json'), second = join(directory, 'second.json'), native = join(directory, 'song.pfp');
    const unresolved = join(directory, 'unresolved.musicxml');
    const { rotationRule, ...unresolvedMapping } = mapping;
    const imported = await importSheetMusicXml({ source, mapping: unresolvedMapping });
    await writeFile(unresolved, imported.xml);
    const inputs = ['--musicxml', unresolved];
    await assert.rejects(run(['compile', ...inputs, '--out', first]), /Compilation is blocked/);
    await assert.rejects(access(first));
    const result = await run(['compile', ...inputs, '--out', first, '--draft']);
    assert.match(result.stdout, /J21/);
    assert.match(result.stdout, /AE18/);
    const song = decodeCompiledSong(JSON.parse(await readFile(first, 'utf8')));
    assert.equal(song.executable, false);
    await run(['compile', ...inputs, '--out', second, '--draft']);
    assert.equal(await readFile(first, 'utf8'), await readFile(second, 'utf8'));
    const report = await run(['inspect', unresolved]);
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
    await assert.rejects(run(['compile', '--musicxml', 'songs/dance-yrself-clean.musicxml', '--out', output, '--native-out', native]), /chart encode/);
    assert.equal(await readFile(output, 'utf8'), 'last good song\n');
    assert.deepEqual((await readdir(directory)).sort(), ['occupied', 'song.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI reports unknown cells and preserves the last good output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-unknown-'));
  try {
    const sourcePath = join(directory, 'source.musicxml'), output = join(directory, 'song.json');
    const source = parseSongSource(JSON.parse(await readFile(new URL('../../songs/dance-yrself-clean.source.json', import.meta.url), 'utf8')));
    const values = source.values.map(row => [...row]);
    values[17][5] = 'not-a-cue';
    await writeFile(sourcePath, (await importSheetMusicXml({ source: { ...source, values }, mapping })).xml);
    await writeFile(output, 'last good song\n');
    await assert.rejects(run(['compile', '--musicxml', sourcePath, '--out', output]),
      error => error instanceof Error && 'stderr' in error && typeof error.stderr === 'string'
        && /unknown-cue/.test(error.stderr) && /#F18 "not-a-cue"/.test(error.stderr));
    const failure = await rejectedCommand(['compile', '--musicxml', sourcePath, '--out', output, '--json']);
    assert.equal(failure.code, 2);
    assert.equal(failure.stderr, '');
    assert.equal(typeof failure.stdout, 'string');
    const diagnostic = parseCommandFailure(JSON.parse(String(failure.stdout)));
    assert.equal(diagnostic.status, 'blocked');
    assert.equal(diagnostic.code, 'CHART_COMPILE_BLOCKED');
    assert(diagnostic.locations.some(location => location.includes('#F18 "not-a-cue"')));
    assert.equal(await readFile(output, 'utf8'), 'last good song\n');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI does not overwrite an input or another invocation’s temporary file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-input-'));
  try {
    const sourcePath = join(directory, 'source.musicxml'), output = join(directory, 'song.json');
    const source = await readFile(new URL('../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8');
    await writeFile(sourcePath, source);
    const inputs = ['--musicxml', sourcePath];
    await assert.rejects(run(['compile', ...inputs, '--out', sourcePath]), /input|source/i);
    assert.equal(await readFile(sourcePath, 'utf8'), source);
    const hardlink = join(directory, 'hardlink.json'), symbolic = join(directory, 'symbolic.json');
    await link(sourcePath, hardlink);
    await symlink(sourcePath, symbolic);
    for (const alias of [hardlink, symbolic]) await assert.rejects(run(['compile', ...inputs, '--out', alias]), /input file/);
    const unrelated = `${output}.${process.pid}.tmp`;
    await writeFile(unrelated, 'another invocation');
    await runChartCompiler(['compile', ...inputs, '--out', output], () => {});
    assert.equal(await readFile(unrelated, 'utf8'), 'another invocation');
    assert.equal(decodeCompiledSong(JSON.parse(await readFile(output, 'utf8'))).executable, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI JSON failures distinguish invalid inputs and provide next steps without replacing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-json-'));
  try {
    const input = join(directory, 'input.json'), output = join(directory, 'song.pfp');
    await writeFile(output, 'last good native');
    for (const [content, code] of [['{secret-invalid-json', 'CHART_INPUT_JSON'], ['{}', 'CHART_INPUT_SCHEMA']]) {
      await writeFile(input, content);
      const result = await rejectedCommand(['encode', '--song', input, '--out', output, '--json']);
      assert.equal(result.code, 2); assert.equal(result.stderr, '');
      const failure = parseCommandFailure(JSON.parse(String(result.stdout)));
      assert.equal(failure.code, code); assert.equal(failure.status, 'blocked');
      assert.deepEqual(failure.locations, [input]);
      assert(failure.nextSteps.length > 0);
      assert(!String(result.stdout).includes('secret-invalid-json'));
      assert.equal(await readFile(output, 'utf8'), 'last good native');
    }
    const result = await rejectedCommand(['encode', '--song', join(directory, 'missing'), '--out', output, '--json']);
    assert.equal(parseCommandFailure(JSON.parse(String(result.stdout))).code, 'CHART_FILE_ACCESS');
    const invalidUrl = await rejectedCommand(['fetch', '--url', 'invalid-private-url', '--out', output, '--json']);
    assert.equal(invalidUrl.code, 2);
    const failure = parseCommandFailure(JSON.parse(String(invalidUrl.stdout)));
    assert.equal(failure.code, 'CHART_WORKSHEET_URL');
    assert(!String(invalidUrl.stdout).includes('invalid-private-url'));
    assert.equal(await readFile(output, 'utf8'), 'last good native');
    await writeFile(input, JSON.stringify({ ...mapping, titleCell: 'bad-cell' }));
    const invalidMapping = await rejectedCommand(['musicxml', '--source', 'songs/dance-yrself-clean.source.json', '--mapping', input, '--out-dir', join(directory, 'invalid-import'), '--json']);
    assert.equal(invalidMapping.code, 2);
    assert.equal(parseCommandFailure(JSON.parse(String(invalidMapping.stdout))).code, 'CHART_MAPPING_CELL');
    assert.equal(await readFile(output, 'utf8'), 'last good native');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('chart CLI hands unexpected tooling failures to Chief without leaking error content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-chief-'));
  try {
    const script = join(directory, 'failure.mts'), output = join(directory, 'song.json');
    await writeFile(output, 'last good song');
    const args = ['chart', 'compile', '--musicxml', 'songs/dance-yrself-clean.musicxml', '--out', output, '--json'];
    await writeFile(script, `import { main } from ${JSON.stringify(new URL('../show-tools.ts', import.meta.url).href)};\nObject.defineProperty(crypto.subtle, 'digest', { value() { throw new Error('SECRET unexpected digest failure'); } });\nawait main(${JSON.stringify(args)});\n`);
    await assert.rejects(execute(process.execPath, ['--import', 'tsx', script], { cwd: root }), error => {
      assert(error instanceof Error && 'code' in error && 'stdout' in error && 'stderr' in error);
      assert.equal(error.code, 3); assert.equal(error.stderr, '');
      const failure = parseCommandFailure(JSON.parse(String(error.stdout)));
      assert.equal(failure.status, 'needs-chief');
      assert.equal(failure.code, 'CHART_COMMAND_FAILED');
      assert(!String(error.stdout).includes('SECRET'));
      return true;
    });
    assert.equal(await readFile(output, 'utf8'), 'last good song');
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
    await run(['compile', '--musicxml', 'songs/dance-yrself-clean.musicxml', '--out', song]);
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
    const args = ['compile', '--musicxml', 'songs/dance-yrself-clean.musicxml', '--out', output];
    await Promise.all([run(args), run(args)]);
    assert.equal(decodeCompiledSong(JSON.parse(await readFile(output, 'utf8'))).executable, true);
    assert.deepEqual(await readdir(directory), ['song.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('chart CLI classifies invalid canonical MusicXML as product input without replacing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'show-tools-chart-xml-input-'));
  try {
    const input = join(directory, 'input.musicxml'), output = join(directory, 'song.json');
    await writeFile(output, 'last good song');
    for (const contents of ['<broken', '<score-partwise version="4.0"/>']) {
      await writeFile(input, contents);
      const result = await rejectedCommand(['compile', '--musicxml', input, '--out', output, '--json']);
      assert.equal(result.code, 2);
      assert.equal(result.stderr, '');
      const failure = parseCommandFailure(JSON.parse(String(result.stdout)));
      assert.equal(failure.code, 'CHART_INPUT_MUSICXML');
      assert.deepEqual(failure.locations, [input]);
      assert.equal(await readFile(output, 'utf8'), 'last good song');
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
