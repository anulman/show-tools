import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { readMusicXmlSong, writeMusicXmlSong, compileMusicXmlSong, MUSICXML_SONG_PROFILE } from '../musicxml-song.js';
import type { CatalogDocument } from '../../voice-catalog/model.js';
import { createMusicianSheets } from '../musician-sheets.js';
import { scoreXmlText } from '../score-xml.js';
import { Schema } from 'effect';
import { XMLParser } from 'fast-xml-parser';
import { compileSheetsSong } from '../compiled-song.js';

async function fixture() {
  const [source, mapping] = await Promise.all(['source', 'cutover.mapping'].map(async suffix =>
    JSON.parse(await readFile(new URL(`../../../songs/dance-yrself-clean.${suffix}.json`, import.meta.url), 'utf8'))));
  const result = await importSheetMusicXml({ source, mapping });
  return { source, mapping, ...result };
}

function removeField(xml: string, field: string): string {
  return xml.replace(new RegExp(`<miscellaneous-field name="${field}">[^]*?<\\/miscellaneous-field>`), '');
}

test('canonical MusicXML supplies the complete runtime and notation without either archived JSON input', async () => {
  const input = await fixture(), expected = await compileSheetsSong(input.source, input.mapping);
  const document = await readMusicXmlSong(input.xml);
  assert.equal(document.report.profile, MUSICXML_SONG_PROFILE);
  assert.deepEqual(document.song, { ...expected, source: { ...expected.source, digest: document.song.source.digest }, mappingDigest: document.song.mappingDigest });
  assert.deepEqual(document.source, input.source);
  assert.deepEqual(document.mapping, input.mapping);
  const stripped = removeField(removeField(input.xml, 'show-tools:source'), 'show-tools:mapping');
  const standalone = await readMusicXmlSong(stripped);
  assert.equal(standalone.source, null);
  assert.equal(standalone.mapping, null);
  assert.deepEqual(standalone.song, document.song);
  assert.deepEqual(standalone.report, document.report);
  assert.deepEqual(await compileMusicXmlSong(stripped), document.song);
});

test('standard MusicXML title, tempo, part names, section labels and lyric words drive the model', async () => {
  const { xml } = await fixture();
  const changed = xml.replace('<work-title>Dance Yrself Clean</work-title>', '<work-title>New title</work-title>')
    .replace('<per-minute>98</per-minute>', '<per-minute>100</per-minute>')
    .replace('<part-name>Bass</part-name>', '<part-name>Electric bass</part-name>')
    .replace('<part-name>Whistle</part-name>', '<part-name>Lead whistle</part-name>')
    .replace('>Intro B1</rehearsal>', '>New section</rehearsal>')
    .replace('>Hey!</words>', '>Hello!</words>');
  const document = await readMusicXmlSong(changed);
  assert.notEqual(document.song.source.digest, (await readMusicXmlSong(xml)).song.source.digest);
  assert.equal(document.song.title, 'New title');
  assert.equal(document.song.chart.title, 'New title');
  assert.equal(document.report.title, 'New title');
  assert.equal(document.song.chart.bpm, 100);
  assert.equal(document.report.bpmPerChartCount, 100);
  assert.ok(document.report.parts.some(part => part.name === 'Electric bass'));
  assert.ok(document.song.parts.some(part => part.name === 'Lead whistle'));
  assert.equal(document.song.chart.controlNames.L1, 'Lead whistle');
  assert.ok(document.song.chart.sections.some(section => section.label === 'New section'));
  assert.ok(document.report.vocalCues.some(cue => cue.bar === 144 && cue.text === 'Hello!'));
});

test('canonical writing is deterministic and semantically roundtrips without inventing note durations', async () => {
  const { xml } = await fixture(), document = await readMusicXmlSong(xml);
  assert.doesNotMatch(xml, /<(?:pitch|unpitched|notehead|dynamics)(?:\s|>)/);
  assert.match(xml, /show-tools:onset/);
  const rewritten = await writeMusicXmlSong({ song: document.song, report: document.report,
    ...(document.source ? { source: document.source } : {}), ...(document.mapping ? { mapping: document.mapping } : {}) });
  assert.equal(rewritten, xml);
  assert.deepEqual((await readMusicXmlSong(rewritten)).song, document.song);
});

test('missing semantics, projected profiles, entities and unsupported notation fail visibly', async () => {
  const { xml } = await fixture();
  await assert.rejects(readMusicXmlSong(removeField(xml, 'show-tools:performance')), /required performance metadata/);
  await assert.rejects(readMusicXmlSong(xml.replaceAll(MUSICXML_SONG_PROFILE, 'show-tools-musician-sheet-v3')), /complete canonical/);
  await assert.rejects(readMusicXmlSong('<!DOCTYPE score-partwise>' + xml), /DTD/);
  for (const element of ['harmony', 'pitch', 'dynamics', 'wedge', 'repeat']) {
    await assert.rejects(readMusicXmlSong(xml.replace('<part-list>', `<${element}/><part-list>`)), /Unsupported MusicXML element/);
  }
  await assert.rejects(readMusicXmlSong(xml.replace('<beats>4</beats>', '<beats>3</beats>')), /supports 4\/4 and 6\/8/);
});

test('voice effect and character assignments travel as validated song metadata', async () => {
  const document = await readMusicXmlSong((await fixture()).xml);
  const voices: CatalogDocument = { version: 2, revision: 1, voices: [{ id: 'bass', name: 'Bass', notes: '', characterId: 'avatar-bass',
    avatarToken: 'olive', effects: [{ kind: 'chorus', rateHz: .5, depthMs: 3, baseDelayMs: 20, wet: .2 }] }], bindings: [] };
  const input = await writeMusicXmlSong({ song: document.song, report: document.report, voices });
  assert.deepEqual((await readMusicXmlSong(input)).voices, voices);
});

test('6/8 preserves eighth-note chart counts and supports an equivalent quarter-note tempo mark', async () => {
  const input = await fixture();
  const exported = await importSheetMusicXml({ source: input.source, mapping: { ...input.mapping, meter: { numerator: 6, denominator: 8 } } });
  const document = await readMusicXmlSong(exported.xml);
  assert.deepEqual(document.song.meter, { numerator: 6, denominator: 8 });
  assert.equal(document.song.chart.bpm, 98);
  assert.match(exported.xml, /<duration>2880<\/duration>/);
  const equivalent = exported.xml.replace('<beat-unit>eighth</beat-unit><per-minute>98</per-minute>', '<beat-unit>quarter</beat-unit><per-minute>49</per-minute>');
  assert.deepEqual((await readMusicXmlSong(equivalent)).song, document.song);
});

test('an edited command cannot silently disagree with the typed performance action', async () => {
  const { xml } = await fixture();
  const changed = xml.replace(/(<words id="command-[^"]+">)[^<]+<\/words>/, '$1xb</words>');
  assert.notEqual(changed, xml);
  await assert.rejects(readMusicXmlSong(changed), /command display disagrees/);
  await assert.rejects(readMusicXmlSong(xml.replace('<direction-type>', '<direction-type><dynamics><f/></dynamics>')), /Unsupported MusicXML element/);
});

test('unsupported text timing and unknown application metadata are rejected before they can be lost', async () => {
  const { xml } = await fixture();
  const timed = xml.replace(/(<direction><direction-type><words id="vocal-O8">[^]*?<\/direction-type>)/, '$1<offset>960</offset>');
  assert.notEqual(timed, xml);
  await assert.rejects(readMusicXmlSong(timed), /Nonzero offsets/);
  await assert.rejects(readMusicXmlSong(xml.replace('</miscellaneous>', '<miscellaneous-field name="show-tools:future">valuable</miscellaneous-field></miscellaneous>')), /metadata field/);
});

test('directions cannot move after the measure spacer and silently lose their MusicXML cursor position', async () => {
  const { xml } = await fixture();
  const moved = xml.replace(/(<measure number="1">)([^]*?)(<direction>[^]*?<\/direction>)([^]*?<\/note>)/, '$1$2$4$3');
  assert.notEqual(moved, xml);
  await assert.rejects(readMusicXmlSong(moved), /must precede the measure spacer/);
});

test('canonical nested application fields are rejected instead of silently disappearing on rewrite', async () => {
  const document = await readMusicXmlSong((await fixture()).xml);
  const voices: CatalogDocument = { version: 2, revision: 0, voices: [{ id: 'voice', name: 'Voice', notes: '', characterId: null, avatarToken: 'neutral', effects: [] }], bindings: [] };
  const exported = await writeMusicXmlSong({ song: document.song, report: document.report, voices });
  const unexpectedVoice = exported.replace('&quot;notes&quot;:&quot;&quot;', '&quot;futureData&quot;:&quot;valuable&quot;,&quot;notes&quot;:&quot;&quot;');
  assert.notEqual(unexpectedVoice, exported);
  await assert.rejects(readMusicXmlSong(unexpectedVoice), /futureData/);
  const extendedVoices = { ...voices, voices: [{ ...voices.voices[0], futureData: 'valuable' }] };
  await assert.rejects(writeMusicXmlSong({ song: document.song, report: document.report, voices: extendedVoices }), /futureData/);
});

function editPerformance(xml: string, change: (performance: Record<string, unknown>) => void): string {
  return xml.replace(/(<miscellaneous-field name="show-tools:performance">)([^]*?)(<\/miscellaneous-field>)/,
    (_, start: string, content: string, end: string) => {
      const decoded: unknown = new XMLParser({ parseTagValue: false }).parse(`<value>${content}</value>`);
      const field = Schema.decodeUnknownSync(Schema.Struct({ value: Schema.String }))(decoded);
      const performance = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(JSON.parse(field.value));
      change(performance);
      return start + scoreXmlText(JSON.stringify(performance)) + end;
    });
}

test('standard feel words and timed vocal offsets drive the parsed model and printed pages', async () => {
  const { xml } = await fixture();
  const original = await readMusicXmlSong(xml);
  const changed = xml.replace(/(id="feel-[^"]+">)Funky<\/words>/, '$1Extra funky</words>')
    .replace(/(id="vocal-count-[^"]+">3<\/words><\/direction-type><offset>)1920/, '$11440')
    .replace(/(id="vocal-and-[^"]+">&amp;<\/words><\/direction-type><offset>)2400/, '$12880')
    .replace(/(id="vocal-accent-[^"]+">&gt;<\/words><\/direction-type><offset>)2400/, '$12880');
  const document = await readMusicXmlSong(changed);
  assert.notEqual(document.song.source.digest, original.song.source.digest);
  assert.equal(document.report.annotations.feels[0].text, 'Extra funky');
  const vocal = document.report.annotations.vocals.find(vocal => vocal.kind === 'count-and');
  assert.ok(vocal?.kind === 'count-and');
  assert.equal(vocal.countOffset, 1.5);
  assert.equal(vocal.andOffset, 3);
  const before = await createMusicianSheets({ musicxml: xml });
  const after = await createMusicianSheets({ musicxml: changed });
  assert.notDeepEqual(after.map(sheet => sheet.pages), before.map(sheet => sheet.pages));
  assert.match(after[0].xml, /<offset>1440<\/offset>/);
  assert.match(after[0].xml, /<offset>2880<\/offset>/);
  const rewritten = await writeMusicXmlSong({ song: document.song, report: document.report });
  assert.deepEqual((await readMusicXmlSong(rewritten)).report.annotations, document.report.annotations);
});

test('archived source glyph edits cannot override normalized activity, feel or printed instrument cues', async () => {
  const { xml } = await fixture();
  const changed = xml.replace(/(<other-direction id="source-[^"]+" print-object="no">)[^<]*(<\/other-direction>)/g, '$1IGNORED GLYPH$2');
  assert.notEqual(changed, xml);
  const before = await readMusicXmlSong(xml), after = await readMusicXmlSong(changed);
  assert.deepEqual(after.report.annotations, before.report.annotations);
  const beforeSheets = await createMusicianSheets({ musicxml: xml });
  const afterSheets = await createMusicianSheets({ musicxml: changed });
  assert.deepEqual(afterSheets.map(sheet => sheet.pages), beforeSheets.map(sheet => sheet.pages));
  const decisions = (sheets: typeof beforeSheets) => sheets.map(({ condensation: { sourceDigest, mappingDigest, ...decisions } }) => decisions);
  assert.deepEqual(decisions(afterSheets), decisions(beforeSheets));
});

test('canonical activities and complete stage annotations are required and validated', async () => {
  const { xml } = await fixture();
  const withoutActivity = xml.replace(/<direction><direction-type><other-direction id="activity-[^"]+" print-object="no">[^<]+<\/other-direction><\/direction-type><\/direction>/, '');
  assert.notEqual(withoutActivity, xml);
  await assert.rejects(readMusicXmlSong(withoutActivity), /canonical activity/);
  await assert.rejects(readMusicXmlSong(xml.replace(/(id="activity-[^"]+" print-object="no">)[^<]+/, '$1Maybe')), /canonical activity/);
  await assert.rejects(readMusicXmlSong(editPerformance(xml, performance => { delete performance.stageCells; })), /stageCells/);
  await assert.rejects(readMusicXmlSong(editPerformance(xml, performance => { performance.stageCells = []; })), /complete score/);
  await assert.rejects(readMusicXmlSong(editPerformance(xml, performance => { performance.stageCells = [{ cell: 'B1', kind: 'resolved', active: 'yes' }]; })), /stageCells/);
  const before = await readMusicXmlSong(xml);
  const stage = before.report.annotations.stageCells.find(stage => stage.kind === 'resolved');
  assert.ok(stage?.kind === 'resolved');
  await assert.rejects(readMusicXmlSong(editPerformance(xml, performance => {
    performance.stageCells = before.report.annotations.stageCells.map(({ eligibility, ...candidate }) => candidate);
  })), /eligibility/);
  await assert.rejects(readMusicXmlSong(editPerformance(xml, performance => {
    performance.stageCells = before.report.annotations.stageCells.map(candidate => ({ ...candidate, eligibility: { kind: 'inactive', reason: 'guess' } }));
  })), /eligibility/);
  const updated = before.report.annotations.stageCells.map(candidate => candidate.cell === stage.cell ? { ...stage, active: !stage.active } : candidate);
  const changed = await readMusicXmlSong(editPerformance(xml, performance => { performance.stageCells = updated; }));
  assert.notEqual(changed.song.source.digest, before.song.source.digest);
  await assert.rejects(readMusicXmlSong(editPerformance(xml, performance => {
    performance.stageCells = updated.map(candidate => candidate.cell === stage.cell ? { ...stage, accents: [4] } : candidate);
  })), /stage timing/);
});
