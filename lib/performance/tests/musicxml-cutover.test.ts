import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMusicXmlSong, compileMusicXmlSong } from '../musicxml-song.js';
import { verifyMusicXmlCutover, frozenCutoverMusicXml } from '../../../scripts/verify-musicxml-cutover.js';

async function fixture(): Promise<string> {
  return readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8');
}

function removeField(xml: string, name: string): string {
  const field = new RegExp(`<miscellaneous-field name="${name}">[^]*?</miscellaneous-field>`, 'g');
  assert.match(xml, field, `Fixture must contain ${name} before removal.`);
  return xml.replace(field, '');
}

function removeAudit(xml: string): string {
  return removeField(removeField(xml, 'show-tools:source'), 'show-tools:mapping');
}

test('frozen DYC migration preserves pre-cutover compiled meaning, native bytes and every musician-sheet page', async () => {
  const result = await verifyMusicXmlCutover(await frozenCutoverMusicXml());
  assert.equal(result.bars, 218);
  assert.equal(result.cues, 62);
  assert.equal(result.takes, 12);
  assert.deepEqual(result.sheets, [{ name: 'Bass', pages: 4 }, { name: 'Drums', pages: 5 }]);
});

test('raw Sheets and mapping archives can be deleted without changing music or performance meaning', async () => {
  const xml = await fixture();
  const original = await readMusicXmlSong(xml), stripped = await readMusicXmlSong(removeAudit(xml));
  assert.deepEqual(stripped.song, original.song);
  assert.deepEqual(stripped.report, original.report);
  assert.equal(stripped.source, null);
  assert.equal(stripped.mapping, null);
});

test('standard MusicXML title edits drive the compiled chart and musician template without source JSON', async () => {
  const xml = removeAudit(await fixture());
  const edited = xml.replace(/<work-title>[^]*?<\/work-title>/, '<work-title>Canonical title edit</work-title>');
  assert.notEqual(edited, xml);
  const { song, report } = await readMusicXmlSong(edited);
  assert.equal(song.title, 'Canonical title edit');
  assert.equal(song.chart.title, 'Canonical title edit');
  assert.equal(report.title, 'Canonical title edit');
  const { createMusicianSheets } = await import('../musician-sheets.js');
  const sheets = await createMusicianSheets({ musicxml: edited });
  assert.ok(sheets.every(sheet => sheet.pages.every(page => page.includes('Canonical title edit'))));
});

test('standard MusicXML tempo edits drive compiled and printed tempo without source JSON', async () => {
  const xml = removeAudit(await fixture());
  const edited = xml.replace(/<per-minute>98<\/per-minute>/g, '<per-minute>102</per-minute>')
    .replace(/<sound tempo="98"/g, '<sound tempo="102"');
  assert.notEqual(edited, xml);
  const { song, report } = await readMusicXmlSong(edited);
  assert.equal(song.chart.bpm, 102);
  assert.equal(report.bpmPerChartCount, 102);
});

test('part names come from standard score-part declarations', async () => {
  const xml = removeAudit(await fixture());
  const edited = xml.replace('<part-name>Bass</part-name>', '<part-name>Electric bass</part-name>');
  assert.notEqual(edited, xml);
  const { report } = await readMusicXmlSong(edited);
  assert.equal(report.parts.find(part => part.labelCell === 'A14')?.name, 'Electric bass');
});

test('removing the application profile or performance instructions cannot silently produce an executable song', async () => {
  const xml = await fixture();
  await assert.rejects(compileMusicXmlSong(removeField(xml, 'show-tools:performance')));
  await assert.rejects(compileMusicXmlSong(removeField(xml, 'show-tools:profile')));
});

test('malformed XML, DTDs and unsupported MusicXML versions fail at the input boundary', async () => {
  const xml = await fixture();
  await assert.rejects(readMusicXmlSong(xml.slice(0, -100)));
  await assert.rejects(readMusicXmlSong(xml.replace(/<score-partwise/, '<!DOCTYPE score-partwise SYSTEM "file:///private/tmp/never-read.dtd"><score-partwise')));
  await assert.rejects(readMusicXmlSong(xml.replace('score-partwise version="4.0"', 'score-partwise version="9.0"')));
});

test('unsupported authored notation fails visibly instead of disappearing from the parsed song', async () => {
  const xml = await fixture();
  for (const notation of [
    '<direction><direction-type><dynamics><f/></dynamics></direction-type></direction>',
    '<direction><direction-type><wedge type="crescendo"/></direction-type></direction>',
    '<harmony><root><root-step>C</root-step></root><kind>major</kind></harmony>',
  ]) {
    const edited = xml.replace('<measure number="1">', `<measure number="1">${notation}`);
    assert.notEqual(edited, xml);
    await assert.rejects(readMusicXmlSong(edited));
  }
});

test('a displayed performance command cannot contradict its executable application instruction', async () => {
  const xml = await fixture();
  const edited = xml.replace('<words id="command-R1-2">crb</words>', '<words id="command-R1-2">xb</words>');
  assert.notEqual(edited, xml);
  await assert.rejects(readMusicXmlSong(edited));
});


test('every bundled song exposes the canonical instructions, metadata and source view', async () => {
  const { SONGS } = await import('../../../songs/index.js');
  const { musicXmlSourceView } = await import('../musicxml-source-view.js');
  for (const entry of SONGS) {
    const xml = await readFile(new URL(`../../../songs/${entry.id}.musicxml`, import.meta.url), 'utf8');
    const document = await readMusicXmlSong(xml);
    const { default: script } = await entry.load();
    assert.deepEqual(script.compiled, document.song.executable ? document.song : undefined);
    assert.deepEqual(script.chart, document.song.chart);
    assert.deepEqual(script.voiceMetadata, document.voices ?? undefined);
    assert.deepEqual(script.source, musicXmlSourceView(document));
    assert.equal(script.program.controls, undefined);
  }
});


test('displayed commands cannot silently enter the timing-only practice path', async () => {
  const { musicXmlSongScript } = await import('../../../songs/load-musicxml.js');
  const xml = await readFile(new URL('../../../songs/drunk-girls.musicxml', import.meta.url), 'utf8');
  const blank = await readMusicXmlSong(xml);
  assert.equal(musicXmlSongScript(blank).compiled, undefined);
  const edited = xml.replace('<measure number="1">', '<measure number="1"><direction><direction-type><words id="command-R1-1">rb</words></direction-type></direction>');
  const document = await readMusicXmlSong(edited);
  const script = musicXmlSongScript(document);
  assert.equal(script.chart.bars[0].cues.R1, 'rb');
  assert.equal(script.compiled?.executable, false);
});
