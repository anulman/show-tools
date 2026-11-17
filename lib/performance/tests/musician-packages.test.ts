import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, access, rm, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { XMLValidator } from 'fast-xml-parser';
import { createMusicianFormSheet, createMusicianSheets } from '../musician-sheets.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { verifyMusicianCoverage, runMusicianPackages } from '../../../scripts/build-musician-packages.js';

const input = (slug: string) => readFile(new URL(`../../../songs/${slug}.musicxml`, import.meta.url), 'utf8');

test('missing instrument forms preserve every bar and lyrics without inventing rests or a source row', async () => {
  const sheet = await createMusicianFormSheet({ musicxml: await input('dance-yrself-clean'), instrument: 'Keys' });
  assert.equal(sheet.kind, 'uncharted-form'); assert(!('labelCell' in sheet));
  assert.equal(sheet.pages.length, 6); assert.deepEqual(sheet.condensation.rests, []);
  assert(sheet.pages.every(page => page.includes('Keys part uncharted') && !page.includes('data-rest-start')));
  assert(sheet.xml.includes('Walking up to me expecting...'));
  assert(sheet.pages.join('').includes('Walking up to me'));
  verifyMusicianCoverage(sheet, 218);
  assert.equal(XMLValidator.validate(sheet.xml), true);
  assert(sheet.xml.includes('form-projection'));
  assert(sheet.xml.includes('name="show-tools:selected-label-cells">[]'));
  assert.equal((sheet.xml.match(/<note print-object="no">/g) ?? []).length, 218);
  assert.throws(() => verifyMusicianCoverage({ ...sheet, pages: sheet.pages.map((page, index) => index ? page : page.replace('data-bar="1"', 'data-bar="2"')) }, 218), /Incomplete or duplicate/);
});

test('Drunk Girls handouts preserve source Pickup labels, Higher intensity ranges and uncounted tails', async () => {
  const document = await readMusicXmlSong(await input('drunk-girls')); assert(document.source);
  const fresh = await importSheetMusicXml({ source: document.source, mapping: document.mapping });
  const sheets = await createMusicianSheets({ musicxml: fresh.xml, selectedRows: [15, 18] });
  for (const sheet of sheets) {
    verifyMusicianCoverage(sheet, 137); assert.equal(XMLValidator.validate(sheet.xml), true);
    assert(sheet.xml.includes('<measure number="Pickup 0">')); assert(sheet.xml.includes('<measure number="128">'));
    assert(sheet.pages.at(-1)?.includes('Tail (uncounted): 1'));
    assert.equal((sheet.xml.match(/<measure /g) ?? []).length, 137);
    const page = sheet.pages[0];
    const cueX = Number(/data-vocal-bar="9"[^>]*>.*?<text x="([0-9.]+)"/s.exec(page)?.[1]);
    const labelX = Number(/data-bar="9"><text x="([0-9.]+)"/.exec(page)?.[1]);
    assert(cueX - labelX >= 32, 'Pickup 8 and its vocal cue must not overlap');
  }
  const bass = sheets.find(sheet => sheet.labelCell === 'A15'); assert(bass);
  const pages = bass.pages.join(''); assert(pages.includes('Higher intensity'));
  assert(!pages.includes('Higher intensity, bars 90-97'), 'feel ranges use source labels rather than chronology ordinals');
});

test('named bass synth parts retain bass clefs', async () => {
  const document = await readMusicXmlSong(await input('dance-yrself-clean')); assert(document.source);
  const values = document.source.values.map(row => [...row]); values[13][0] = 'Bass - Alien Synth';
  const fresh = await importSheetMusicXml({ source: { ...document.source, values }, mapping: document.mapping });
  const [sheet] = await createMusicianSheets({ musicxml: fresh.xml, selectedRows: [14] });
  assert(sheet.xml.includes('<sign>F</sign><line>4</line>')); assert.equal(sheet.name, 'Bass - Alien Synth');
});

test('changed canonical inputs reject before publishing files or invoking the PDF interpreter', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'musician-package-rejection-'));
  try {
    await writeFile(join(directory, 'song.musicxml'), await input('dance-yrself-clean'));
    await writeFile(join(directory, 'spec.json'), JSON.stringify({ schemaVersion: 1, songs: [{ id: 'dance-yrself-clean', musicxml: 'song.musicxml', sha256: '0'.repeat(64),
      instruments: { drums: { kind: 'form' }, bass: { kind: 'form' }, keys: { kind: 'form' } } }] }));
    await assert.rejects(runMusicianPackages(['--spec', join(directory, 'spec.json'), '--out-dir', join(directory, 'output'), '--python', '/nonexistent/no-pdf-spawn']), /Canonical input changed/);
    await assert.rejects(access(join(directory, 'output')));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('failed final index publication cannot leave a completed package marker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'musician-package-index-failure-'));
  try {
    const source = await input('dance-yrself-clean'), output = join(directory, 'output');
    await writeFile(join(directory, 'song.musicxml'), source);
    await writeFile(join(directory, 'spec.json'), JSON.stringify({ schemaVersion: 1, songs: [{ id: 'dance-yrself-clean', musicxml: 'song.musicxml',
      sha256: createHash('sha256').update(source).digest('hex'), instruments: { drums: { kind: 'form' }, bass: { kind: 'form' }, keys: { kind: 'form' } } }] }));
    const interpreter = join(directory, 'renderer-fixture');
    await writeFile(interpreter, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] !== '-c') {
  fs.writeFileSync(args[args.indexOf('--output') + 1], 'fixture PDF');
  fs.writeFileSync(${JSON.stringify(join(output, 'index.html'))}, 'blocked final index');
}
`);
    await chmod(interpreter, 0o700);
    await assert.rejects(runMusicianPackages(['--spec', join(directory, 'spec.json'), '--out-dir', output, '--instrument', 'drums', '--python', interpreter]), { code: 'EEXIST' });
    assert.equal(await readFile(join(output, 'index.html'), 'utf8'), 'blocked final index');
    await access(join(output, 'drums.zip'));
    await assert.rejects(access(join(output, 'manifest.json')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
