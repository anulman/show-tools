import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, access, rm, chmod, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { verifyMusicianCoverage, runMusicianPackages } from '../../../scripts/build-musician-packages.js';
import { createMusicianChart } from '../musician-sheets.js';

const input = () => readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8');
const none = { kind: 'none' };
const drums = { kind: 'parts', parts: [{ labelCell: 'A15', name: 'Drums' }] };
async function fixture(directory: string, instruments: Record<'drums' | 'bass' | 'keys' | 'guitar', typeof drums | typeof none> = { drums, bass: none, keys: none, guitar: none }) {
  const source = await input();
  await writeFile(join(directory, 'song.musicxml'), source);
  const spec = { schemaVersion: 2, songs: [{ id: 'dance-yrself-clean', musicxml: 'song.musicxml', sha256: createHash('sha256').update(source).digest('hex'), instruments: structuredClone(instruments) }] };
  await writeFile(join(directory, 'spec.json'), JSON.stringify(spec));
  return spec;
}
async function withFixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'musician-package-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('absent musicians produce no chart, package or PDF and require no interpreter', async () => withFixture(async directory => {
  assert.equal(await createMusicianChart({ musicxml: await input(), instrument: 'Keys', parts: [] }), null);
  await fixture(directory, { drums: none, bass: none, keys: none, guitar: none });
  const output = join(directory, 'output');
  await runMusicianPackages(['--spec', join(directory, 'spec.json'), '--out-dir', output, '--python', '/no/interpreter']);
  assert.deepEqual((await readdir(output)).sort(), ['index.html', 'manifest.json']);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.sheets.length, 0); assert.equal(manifest.skipped.length, 4);
}));

test('preview packages do not invoke a PDF interpreter and retain explicit source identities', async () => withFixture(async directory => {
  await fixture(directory);
  const output = join(directory, 'output');
  await runMusicianPackages(['--spec', join(directory, 'spec.json'), '--out-dir', output, '--format', 'preview', '--python', '/no/interpreter']);
  const manifest = JSON.parse(await readFile(join(output, 'manifest.json'), 'utf8'));
  assert.equal(manifest.format, 'preview'); assert.equal(manifest.sheets.length, 1); assert.equal(manifest.sheets[0].pdf, null);
  assert.deepEqual(manifest.sheets[0].voices.map((voice: { labelCell: string }) => voice.labelCell), ['A15']);
  assert.equal((await readdir(join(output, 'drums', 'dance-yrself-clean'))).some(name => name.endsWith('.pdf')), false);
  await assert.rejects(access(join(output, 'keys'))); await assert.rejects(access(join(output, 'guitar.zip')));
  assert(!((await readFile(join(output, 'drums', 'index.html'), 'utf8')).includes('>PDF</a>')));
  const extracted = join(output, 'drums', 'drums-spec.json');
  await runMusicianPackages(['--spec', extracted, '--out-dir', join(directory, 'repeat'), '--instrument', 'drums', '--format', 'preview']);
}));

test('source changes and missing named parts reject before output publication', async () => withFixture(async directory => {
  const spec = await fixture(directory); spec.songs[0].sha256 = '0'.repeat(64);
  await writeFile(join(directory, 'spec.json'), JSON.stringify(spec));
  const args = ['--spec', join(directory, 'spec.json'), '--out-dir', join(directory, 'output'), '--format', 'preview'];
  await assert.rejects(runMusicianPackages(args), /Canonical input changed/);
  await assert.rejects(access(join(directory, 'output')));
  const current = await fixture(directory); const selection = current.songs[0].instruments.drums; assert('parts' in selection); selection.parts[0].name = 'Wrong name';
  await writeFile(join(directory, 'spec.json'), JSON.stringify(current));
  await assert.rejects(runMusicianPackages(args), /part|row|name/i);
  await assert.rejects(access(join(directory, 'output')));
}));

test('old form specs fail rather than silently regenerate uncharted worksheets', async () => withFixture(async directory => {
  const spec = await fixture(directory);
  await writeFile(join(directory, 'spec.json'), JSON.stringify({ ...spec, schemaVersion: 1 }));
  await assert.rejects(runMusicianPackages(['--spec', join(directory, 'spec.json'), '--out-dir', join(directory, 'output'), '--format', 'preview']));
  await assert.rejects(access(join(directory, 'output')));
}));

test('coverage rejects duplicate or missing chronological bars independently of source labels', async () => {
  const sheet = await createMusicianChart({ musicxml: await input(), instrument: 'Drums', parts: drums.parts }); assert(sheet);
  verifyMusicianCoverage(sheet, 218);
  assert.throws(() => verifyMusicianCoverage({ ...sheet, pages: sheet.pages.map(page => page.replace(/data-bar="[0-9]+"/, 'data-bar="9999"')) }, 218), /Incomplete or duplicate/);
});

test('failed final index publication cannot leave a completed package marker', async () => withFixture(async directory => {
  await fixture(directory);
  const output = join(directory, 'output'), interpreter = join(directory, 'renderer-fixture');
  await writeFile(interpreter, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== '-c') {
  fs.writeFileSync(args[args.indexOf('--output') + 1], 'fixture output');
  fs.writeFileSync(${JSON.stringify(join(output, 'index.html'))}, 'blocked final index');
}
`);
  await chmod(interpreter, 0o700);
  await assert.rejects(runMusicianPackages(['--spec', join(directory, 'spec.json'), '--out-dir', output, '--instrument', 'drums', '--python', interpreter]), { code: 'EEXIST' });
  assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'blocked final index');
  await access(join(output, 'drums.zip'));
  await assert.rejects(access(join(output, 'manifest.json')), { code: 'ENOENT' });
}));
