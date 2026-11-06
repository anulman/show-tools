import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Schema } from 'effect';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { importSheetMusicXml, renderMusicXmlReview } from '../sheet-musicxml.js';
import { parseSongSource } from '../song-source.js';
import { decodeSongMapping } from '../compiled-song.js';
import { runSheetsMusicXmlImport } from '../../../scripts/import-sheet-musicxml.js';

async function inputs() {
  const [source, mapping] = await Promise.all(['source', 'mapping'].map(async suffix =>
    JSON.parse(await readFile(new URL(`../../../songs/dance-yrself-clean.${suffix}.json`, import.meta.url), 'utf8'))));
  return { source: parseSongSource(source), mapping: decodeSongMapping(mapping) };
}

const Field = Schema.Struct({ name: Schema.String, '#text': Schema.String });
const Note = Schema.Struct({ duration: Schema.String });
const Measure = Schema.Struct({ number: Schema.String, note: Schema.Array(Note) });
const Document = Schema.Struct({ 'score-partwise': Schema.Struct({
  identification: Schema.Struct({ miscellaneous: Schema.Struct({ 'miscellaneous-field': Schema.Array(Field) }) }),
  part: Schema.Array(Schema.Struct({ id: Schema.String, measure: Schema.Array(Measure) })),
}) });
function parsed(xml: string) {
  assert.equal(XMLValidator.validate(xml), true);
  const value: unknown = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false,
    trimValues: false, isArray: name => ['miscellaneous-field', 'part', 'measure', 'note'].includes(name) }).parse(xml);
  return Schema.decodeUnknownSync(Document)(value)['score-partwise'];
}

test('DYC exports 218 measures per eight parts, exact parsed source/mapping, and complete measure timing', async () => {
  const input = await inputs(), result = await importSheetMusicXml(input), doc = parsed(result.xml);
  assert.equal(doc.part.length, 8);
  for (const part of doc.part) {
    assert.equal(part.measure.length, 218);
    for (const measure of part.measure) assert.equal(measure.note.reduce((sum, note) => sum + Number(note.duration), 0), 3840);
  }
  const fields = new Map(doc.identification.miscellaneous['miscellaneous-field'].map(f => [f.name, f['#text']]));
  assert.deepEqual(JSON.parse(fields.get('show-tools:source') ?? ''), input.source);
  assert.deepEqual(JSON.parse(fields.get('show-tools:mapping') ?? ''), input.mapping);
  assert.equal(result.report.nativeCompilationExecutable, true);
  assert.deepEqual(result.report.parts.find(p => p.labelCell === 'A11')?.cells.find(c => c.bar === 82)?.reading,
    { kind: 'hits', offsets: [.5, 1.25, 2, 2.75, 3.5], sampled: false });
  assert.equal(result.report.parts.find(p => p.labelCell === 'A8')?.cells.find(c => c.bar === 201)?.reading.kind, 'text');
  assert.equal(result.xml.includes('<pitch>'), false);
  assert.equal(result.xml.includes('<dynamics>'), false);
  assert.match(result.xml, /command-L1|command-R1|pad-R1|cue-/);
});

test('export bytes do not depend on object key order, paths, dates or repeated execution', async () => {
  const input = await inputs();
  const first = await importSheetMusicXml(input);
  const second = await importSheetMusicXml({ source: { ...input.source, notes: Object.fromEntries(Object.entries(input.source.notes).reverse()) },
    mapping: Object.fromEntries(Object.entries(input.mapping).reverse()) });
  assert.equal(second.xml, first.xml);
  assert.deepEqual(second.report, first.report);
  assert.equal((await importSheetMusicXml(input)).xml, first.xml);
});

test('6/8 uses eighth-note chart counts and exact onset offsets without invented durations', async () => {
  const input = await inputs();
  const mapping = { ...input.mapping, meter: { numerator: 6, denominator: 8 } };
  const result = await importSheetMusicXml({ source: input.source, mapping });
  for (const part of parsed(result.xml).part) for (const measure of part.measure) {
    assert.equal(measure.note.reduce((sum, n) => sum + Number(n.duration), 0), 2880);
  }
  assert.match(result.xml, /<beat-unit>eighth<\/beat-unit><per-minute>98/);
  assert.doesNotMatch(result.xml, /<unpitched>|<pitch>|<type>32nd/);
  assert.match(result.xml, /<other-direction[^>]*id="onset-/);
});

test('escaping preserves literal cell text, notes, Unicode, CR and whitespace; unparsed cells stay visible', async () => {
  const input = await inputs();
  const values = input.source.values.map(row => [...row]);
  values[7][14] = '  <hello> & "friends"\r\n🎵  ';
  const source = { ...input.source, values, notes: { ...input.source.notes, B8: 'some <note> & text\rnext' } };
  const result = await importSheetMusicXml({ source, mapping: input.mapping });
  const field = parsed(result.xml).identification.miscellaneous['miscellaneous-field'].find(f => f.name === 'show-tools:source');
  assert.deepEqual(JSON.parse(field?.['#text'] ?? ''), source);
  assert.match(result.xml, /&lt;hello&gt; &amp;/);
  const html = renderMusicXmlReview(result.report, 'score.musicxml');
  assert.match(html, /&lt;hello&gt; &amp;/);
  assert.equal(result.report.parts[0].cells.find(c => c.bar === 13)?.reading.kind, 'text');
});

test('unsupported rhythms remain literal and never silently become note attacks', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[14][2] = '4 2';
  const result = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
  const reading = result.report.parts.find(p => p.labelCell === 'A15')?.cells[0].reading;
  assert.equal(reading?.kind, 'text');
  assert.match(result.xml, /id="instrument-C15"[^>]*>4 2/);
});

test('main-vocal lyrics a and e remain text rather than invented subdivision attacks', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[7][14] = 'a'; values[7][15] = 'e';
  const result = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
  assert.equal(result.report.parts[0].cells.find(c => c.bar === 13)?.reading.kind, 'text');
  assert.equal(result.report.parts[0].cells.find(c => c.bar === 14)?.reading.kind, 'text');
  assert.equal(result.xml.includes('id="hit-O8-0"'), false);
});

test('stale approved prefix notation preserves blocking diagnostics in canonical drafts', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[10][97] = '';
  const draft = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
  assert.equal(draft.report.nativeCompilationExecutable, false);
  assert.ok(draft.report.compilerDiagnostics.some(diagnostic => diagnostic.source.a1 === 'CT11'));
});

test('XML-illegal text fails clearly instead of emitting corrupted XML', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[7][14] = 'bad\u0000text';
  await assert.rejects(importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping }), /XML 1.0.*U\+0/);
});

test('CLI emits the real study and refuses to overwrite an existing output directory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'musicxml-cli-'));
  try {
    const output = join(directory, 'new-study');
    const args = ['--source', 'songs/dance-yrself-clean.source.json', '--mapping', 'songs/dance-yrself-clean.mapping.json', '--out-dir', output];
    await runSheetsMusicXmlImport(args);
    const before = await readFile(join(output, 'score.musicxml'), 'utf8');
    assert.equal(parsed(before).part.length, 8);
    await assert.rejects(runSheetsMusicXmlImport(args), /EEXIST/);
    assert.equal(await readFile(join(output, 'score.musicxml'), 'utf8'), before);
    await assert.rejects(runSheetsMusicXmlImport(['--source', 'a', '--source', 'b']), error => typeof error === 'object' && error !== null && 'code' in error && error.code === 'CHART_ARGUMENTS');
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('complete-master import rejects numbered bars beyond a stale mapping instead of truncating them', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  for (const row of [input.mapping.barRow, input.mapping.sectionRow]) while (values[row - 1].length <= 220) values[row - 1].push('');
  values[input.mapping.barRow - 1][220] = '219';
  values[input.mapping.sectionRow - 1][220] = 'New section';
  await assert.rejects(importSheetMusicXml({ source: { ...input.source, range: 'A1:HM30', values }, mapping: input.mapping }), /bar 219.*outside.*1-218/);
});
