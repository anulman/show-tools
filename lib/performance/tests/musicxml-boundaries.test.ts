import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readMusicXmlSong, writeMusicXmlSong } from '../musicxml-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { decodeSongMapping } from '../compiled-song.js';

async function guitarChart() {
  const original = await readMusicXmlSong(await readFile(new URL('../../../songs/drunk-girls.musicxml', import.meta.url), 'utf8'));
  assert.ok(original.source && original.mapping);
  return { original, source: original.source, mapping: decodeSongMapping(original.mapping) };
}

function withoutArchive(xml: string): string {
  return xml.replace(/<miscellaneous-field name="show-tools:(?:source|mapping)">[^]*?<\/miscellaneous-field>/g, '');
}

test('real Drunk Girls tail survives import, archive-free reading and rewriting without extra measures', async () => {
  const { source, mapping, original } = await guitarChart();
  const imported = await importSheetMusicXml({ source, mapping });
  const document = await readMusicXmlSong(withoutArchive(imported.xml));
  assert.equal(document.source, null);
  assert.equal(document.mapping, null);
  assert.equal(document.report.measureCount, 137);
  assert.equal(document.report.measureCount, original.report.measureCount);
  assert.deepEqual(document.report.annotations.boundaryCues, [
    { partId: 'PA10', cell: 'EK10', position: 'tail', text: 'ugh' },
    { partId: 'PA15', cell: 'EK15', position: 'tail', text: '1' },
    { partId: 'PA18', cell: 'EK18', position: 'tail', text: '1' },
  ]);
  assert.match(imported.xml, /<words id="boundary-tail-EK15">1<\/words><\/direction-type><offset>3840<\/offset>/);
  const rewritten = await writeMusicXmlSong({ song: document.song, report: document.report });
  assert.deepEqual((await readMusicXmlSong(rewritten)).report, document.report);
});

test('literal lead-in and tail cues retain source identity and full text at both boundaries', async () => {
  const { source, mapping } = await guitarChart();
  const values = source.values.map(row => [...row]);
  values[14][2] = '  4& pickup  ';
  const imported = await importSheetMusicXml({ source: { ...source, values }, mapping });
  const report = (await readMusicXmlSong(withoutArchive(imported.xml))).report;
  assert.deepEqual(report.annotations.boundaryCues?.filter(cue => cue.partId === 'PA15'), [
    { partId: 'PA15', cell: 'C15', position: 'lead-in', text: '  4& pickup  ' },
    { partId: 'PA15', cell: 'EK15', position: 'tail', text: '1' },
  ]);
  assert.equal(report.parts.find(part => part.id === 'PA15')?.cells.length, 137);
});

test('Higher intensity is a separate whole-bar human-instrument feel and does not reinterpret AF Guitar', async () => {
  const { source, mapping } = await guitarChart();
  const values = source.values.map(row => [...row]);
  values[14][12] = '!!!';
  values[14][13] = '!!';
  values[14][14] = '!!!3';
  values[10][12] = '!!!';
  const { xml } = await importSheetMusicXml({ source: { ...source, values }, mapping });
  const report = (await readMusicXmlSong(withoutArchive(xml))).report;
  assert.ok(report.annotations.feels.some(feel => feel.partId === 'PA15' && feel.startBar === 10 && feel.text === 'Higher intensity'));
  assert.ok(report.annotations.feels.some(feel => feel.partId === 'PA15' && feel.startBar === 11 && feel.text === 'Extra funky'));
  assert.equal(report.annotations.feels.some(feel => feel.partId === 'PA11'), false);
  assert.equal(report.annotations.instrumentDisplays.some(display => display.cell === 'M15'), false);
  assert.ok(report.annotations.instrumentDisplays.some(display => display.cell === 'O15' && display.text === '!!!3'));
  assert.equal(report.parts.find(part => part.id === 'PA11')?.cells[9].text, '!!!');
  const document = await readMusicXmlSong(xml);
  document.report.annotations.feels.push({ partId: 'PA11', startBar: 10, endBar: 10, text: 'Higher intensity' });
  await assert.rejects(writeMusicXmlSong({ song: document.song, report: document.report }), /feel range/);
});

test('boundary directions reject malformed identities, source rows, source columns, offsets and duplicates', async () => {
  const { source, mapping } = await guitarChart();
  const { xml } = await importSheetMusicXml({ source, mapping });
  const tail = '<direction><direction-type><words id="boundary-tail-EK15">1</words></direction-type><offset>3840</offset></direction>';
  assert.ok(xml.includes(tail));
  for (const changed of [
    xml.replace('boundary-tail-EK15', 'boundary-side-EK15'),
    xml.replace('boundary-tail-EK15', 'boundary-tail-EK16'),
    xml.replace('boundary-tail-EK15', 'boundary-tail-EJ15'),
    xml.replace(tail, tail.replace('3840', '0')),
    xml.replace(tail, tail.replace('>1</words>', '> </words>')),
    xml.replace(tail, tail + tail),
    xml.replace(tail, '').replace('<measure number="Pickup 0">', '<measure number="Pickup 0">' + tail),
  ]) await assert.rejects(readMusicXmlSong(changed), /boundary|Duplicate|Unsupported/);
});

test('legacy canonical documents keep the same digest and omit empty boundary annotations', async () => {
  const xml = await readFile(new URL('../../../songs/dance-yrself-clean.musicxml', import.meta.url), 'utf8');
  const document = await readMusicXmlSong(xml);
  assert.equal('boundaryCues' in document.report.annotations, false);
  const rewritten = await writeMusicXmlSong({ song: document.song, report: document.report });
  assert.equal((await readMusicXmlSong(rewritten)).song.source.digest, document.song.source.digest);
  document.report.annotations.boundaryCues = [];
  await assert.rejects(writeMusicXmlSong({ song: document.song, report: document.report }), /must be omitted/);
});

test('boundary carriage returns and literal numeric entity spellings remain distinct through archive-free rewrite', async () => {
  const { source, mapping } = await guitarChart();
  const values = source.values.map(row => [...row]);
  const text = '  pickup\r\nLiteral &#13; and &#xD; stay literal.  ';
  values[14][2] = text;
  const imported = await importSheetMusicXml({ source: { ...source, values }, mapping });
  assert.match(imported.xml, /pickup&#13;/);
  assert.match(imported.xml, /Literal &amp;#13; and &amp;#xD;/);
  const document = await readMusicXmlSong(withoutArchive(imported.xml));
  assert.equal(document.report.annotations.boundaryCues?.find(cue => cue.cell === 'C15')?.text, text);
  const rewritten = await writeMusicXmlSong({ song: document.song, report: document.report });
  assert.equal((await readMusicXmlSong(rewritten)).report.annotations.boundaryCues?.find(cue => cue.cell === 'C15')?.text, text);
});

test('canonical entity decoding accepts XML character references and rejects HTML entities and invalid codepoints', async () => {
  const { source, mapping } = await guitarChart();
  const values = source.values.map(row => [...row]);
  const text = '\r literal &#13; and &nbsp;';
  values[14][2] = text;
  const imported = await importSheetMusicXml({ source: { ...source, values }, mapping });
  const decimal = imported.xml;
  assert.match(decimal, />&#13; literal/);
  const hex = decimal.replace('>&#13; literal', '>&#xD; literal');
  assert.notEqual(hex, decimal);
  for (const xml of [decimal, hex]) {
    const document = await readMusicXmlSong(withoutArchive(xml));
    assert.equal(document.report.annotations.boundaryCues?.find(cue => cue.cell === 'C15')?.text, text);
  }
  for (const entity of ['&nbsp;', '&copy;', '&#0;', '&#xD800;', '&#xFFFE;', '&#1114112;']) {
    await assert.rejects(readMusicXmlSong(decimal.replace('>&#13; literal', `>${entity} literal`)), /XML|entit|character reference/);
  }
  const commented = decimal.replace('<work>', '<!-- literal &nbsp; and &#0; --><work>');
  assert.deepEqual((await readMusicXmlSong(commented)).report, (await readMusicXmlSong(decimal)).report);
  const cdata = decimal.replace(/(<words id="boundary-lead-in-C15">)[^]*?(<\/words>)/, '$1<![CDATA[literal &nbsp; and &#13;]]>$2');
  assert.equal((await readMusicXmlSong(cdata)).report.annotations.boundaryCues?.find(cue => cue.cell === 'C15')?.text, 'literal &nbsp; and &#13;');
});
