import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Schema } from 'effect';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { instrumentCue, musicianFeelRanges, sectionFeelSummary } from '../musician-annotations.js';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { createMusicianSheets } from '../musician-sheets.js';
import { parseSongSource } from '../song-source.js';
import { compileSheetsSong, decodeSongMapping } from '../compiled-song.js';

async function inputs() {
  const [source, mapping] = await Promise.all(['source', 'mapping'].map(async suffix =>
    JSON.parse(await readFile(new URL(`../../../songs/dance-yrself-clean.${suffix}.json`, import.meta.url), 'utf8'))));
  const input = { source: parseSongSource(source), mapping: decodeSongMapping(mapping) };
  return { ...input, musicxml: (await importSheetMusicXml(input)).xml };
}

const Field = Schema.Struct({ name: Schema.String, '#text': Schema.String });
const Words = Schema.Struct({ id: Schema.String, '#text': Schema.String });
const Direction = Schema.Struct({ 'direction-type': Schema.Struct({
  words: Schema.optionalKey(Words), rehearsal: Schema.optionalKey(Schema.String),
}) });
const Measure = Schema.Struct({ number: Schema.String,
  direction: Schema.optionalKey(Schema.Array(Direction)),
  note: Schema.Array(Schema.Struct({ 'print-object': Schema.optionalKey(Schema.String), duration: Schema.String })),
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

function coveredBars(svg: string): number[] {
  return [...svg.matchAll(/data-(bar|rest-start|reference-start)="([0-9]+)"(?: data-(rest-end|reference-end)="([0-9]+)")?/g)].flatMap(match => {
    const start = Number(match[2]);
    if (match[1] === 'bar') { assert.equal(match[3], undefined); return [start]; }
    assert.equal(match[3], match[1].replace('-start', '-end'));
    const end = Number(match[4]);
    assert.ok(Number.isSafeInteger(end) && end >= start);
    return Array.from({ length: end - start + 1 }, (_, index) => start + index);
  });
}

function cueLines(svg: string): string[] {
  return [...svg.matchAll(/<text[^>]*fill="#525252"[^>]*>(.*?)<\/text>/gs)].map(match => {
    const value: unknown = new XMLParser({ parseTagValue: false, trimValues: false }).parse(`<value>${match[1]}</value>`);
    return Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }))(value).value;
  });
}

test('DYC musician outputs condense rests while preserving every bar, active writing space and page context', async () => {
  const input = await inputs(), song = await compileSheetsSong(input.source, input.mapping);
  const sheets = await createMusicianSheets(input);
  assert.deepEqual(sheets.map(sheet => [sheet.name, sheet.labelCell, sheet.stem]),
    [['Bass', 'A14', 'bass-a14'], ['Drums', 'A15', 'drums-a15']]);
  assert.deepEqual(sheets.map(sheet => sheet.pages.length), [4, 5]);
  for (const sheet of sheets) {
    assert.deepEqual(sheet.pages.flatMap(coveredBars), Array.from({ length: 218 }, (_, i) => i + 1));
    const row = Number(sheet.labelCell.slice(1)) - 1;
    const writtenBars = sheet.pages.flatMap(page => attributes(page, 'data-bar'));
    for (const bar of song.chart.bars) {
      if (input.source.values[row]?.[bar.column - 1]?.trim()) assert.ok(writtenBars.includes(bar.bar), `${sheet.name} active bar ${bar.bar} must retain writing space`);
    }
    assert.ok(sheet.condensation.rests.length > 0);
    assert.deepEqual(sheet.condensation.references, []);
    assert.ok(sheet.condensation.repeatCandidates.length > 0);
    for (const rest of sheet.condensation.rests) for (const bar of song.chart.bars.filter(bar => bar.bar >= rest.startBar && bar.bar <= rest.endBar)) {
      assert.equal((input.source.values[row]?.[bar.column - 1] ?? '').trim(), '', `Only blank cells may form a rest at ${bar.bar}`);
    }
    for (const page of sheet.pages) {
      assert.equal(XMLValidator.validate(page), true);
      assert.match(page, /width="210mm" height="297mm"/);
      const staffCount = [...page.matchAll(/data-kind="staff"/g)].length;
      assert.deepEqual(attributes(page, 'data-staff-line'), Array.from({ length: staffCount }, () => [1, 2, 3, 4, 5]).flat());
      const staffLines = [...page.matchAll(/data-staff-line="([1-5])"[^>]*y1="([0-9.]+)"/g)];
      for (let index = 0; index < staffLines.length; index += 5) assert.equal(Number(staffLines[index + 4][2]) - Number(staffLines[index][2]), 24);
      const labels = [...page.matchAll(/data-section="([^"]+)"/g)].map(match => match[1]);
      assert.equal(new Set(labels).size, labels.length, 'A section is labeled once per page');
      const start = attributes(page, 'data-system-start')[0];
      const section = song.chart.sections.find(section => start >= section.startBar && start <= section.endBar);
      assert.equal(labels[0], section?.id, 'Page starts retain the current section context');
      assert.doesNotMatch(page, /\(cont\.\)|Cont['’]d/);
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
    assert.match(sheet.pages.at(-1) ?? '', /data-rest-start="217" data-rest-end="218"/);
  }
  const drumBars = sheets[1].pages.flatMap(page => attributes(page, 'data-bar'));
  for (const pickup of [76, 160, 203, 204, 205]) assert.ok(drumBars.includes(pickup), `Drums pickup ${pickup} must not disappear into a rest`);
  assert.match(sheets[0].xml, /<clef><sign>F<\/sign><line>4<\/line><\/clef>/);
  assert.match(sheets[1].xml, /<clef><sign>percussion<\/sign><\/clef>/);
});

test('focused parts preserve complete source metadata and bar durations with readable arrangement and lyric cues', async () => {
  const input = await inputs(), song = await compileSheetsSong(input.source, input.mapping);
  const { report: canonicalReport } = await importSheetMusicXml(input);
  for (const sheet of await createMusicianSheets(input)) {
    const doc = parsed(sheet.xml);
    assert.equal(doc.part.length, 1);
    assert.equal(doc.part[0].id, `P${sheet.labelCell}`);
    assert.deepEqual(doc.part[0].measure.map(measure => Number(measure.number)), Array.from({ length: 218 }, (_, i) => i + 1));
    for (const measure of doc.part[0].measure) {
      assert.equal(measure.note.reduce((sum, note) => sum + Number(note.duration), 0), 3840);
      const bar = song.chart.bars[Number(measure.number) - 1];
      const raw = input.source.values[Number(sheet.labelCell.slice(1)) - 1]?.[bar.column - 1] ?? '';
      assert.ok(measure.note.every(note => note['print-object'] === (raw.trim() ? 'no' : undefined)), 'Authored blank cells are visible rests; active cells reserve blank writing space');
    }
    const fields = new Map(doc.identification.miscellaneous['miscellaneous-field'].map(field => [field.name, field['#text']]));
    assert.deepEqual(JSON.parse(fields.get('show-tools:source') ?? ''), input.source);
    assert.deepEqual(JSON.parse(fields.get('show-tools:mapping') ?? ''), input.mapping);
    assert.deepEqual(JSON.parse(fields.get('show-tools:selected-label-cells') ?? ''), [sheet.labelCell]);
    assert.deepEqual(JSON.parse(fields.get('show-tools:condensation') ?? ''), sheet.condensation);
    assert.deepEqual([...sheet.xml.matchAll(/<multiple-rest use-symbols="no">([0-9]+)<\/multiple-rest>/g)].map(match => Number(match[1])),
      sheet.condensation.rests.map(rest => rest.endBar - rest.startBar + 1));
    const words = doc.part[0].measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => {
      const word = direction['direction-type'].words;
      return word ? [{ bar: Number(measure.number), ...word }] : [];
    }));
    const row = Number(sheet.labelCell.slice(1)) - 1;
    for (const bar of song.chart.bars) {
      const raw = input.source.values[row]?.[bar.column - 1] ?? '';
      const cell = canonicalReport.parts.find(part => part.labelCell === sheet.labelCell)?.cells.find(cell => cell.bar === bar.bar);
      const display = cell ? instrumentCue(cell.cell, canonicalReport) : '';
      if (display) assert.ok(words.some(word => word.bar === bar.bar && word.id.startsWith('chart-') && word['#text'] === display));
    }
    const rehearsals = doc.part[0].measure.flatMap(measure => (measure.direction ?? []).flatMap(direction => {
      const rehearsal = direction['direction-type'].rehearsal;
      return rehearsal ? [[Number(measure.number), rehearsal]] : [];
    }));
    assert.deepEqual(rehearsals, song.chart.sections.map(section => [section.startBar, section.label]));
    assert.ok(words.some(word => word.bar === 13 && word['#text'] === 'Vocal cue: Walking up to me expecting...'));
    assert.ok(words.some(word => word.bar === 201 && word['#text'] === 'Vocal cue: Show.'));
    assert.ok(sheet.pages.some(page => page.includes('Instrumental A4') && page.includes('Show.')));
  }
});

test('selection excludes AF rows without substituting unrelated musician parts', async () => {
  const input = await inputs();
  assert.deepEqual(await createMusicianSheets({ ...input, selectedRows: [8, 9, 10, 11, 12, 13] }), []);
  assert.deepEqual((await createMusicianSheets({ ...input, selectedRows: [14, 10, 14] })).map(sheet => sheet.labelCell), ['A14']);
  assert.deepEqual((await createMusicianSheets({ ...input, selectedRows: [15, 14] })).map(sheet => sheet.labelCell), ['A14', 'A15']);
});

test('confirmed section reuse keeps current bar coverage and an explicit source and resume point', async () => {
  const input = await inputs(), [original] = await createMusicianSheets({ ...input, selectedRows: [14] });
  const reuse = { sourceDigest: original.condensation.sourceDigest, mappingDigest: original.condensation.mappingDigest,
    references: [{ partLabelCell: 'A14', sectionStartBar: 93, sourceSectionStartBar: 85, equivalence: 'musician-confirmed' }] };
  const [sheet] = await createMusicianSheets({ ...input, selectedRows: [14], reuse });
  assert.deepEqual(sheet.pages.flatMap(coveredBars), Array.from({ length: 218 }, (_, index) => index + 1));
  assert.ok(sheet.pages.some(page => page.includes('data-reference-start="93" data-reference-end="100" data-reference-source="85"')));
  assert.ok(sheet.pages.some(page => page.includes('As Verse B1, bars 85-92. 8 bars; continue at 101.')));
  assert.equal(parsed(sheet.xml).part[0].measure.length, 218);
  assert.deepEqual(sheet.condensation.references, [{ partLabelCell: 'A14', sectionStartBar: 93, sourceSectionStartBar: 85, equivalence: 'musician-confirmed' }]);
  assert.doesNotMatch(sheet.xml, /<(?:coda|segno)(?:>|\s)|<sound[^>]*(?:dalsegno|tocoda|dacapo)=/);
});

test('musician XML, printable HTML and page SVGs are deterministic across input object ordering', async () => {
  const input = await inputs();
  const original = await createMusicianSheets(input);
  const reorderedXml = await importSheetMusicXml({ source: { ...input.source, notes: Object.fromEntries(Object.entries(input.source.notes).reverse()) },
    mapping: Object.fromEntries(Object.entries(input.mapping).reverse()) });
  const reordered = await createMusicianSheets({ musicxml: reorderedXml.xml });
  assert.deepEqual(reordered, original);
  assert.deepEqual(await createMusicianSheets(input), original);
});

test('long vocal text wraps into more cue lines while preserving the exact cue in MusicXML', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  const longCue = Array.from({ length: 30 }, (_, i) => `lyric${i} phrase${i}`).join(' ');
  values[7][14] = longCue;
  const sheets = await createMusicianSheets({ musicxml: (await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping })).xml });
  for (const sheet of sheets) {
    assert.match(sheet.xml, new RegExp(`Vocal cue: ${longCue}`));
    const lines = sheet.pages.flatMap(cueLines);
    assert.ok(lines.filter(line => line.includes('lyric') || line.includes('phrase')).length > 1);
    assert.ok(lines.every(line => [...line].length <= 60));
    for (let i = 0; i < 30; i++) assert.ok(lines.join(' ').includes(`lyric${i} phrase${i}`));
    assert.deepEqual(sheet.pages.flatMap(coveredBars), Array.from({ length: 218 }, (_, i) => i + 1));
  }
});

test('source resembling scripts is escaped in all printable outputs and stale capture mappings remain diagnosed in inspectable drafts', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[7][14] = '<script>alert("cue")</script> & "friends"';
  const sheets = await createMusicianSheets({ musicxml: (await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping })).xml });
  for (const sheet of sheets) {
    assert.doesNotMatch(sheet.html, /<script>/);
    assert.doesNotMatch(sheet.xml, /<script>/);
    assert.ok(sheet.pages.some(page => page.includes('&lt;script&gt;')));
    for (const page of sheet.pages) assert.equal(XMLValidator.validate(page), true);
  }
  values[10][97] = '';
  const draft = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
  assert.equal(draft.report.nativeCompilationExecutable, false);
  assert.ok(draft.report.compilerDiagnostics.some(diagnostic => diagnostic.source.a1 === 'CT11'));
});


test('feel summaries sit in section headings and reserve bar ranges for internal changes', async () => {
  const input = await inputs(), { report } = await importSheetMusicXml(input);
  const bass = report.parts.find(part => part.labelCell === 'A14');
  assert.ok(bass);
  const ranges = musicianFeelRanges(bass, report);
  for (const expected of [
    { startBar: 77, endBar: 84, text: 'Funky' },
    { startBar: 101, endBar: 108, text: 'Extra funky' },
    { startBar: 125, endBar: 132, text: 'Funky' },
    { startBar: 133, endBar: 136, text: 'Extra funky' },
  ]) assert.ok(ranges.some(range => JSON.stringify(range) === JSON.stringify(expected)));
  const [sheet] = await createMusicianSheets({ ...input, selectedRows: [14] });
  assert.doesNotMatch(sheet.pages.join(''), />[-!]+<\/text>/);
  for (const [label, summary] of [
    ['Intro B1', 'Funky'], ['Chorus B1', 'Extra funky'],
    ['Chorus B2', 'Funky; Extra funky, bars 133-136'], ['Chorus B3', 'Funky'],
  ]) {
    const headings = sheet.pages.flatMap(page => [...page.matchAll(/<text data-section="[^"]+"[^>]*><tspan>([^<]+)<\/tspan><tspan data-section-feel="true"[^>]*>([^<]+)<\/tspan><\/text>/g)])
      .filter(match => match[1] === label);
    assert.ok(headings.length > 0);
    assert.ok(headings.every(match => match[2] === summary));
    assert.ok(sheet.xml.includes(`${summary}</words>`));
  }
  assert.equal(sheet.pages.filter(page => page.includes('Funky; Extra funky, bars 133-136')).length, 2, 'Section continuation pages repeat the full heading context');
  assert.doesNotMatch(sheet.pages.join(''), /data-feel-start|Funky[^<]*bars 77-84|Extra funky[^<]*bars 101-108/);
  assert.equal(sectionFeelSummary({ id: 'test', label: 'Test', startBar: 1, endBar: 8 }, [
    { startBar: 1, endBar: 4, text: 'Funky' },
  ]), 'Funky, bars 1-4', 'A partial feel cannot silently apply to normal bars');
});

test('lyrics anchor to their own bar, and the accented and is exclusively a timed vocal cue', async () => {
  for (const sheet of await createMusicianSheets(await inputs())) {
    const svg = sheet.pages.join('');
    assert.doesNotMatch(svg, /from b\.125|b\.125:/);
    assert.match(svg, /data-vocal-bar="125">[^]*?>Show!<\/text>/);
    assert.match(svg, /data-vocal-bar="137">[^]*?>Put your little/);
    assert.match(svg, /data-vocal-bar="143">[^]*?data-vocal-accent="true"[^]*?data-vocal-count-offset="2.5"[^]*?>&amp;<\/text><\/g>/);
    assert.match(svg, /data-vocal-bar="144">[^]*?>Hey!<\/text>/);
    const measure143 = /<measure number="143">([^]*?)<\/measure>/.exec(sheet.xml)?.[1] ?? '';
    assert.match(measure143, /id="vocal-[^"]+-count"[^]*?Vocal cue: 3<\/words><\/direction-type><offset>1920<\/offset>/);
    assert.match(measure143, /id="vocal-[^"]+-and"[^]*?Vocal cue: &gt; &amp;<\/words><\/direction-type><offset>2400<\/offset>/);
    assert.doesNotMatch(sheet.xml, /carried-vocal-/);
  }
});
