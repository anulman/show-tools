import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { XMLValidator } from 'fast-xml-parser';
import { createMusicianChart, createMusicianCharts } from '../musician-sheets.js';
import { readMusicXmlSong } from '../musicxml-song.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';

const input = (slug = 'dance-yrself-clean') => readFile(new URL(`../../../songs/${slug}.musicxml`, import.meta.url), 'utf8');
const voices = [{ labelCell: 'A14', name: 'Pad Synth' }, { labelCell: 'A15', name: 'Piano' }];

async function sourceVoices(first: readonly string[], second: readonly string[], lyrics: readonly string[] = []) {
  const document = await readMusicXmlSong(await input());
  assert(document.source && document.mapping);
  const values = document.source.values.map(row => [...row]);
  values[13][0] = voices[0].name; values[14][0] = voices[1].name;
  for (const [index, bar] of document.song.chart.bars.entries()) {
    values[13][bar.column - 1] = first[index] ?? '';
    values[14][bar.column - 1] = second[index] ?? '';
    if (index < lyrics.length) values[7][bar.column - 1] = lyrics[index];
  }
  return importSheetMusicXml({ source: { ...document.source, values }, mapping: document.mapping });
}

function numberedCoverage(pages: readonly string[]) {
  return pages.flatMap(page => [...page.matchAll(/data-(bar|rest-start)="(\d+)"(?: data-rest-end="(\d+)")?/g)].flatMap(match =>
    match[1] === 'bar' ? [Number(match[2])] : Array.from({ length: Number(match[3]) - Number(match[2]) + 1 }, (_, index) => Number(match[2]) + index)));
}

test('one musician chart preserves voice changes, simultaneous source cues and only all-voice rests', async () => {
  const imported = await sourceVoices(['-', '', '2!', '', '-', '', '', '', '', '', '', ''], ['', '-', '4e&a']);
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Keys', parts: voices }); assert(chart);
  assert.equal(chart.name, 'Keys'); assert.equal(chart.stem, 'keys'); assert(!('labelCell' in chart));
  assert.deepEqual(chart.sourceParts, voices.map(voice => ({ id: `P${voice.labelCell}`, ...voice })));
  assert.deepEqual(numberedCoverage(chart.pages), Array.from({ length: 218 }, (_, index) => index + 1));
  const page = chart.pages.join('');
  for (const name of ['Pad Synth', 'Piano']) assert(page.includes(name));
  assert.match(page, /data-source-cell="E14" data-voice="PA14"/);
  assert.match(page, /data-source-cell="E15" data-voice="PA15"/);
  assert.match(page, /Pad Synth: Fill from 2/); assert.match(page, /Piano: Fill: 4 e/);
  assert(chart.condensation.rests.every(rest => rest.startBar > 5));
  assert.deepEqual(chart.condensation.references, []); assert.deepEqual(chart.condensation.repeatCandidates, []);
  assert.equal(XMLValidator.validate(chart.xml), true);
  assert.match(chart.xml, /show-tools:selected-label-cells">\[&quot;A14&quot;,&quot;A15&quot;\]/);
  assert.match(chart.xml, /id="chart-E14"/); assert.match(chart.xml, /id="chart-E15"/);
  assert.equal((chart.xml.match(/<part id=/g) ?? []).length, 1);
  assert.equal((chart.xml.match(/<measure /g) ?? []).length, 218);
});

test('active voice labels repeat at page starts and cue lines fit their writing system', async () => {
  const imported = await sourceVoices(Array.from({ length: 218 }, () => '-'), Array.from({ length: 218 }, () => '-'));
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Keys', parts: voices }); assert(chart);
  assert(chart.pages.length > 1);
  for (const page of chart.pages) {
    const first = /data-system-start="\d+" data-kind="staff">([\s\S]*?)(?=<g data-system-start=|<text x="557)/.exec(page)?.[1]; assert(first);
    assert(first.includes('Pad Synth')); assert(first.includes('Piano'));
    const lines = [...page.matchAll(/<text data-source-cell="[^"]+"[^>]*y="([0-9.]+)"/g)].map(match => Number(match[1]));
    assert(lines.every(y => y <= 795));
    assert.equal(XMLValidator.validate(page), true);
  }
});

test('voice-specific feel labels and source identity remain distinct in a combined chart', async () => {
  const imported = await sourceVoices(['!', '!', '!', '!'], ['!!', '!!', '!!!', '!!!']);
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Keys', parts: voices }); assert(chart);
  const page = chart.pages.join('');
  assert(page.includes('Pad Synth: Funky')); assert(page.includes('Piano: Extra funky')); assert(page.includes('Higher intensity'));
  assert.match(chart.xml, /show-tools:voice-feels/); assert.match(chart.xml, /&quot;partId&quot;:&quot;PA14&quot;/); assert.match(chart.xml, /&quot;partId&quot;:&quot;PA15&quot;/);
});

test('annotation-only vocal marks are omitted while actual apostrophe lyrics survive', async () => {
  const imported = await sourceVoices(['-', '-'], [], ["-'", "Don't stop"]);
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Keys', parts: voices }); assert(chart);
  assert.doesNotMatch(chart.pages.join(''), /data-vocal-bar="1"/);
  assert.match(chart.pages.join(''), /Don&apos;t stop|Don't stop/);
  assert.doesNotMatch(chart.xml, /Vocal cue: -'/);
  assert.match(chart.xml, /Vocal cue: Don&apos;t stop/);
});

test('Drunk Girls tail is a separately labeled writing bar without a phantom numbered bar', async () => {
  const document = await readMusicXmlSong(await input('drunk-girls')); assert(document.source && document.mapping);
  const imported = await importSheetMusicXml({ source: document.source, mapping: document.mapping });
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Drums', parts: [{ labelCell: 'A18', name: 'Drums' }] }); assert(chart);
  assert.deepEqual(numberedCoverage(chart.pages), Array.from({ length: 137 }, (_, index) => index + 1));
  assert.equal((chart.pages.join('').match(/data-tail-bar="true"/g) ?? []).length, 1);
  assert.equal((chart.pages.join('').match(/data-tail-staff-line=/g) ?? []).length, 5);
  assert.match(chart.pages.at(-1) ?? '', /data-boundary-cell="EK18"[^>]*>1<\/text>/);
  assert.doesNotMatch(chart.pages.join(''), /data-bar="138"/);
  assert.match(chart.xml, /<measure number="Tail" implicit="yes" non-controlling="yes">/);
  assert.equal((chart.xml.match(/<measure /g) ?? []).length, 138);
  assert.match(chart.xml, /<measure number="128">/);
  assert.doesNotMatch(chart.xml, /<measure number="129">/);
  assert.equal(XMLValidator.validate(chart.xml), true);
  assert.equal((await readMusicXmlSong(imported.xml)).report.measureCount, 137);
});

test('empty selection omits charts and invalid, repeated or managed row selections reject', async () => {
  assert.equal(await createMusicianChart({ musicxml: '', instrument: 'Guitar', parts: [] }), null);
  const musicxml = await input();
  for (const parts of [[{ labelCell: 'A14', name: 'Wrong name' }], [{ labelCell: 'A999', name: 'Bass' }],
    [{ labelCell: 'A10', name: 'AF - Backup Vox' }], [{ labelCell: 'A14', name: 'Bass' }, { labelCell: 'A14', name: 'Bass' }]])
    await assert.rejects(createMusicianChart({ musicxml, instrument: 'Bass', parts }), /Missing|distinct/);
});

test('grouped voice captions omit only the exact musician prefix and retain full source names', async () => {
  const document = await readMusicXmlSong(await input()); assert(document.source && document.mapping);
  const values = document.source.values.map(row => [...row]);
  values[13][0] = 'Bass - Alien Synth'; values[14][0] = 'Bass - Bass Synth';
  const imported = await importSheetMusicXml({ source: { ...document.source, values }, mapping: document.mapping });
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Bass', parts: [
    { labelCell: 'A14', name: 'Bass - Alien Synth' }, { labelCell: 'A15', name: 'Bass - Bass Synth' },
  ] }); assert(chart);
  assert(chart.pages.join('').includes('Alien Synth'));
  assert(!chart.pages.join('').includes('Bass - Alien Synth'));
  assert.equal(chart.sourceParts[0].name, 'Bass - Alien Synth');
  assert.match(chart.xml, /&quot;name&quot;:&quot;Bass - Alien Synth&quot;/);
});

test('public chart selection groups explicit Musician - Voice rows and excludes AF rows', async () => {
  const document = await readMusicXmlSong(await input()); assert(document.source && document.mapping);
  const values = document.source.values.map(row => [...row]);
  values[13][0] = 'Keys - Pad Synth'; values[14][0] = 'Keys - Piano';
  const imported = await importSheetMusicXml({ source: { ...document.source, values }, mapping: document.mapping });
  const charts = await createMusicianCharts({ musicxml: imported.xml });
  assert.equal(charts.length, 1); assert.equal(charts[0].name, 'Keys');
  assert.deepEqual(charts[0].sourceParts.map(part => part.labelCell), ['A14', 'A15']);
  const selected = await createMusicianCharts({ musicxml: imported.xml, selectedRows: [10, 15] });
  assert.equal(selected.length, 1); assert.deepEqual(selected[0].sourceParts.map(part => part.labelCell), ['A15']);
  assert.deepEqual(await createMusicianCharts({ musicxml: imported.xml, selectedRows: [10] }), []);
  assert.deepEqual(await createMusicianCharts({ musicxml: imported.xml, selectedRows: [] }), []);
  const ordinary = await createMusicianCharts({ musicxml: await input() });
  assert.deepEqual(ordinary.map(chart => chart.name), ['Bass', 'Drums']);
});

test('single-voice public charts honor confirmed reuse and multi-voice references reject visibly', async () => {
  const musicxml = await input(), document = await readMusicXmlSong(musicxml);
  const reuse = { sourceDigest: document.report.sourceDigest, mappingDigest: document.report.mappingDigest,
    references: [{ partLabelCell: 'A14', sectionStartBar: 93, sourceSectionStartBar: 85, equivalence: 'musician-confirmed' }] };
  const single = await createMusicianChart({ musicxml, instrument: 'Bass', parts: [{ labelCell: 'A14', name: 'Bass' }], reuse }); assert(single);
  assert.deepEqual(single.condensation.references, reuse.references);
  assert.match(single.pages.join(''), /data-reference-start="93"/);
  await assert.rejects(createMusicianChart({ musicxml, instrument: 'Musician', parts: [{ labelCell: 'A14', name: 'Bass' }, { labelCell: 'A15', name: 'Drums' }], reuse }), /combined musician confirmation/);
  const publicCharts = await createMusicianCharts({ musicxml, reuse });
  assert.deepEqual(publicCharts[0].condensation.references, reuse.references);
});

test('musician names are trimmed and cannot supply XML identities or empty file stems', async () => {
  const musicxml = await input();
  await assert.rejects(createMusicianChart({ musicxml, instrument: '  ', parts: [{ labelCell: 'A14', name: 'Bass' }] }), /nonempty/);
  const chart = await createMusicianChart({ musicxml, instrument: '  鍵盤  ', parts: [{ labelCell: 'A14', name: 'Bass' }] }); assert(chart);
  assert.equal(chart.name, '鍵盤'); assert(chart.stem.length > 0);
  assert.match(chart.xml, /<part id="P-musician-PA14">/);
  assert.equal(XMLValidator.validate(chart.xml), true);
});

test('automatic musician exports omit nonmanaged Knob rows even when explicitly selected', async () => {
  const document = await readMusicXmlSong(await input()); assert(document.source && document.mapping);
  const values = document.source.values.map(row => [...row]);
  values[13][0] = 'Bass - Alien Synth'; values[14][0] = 'Keys - Piano';
  values[15] = Array.from({ length: values[13].length }, () => ''); values[15][0] = 'Knob';
  for (const bar of document.song.chart.bars) values[15][bar.column - 1] = '-';
  const imported = await importSheetMusicXml({ source: { ...document.source, values }, mapping: document.mapping });
  assert(imported.report.parts.some(part => part.labelCell === 'A16' && part.name === 'Knob' && !part.managed));
  const charts = await createMusicianCharts({ musicxml: imported.xml });
  assert.deepEqual(charts.map(chart => chart.name), ['Bass', 'Keys']);
  assert.deepEqual(await createMusicianCharts({ musicxml: imported.xml, selectedRows: [16] }), []);
  const explicit = await createMusicianChart({ musicxml: imported.xml, instrument: 'Custom musician', parts: [{ labelCell: 'A16', name: 'Knob' }] });
  assert.equal(explicit?.name, 'Custom musician');
});

test('a song tail provides a blank writing bar for musicians without an authored tail hit', async () => {
  const document = await readMusicXmlSong(await input('drunk-girls')); assert(document.source && document.mapping);
  const imported = await importSheetMusicXml({ source: document.source, mapping: document.mapping });
  const parts = imported.report.parts.filter(part => ['A16', 'A17'].includes(part.labelCell)); assert.equal(parts.length, 2);
  assert(!imported.report.annotations.boundaryCues?.some(cue => parts.some(part => part.id === cue.partId)));
  const chart = await createMusicianChart({ musicxml: imported.xml, instrument: 'Keys', parts }); assert(chart);
  assert.deepEqual(numberedCoverage(chart.pages), Array.from({ length: 137 }, (_, index) => index + 1));
  const tail = /<g data-tail-bar="true">([\s\S]*?)<\/g>/.exec(chart.pages.at(-1) ?? '')?.[1]; assert(tail);
  assert.equal((tail.match(/data-tail-staff-line=/g) ?? []).length, 5);
  assert.doesNotMatch(tail, /data-boundary-cell|>1<\/text>|rest|sustain/i);
  const measure = /<measure number="Tail" implicit="yes" non-controlling="yes">([\s\S]*?)<\/measure>/.exec(chart.xml)?.[1]; assert(measure);
  assert.match(measure, /<note print-object="no">/); assert.doesNotMatch(measure, /boundary-tail/);
  assert.equal((chart.xml.match(/<measure /g) ?? []).length, 138);
  assert.equal((await readMusicXmlSong(imported.xml)).report.measureCount, 137);
});
