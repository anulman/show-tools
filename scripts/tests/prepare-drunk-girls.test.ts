import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readMusicXmlSong } from '../../lib/performance/musicxml-song.js';

const execute = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));

test('DG preparation reproduces canonical MusicXML and never replaces an input or publishes a blocked chart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prepare-drunk-girls-'));
  try {
    const canonical = await readFile(new URL('../../songs/drunk-girls.musicxml', import.meta.url), 'utf8');
    const document = await readMusicXmlSong(canonical);
    assert(document.source);
    const sourcePath = join(directory, 'source.json');
    const input = JSON.stringify(document.source);
    await writeFile(sourcePath, input);
    const prepare = (output: string) => execute(process.execPath, ['--import', 'tsx', 'scripts/prepare-drunk-girls.ts', sourcePath, output], { cwd: root });
    const output = join(directory, 'score.musicxml');
    await prepare(output);
    assert.equal(await readFile(output, 'utf8'), canonical);
    await assert.rejects(prepare(output), /EEXIST/);
    assert.equal(await readFile(output, 'utf8'), canonical);
    await assert.rejects(prepare(sourcePath), /EEXIST/);
    assert.equal(await readFile(sourcePath, 'utf8'), input);
    const values = document.source.values.map(row => [...row]);
    values[23][12] = 'not-a-cue';
    await writeFile(sourcePath, JSON.stringify({ ...document.source, values }));
    const blocked = join(directory, 'blocked.musicxml');
    await assert.rejects(prepare(blocked), /unknown-cue/);
    assert.deepEqual((await readdir(directory)).sort(), ['score.musicxml', 'source.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
