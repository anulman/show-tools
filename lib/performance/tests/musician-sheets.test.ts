import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Schema } from 'effect';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { createMusicianSheets } from '../musician-sheets.js';
import { parseSongSource } from '../song-source.js';
import { compileSong, decodeSongMapping } from '../compiled-song.js';

async function inputs() {
  const [source, mapping] = await Promise.all(['source', 'mapping'].map(async suffix =>
    JSON.parse(await readFile(new URL(`../../../songs/dance-yrself-clean.${suffix}.json`, import.meta.url), 'utf8'))));
  return { source: parseSongSource(source), mapping: decodeSongMapping(mapping) };
}

const Field = Schema.Struct({ name: Schema.String, '#text': Schema.String });
const Words = Schema.Struct({ id: Schema.String, '#text': Schema.String });
const Direction = Schema.Struct({ 'direction-type': Schema.Struct({
  words: Schema.optionalKey(Words), rehearsal: Schema.optionalKey(Schema.String),
}) });
const Measure = Schema.Struct({ number: Schema.String,
  direction: Schema.optionalKey(Schema.Array(Direction)),
  note: Schema.Array(Schema.Struct({ 'print-object': Schema.String, duration: Schema.String })),
});
const Document = Schema.Struct({ 'score-partwise': Schema.Struct({
  identification: Schema.Struct({ miscellaneous: Schema.Struct({ 'miscellaneous-field': Schema.Array(Field) }) }),
  part: Schema.Array(Schema.Struct({ id: Schema.String, measure: Schema.Array(Measure) })),
}) });

function parsed(xml: string) {
  assert.equal(XMLValidator.validate(xml), true);
  const value: unknown = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    trimValues: false, isArray: name => ['miscellaneous-field', 'part', 'measure', 'note', 'direction'].includes(name) }).parse(xml);
  return Schema.decodeUnknownSync(Document)(value)['score-partwise'];
}

function attributes(svg: string, name: string): number[] {
  return [...svg.matchAll(new RegExp(`${name}="([0-9]+)"`, 'g'))].map(match => Number(match[1]));
}

function cueLines(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*fill="#525252"[^>]*>(.*?)<\/text>/gs)].map(match => {
    const value: unknown = new XMLParser({ parseTagValue: false, trimValues: false }).parse(`<value>${match[1]}</value>`);
    return Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }))(value).value;
  });
}

test('DYC musician outputs contain only separate Bass and Drums sheets, all bars, full staff lines and room to write', async () => {
  const sheets = await createMusicianSheets(await inputs());
  assert.deepEqual(sheets.map(sheet => [sheet.name, sheet.labelCell, sheet.stem]),
    [['Bass', 'A14', 'bass-a14'], ['Drums', 'A15', 'drums-a15']]);
  for (const sheet of sheets) {
    assert.equal(sheet.pages.length, 8);
    assert.deepEqual(sheet.pages.flatMap(page => attributes(page, 'data-bar')), Array.from({ length: 218 }, (_, i) => i + 1));
    assert.deepEqual(sheet.pages.flatMap(page => attributes(page, 'data-system-start')), Array.from({ length: 55 }, (_, i) => i * 4 + 1));
    for (const page of sheet.pages) {
      assert.equal(XMLValidator.validate(page), true);
      assert.match(page, /width="210mm" height="297mm"/);
      const systems = attributes(page, 'data-system-start');
      assert.ok(systems.length <= 7);
      assert.deepEqual(attributes(page, 'data-staff-line'), systems.flatMap(() => [1, 2, 3, 4, 5]));
      assert.doesNotMatch(page, /data-bar="(?:219|220)"/);
    }
    assert.match(sheet.html, /@page\{size:A4;margin:0\}/);
    assert.match(sheet.html, /Print \/ Save PDF/);
    const embedded = /href="data:application\/vnd.recordare.musicxml\+xml;charset=utf-8,([^"]+)"/.exec(sheet.html);
    assert.ok(embedded);
    assert.equal(decodeURIComponent(embedded[1]), sheet.xml);
    assert.match(sheet.xml, /<staff-lines>5<\/staff-lines>/);
    assert.doesNotMatch(sheet.xml, /<(?:pitch|unpitched|notehead|dynamics)(?:>|\s)/);
    assert.doesNotMatch(sheet.xml, /id="(?:cue|lead)-/);
    const last = sheet.pages.at(-1) ?? '';
    const penultimate = Number(/data-bar="217"><text x="([0-9.]+)"/.exec(last)?.[1]);
    const final = Number(/data-bar="218"><text x="([0-9.]+)"/.exec(last)?.[1]);
    const ordinaryFirst = Number(/data-bar="213"><text x="([0-9.]+)"/.exec(last)?.[1]);
    const ordinarySecond = Number(/data-bar="214"><text x="([0-9.]+)"/.exec(last)?.[1]);
    assert.ok(Number.isFinite(penultimate) && Number.isFinite(final));
    assert.ok(Math.abs((final - penultimate) - 2 * (ordinarySecond - ordinaryFirst)) < .001);
  }
  assert.match(sheets[0].xml, /<clef><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(sheets[1].xml, /<clef><sign>percussion<\/sign><\/clef>/);
});

test('focused parts preserve complete source metadata and bar durations with literal arrangement and lyric cues', async () => {
  const input = await inputs(), song = await compileSong(input.source, input.mapping);
  for (const sheet of await createMusicianSheets(input)) {
    const doc = parsed(sheet.xml);
    assert.equal(doc.part.length, 1);
    assert.equal(doc.part[0].id, `P${sheet.labelCell}`);
    assert.deepEqual(doc.part[0].measure.map(measure => Number(measure.number)), Array.from({ length: 218 }, (_, i) => i + 1));
    for (const measure of doc.part[0].measure) {
      assert.equal(measure.note.reduce((sum, note) => sum + Number(note.duration), 0), 3840);
      assert.ok(measure.note.every(note => note['print-object'] === 'no'));
    }
    const fields = new Map(doc.identification.miscellaneous['miscellaneous-field'].map(field => [field.name, field['#text']]));
    assert.deepEqual(JSON.parse(fields.get('show-tools:source') ?? ''), input.source);
    assert.deepEqual(JSON.parse(fields.get('show-tools:mapping') ?? ''), input.mapping);
    assert.deepEqual(JSON.parse(fields.get('show-tools:selected-label-cells') ?? ''), [sheet.labelCell]);
    const words = doc.part[0].measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => {
      const word = direction['direction-type'].words;
      return word ? [{ bar: Number(measure.number), ...word }] : [];
    }));
    const row = Number(sheet.labelCell.slice(1)) - 1;
    for (const bar of song.chart.bars) {
      const raw = input.source.values[row]?.[bar.column - 1] ?? '';
      if (raw.trim()) assert.ok(words.some(word => word.bar === bar.bar && word.id.startsWith('chart-') && word['#text'] === raw));
    }
    const rehearsals = doc.part[0].measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => {
      const rehearsal = direction['direction-type'].rehearsal;
      return rehearsal ? [[Number(measure.number), rehearsal]] : [];
    }));
    assert.deepEqual(rehearsals, song.chart.sections.map(section => [section.startBar, section.label]));
    assert.ok(words.some(word => word.bar === 13 && word['#text'] === 'Vocal cue: Walking up to me expecting...'));
    assert.ok(words.some(word => word.bar === 201 && word['#text'] === 'Vocal cue: Show.'));
    assert.ok(sheet.pages.some(page => page.includes('Instrumental A4') && page.includes('b.201: Show.')));
  }
});

test('selection excludes AF rows without substituting unrelated musician parts', async () => {
  const input = await inputs();
  assert.deepEqual(await createMusicianSheets({ ...input, selectedRows: [8, 9, 10, 11, 12, 13] }), []);
  assert.deepEqual((await createMusicianSheets({ ...input, selectedRows: [14, 10, 14] })).map(sheet => sheet.labelCell), ['A14']);
  assert.deepEqual((await createMusicianSheets({ ...input, selectedRows: [15, 14] })).map(sheet => sheet.labelCell), ['A14', 'A15']);
});

test('musician XML, printable HTML and page SVGs are deterministic across input object ordering', async () => {
  const input = await inputs();
  const original = await createMusicianSheets(input);
  const reordered = await createMusicianSheets({ source: { ...input.source, notes: Object.fromEntries(Object.entries(input.source.notes).reverse()) },
    mapping: Object.fromEntries(Object.entries(input.mapping).reverse()) });
  assert.deepEqual(reordered, original);
  assert.deepEqual(await createMusicianSheets(input), original);
});

test('long vocal text wraps into more cue lines while preserving the exact cue in MusicXML', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  const longCue = Array.from({ length: 30 }, (_, i) => `lyric${i} phrase${i}`).join(' ');
  values[7][14] = longCue;
  const sheets = await createMusicianSheets({ source: { ...input.source, values }, mapping: input.mapping });
  for (const sheet of sheets) {
    assert.match(sheet.xml, new RegExp(`Vocal cue: ${longCue}`));
    const lines = sheet.pages.flatMap(cueLines);
    assert.ok(lines.filter(line => line.includes('lyric') || line.includes('phrase')).length > 1);
    assert.ok(lines.every(line => [...line].length <= 60));
    for (let i = 0; i < 30; i++) assert.ok(lines.join(' ').includes(`lyric${i} phrase${i}`));
    assert.deepEqual(sheet.pages.flatMap(page => attributes(page, 'data-bar')), Array.from({ length: 218 }, (_, i) => i + 1));
  }
});

test('source resembling scripts is escaped in all printable outputs and stale capture mappings still block generation', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[7][14] = '<script>alert("cue")</script> & "friends"';
  const sheets = await createMusicianSheets({ source: { ...input.source, values }, mapping: input.mapping });
  for (const sheet of sheets) {
    assert.doesNotMatch(sheet.html, /<script>/);
    assert.doesNotMatch(sheet.xml, /<script>/);
    assert.ok(sheet.pages.some(page => page.includes('&lt;script&gt;')));
    for (const page of sheet.pages) assert.equal(XMLValidator.validate(page), true);
  }
  values[10][97] = '';
  await assert.rejects(createMusicianSheets({ source: { ...input.source, values }, mapping: input.mapping }), /CT11/);
});
