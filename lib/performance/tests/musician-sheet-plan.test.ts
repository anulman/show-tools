import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importSheetMusicXml } from '../sheet-musicxml.js';
import { parseSongSource } from '../song-source.js';
import { decodeSongMapping } from '../compiled-song.js';
import { musicianRepeatCandidates, parseMusicianReuse, planMusicianRows } from '../musician-sheet-plan.js';
import type { MusicXmlReport } from '../musicxml-model.js';

async function fixture() {
  const [source, mapping] = await Promise.all(['source', 'cutover.mapping'].map(async suffix =>
    JSON.parse(await readFile(new URL(`../../../songs/dance-yrself-clean.${suffix}.json`, import.meta.url), 'utf8'))));
  const input = { source: parseSongSource(source), mapping: decodeSongMapping(mapping) };
  return { ...input, report: (await importSheetMusicXml(input)).report };
}

function musician(report: MusicXmlReport, labelCell: string) {
  const part = report.parts.find(part => part.labelCell === labelCell);
  assert.ok(part, `Missing fixture part ${labelCell}`);
  return part;
}

function reuse(report: MusicXmlReport, references: unknown[]) {
  return { sourceDigest: report.sourceDigest, mappingDigest: report.mappingDigest, references };
}

function confirmed(partLabelCell = 'A14', sectionStartBar = 93, sourceSectionStartBar = 85) {
  return { partLabelCell, sectionStartBar, sourceSectionStartBar, equivalence: 'musician-confirmed' };
}

test('condensation preserves all 218 source bars and every nonblank cue in its original order', async () => {
  const { report } = await fixture(), before = structuredClone(report);
  for (const labelCell of ['A14', 'A15']) {
    const part = musician(report, labelCell), rows = planMusicianRows(part, report, []);
    assert.deepEqual(rows.flatMap(row => row.cells), part.cells);
    assert.deepEqual(rows.flatMap(row => row.cells.map(cell => cell.bar)), Array.from({ length: 218 }, (_, i) => i + 1));
    assert.ok(rows.some(row => row.kind === 'rest' && row.cells.length >= 8));
    assert.ok(rows.every(row => row.kind !== 'rest' || row.cells.every(cell => !cell.text.trim())));
    assert.equal(rows.some(row => row.kind === 'reference'), false);
  }
  assert.deepEqual(report, before);
});

test('rests preserve Drums pickups and its brief late entry while allowing the silent two-bar outro', async () => {
  const { report } = await fixture(), part = musician(report, 'A15');
  const rows = planMusicianRows(part, report, []);
  for (const bar of [76, 160, 203, 204, 205]) {
    const row = rows.find(row => row.cells.some(cell => cell.bar === bar));
    assert.equal(row?.kind, 'staff', `Bar ${bar} must remain a writable entry`);
    assert.ok(part.cells.find(cell => cell.bar === bar)?.text.trim());
  }
  const partial = rows.find(row => row.cells.some(cell => cell.bar === 201));
  assert.equal(partial?.kind, 'staff');
  assert.ok(partial?.cells.some(cell => cell.bar === 203));
  const outro = rows.find(row => row.section.startBar === 217);
  assert.equal(outro?.kind, 'rest');
  assert.deepEqual(outro?.cells.map(cell => cell.bar), [217, 218]);
});

test('an authored vocal cue inside a long rest remains a navigable rest boundary', async () => {
  const input = await fixture(), values = input.source.values.map(row => [...row]);
  const column = values[input.mapping.barRow - 1].findIndex(text => text === '5');
  assert.ok(column >= 0);
  values[7][column] = 'Listen here';
  const { report } = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
  const rows = planMusicianRows(musician(report, 'A14'), report, []).filter(row => row.section.startBar === 1);
  assert.deepEqual(rows.map(row => [row.kind, row.cells[0].bar, row.cells.at(-1)?.bar]),
    [['rest', 1, 4], ['rest', 5, 12]]);
  assert.equal(report.vocalCues.find(cue => cue.bar === 5)?.text, 'Listen here');
  const lastSection = planMusicianRows(musician(report, 'A14'), report, []).filter(row => row.section.startBar === 201);
  assert.equal(lastSection[0].cells[0].bar, 201);
  assert.equal(report.vocalCues.find(cue => cue.bar === 201)?.text, 'Show.');
});

test('repeat candidates report exact nonempty cue matches without automatically replacing music', async () => {
  const { report } = await fixture();
  const bass = musician(report, 'A14'), drums = musician(report, 'A15');
  const bassCandidates = musicianRepeatCandidates(bass, report);
  assert.ok(bassCandidates.some(candidate => candidate.sectionStartBar === 93 && candidate.sourceSectionStartBar === 85 && candidate.barCount === 8));
  assert.equal(bassCandidates.some(candidate => candidate.sectionStartBar < 77), false);
  const drumCandidates = musicianRepeatCandidates(drums, report);
  assert.ok(drumCandidates.some(candidate => candidate.sectionStartBar === 193 && candidate.sourceSectionStartBar === 85));
  assert.ok(drumCandidates.some(candidate => candidate.sectionStartBar === 185 && candidate.sourceSectionStartBar === 137));
  assert.deepEqual(parseMusicianReuse(reuse(report, [confirmed('A15', 185, 137)]), report), [confirmed('A15', 185, 137)], 'Funky !- and ! have identical canonical meaning.');
  assert.equal(drumCandidates.some(candidate => candidate.sectionStartBar === 101 && candidate.sourceSectionStartBar === 77), false);
  assert.equal(planMusicianRows(bass, report, []).some(row => row.kind === 'reference'), false);
});

test('confirmed Bass section reuse retains destination bars, cues and chronology', async () => {
  const { report } = await fixture(), before = structuredClone(report);
  assert.deepEqual(parseMusicianReuse(undefined, report), []);
  const references = parseMusicianReuse(reuse(report, [confirmed()]), report);
  const rows = planMusicianRows(musician(report, 'A14'), report, references);
  const reference = rows.find(row => row.kind === 'reference');
  assert.ok(reference?.kind === 'reference');
  assert.equal(reference.section.startBar, 93);
  assert.equal(reference.source.startBar, 85);
  assert.deepEqual(reference.cells.map(cell => cell.bar), [93, 94, 95, 96, 97, 98, 99, 100]);
  assert.deepEqual(rows.flatMap(row => row.cells.map(cell => cell.bar)), Array.from({ length: 218 }, (_, i) => i + 1));
  assert.equal(report.vocalCues.find(cue => cue.bar === 93)?.text, "We've got to...");
  assert.deepEqual(report, before);
});

test('reuse rejects stale identity, unconfirmed equivalence, unknown/AF parts and unsafe ranges', async () => {
  const { report } = await fixture();
  const flip = (digest: string) => (digest[0] === '0' ? '1' : '0') + digest.slice(1);
  assert.throws(() => parseMusicianReuse({ ...reuse(report, [confirmed()]), sourceDigest: flip(report.sourceDigest) }, report), /different source or mapping/);
  assert.throws(() => parseMusicianReuse({ ...reuse(report, [confirmed()]), mappingDigest: flip(report.mappingDigest) }, report), /different source or mapping/);
  for (const reference of [
    { ...confirmed(), equivalence: 'chart-match-only' },
    { partLabelCell: 'A14', sectionStartBar: 93, sourceSectionStartBar: 85 },
    confirmed('A999'), confirmed('A10'), confirmed('A14', 94, 85),
    confirmed('A14', 85, 93), confirmed('A14', 93, 93),
    confirmed('A14', 161, 85), confirmed('A14', 125, 77),
    confirmed('A15', 69, 13), confirmed('A14', 21, 13),
  ]) assert.throws(() => parseMusicianReuse(reuse(report, [reference]), report));
  const input = await fixture();
  const selected = (await importSheetMusicXml({ source: input.source, mapping: input.mapping, selectedRows: [15] })).report;
  assert.deepEqual(parseMusicianReuse(reuse(selected, [confirmed()]), selected), [confirmed()], 'Selection does not remove parts from a complete canonical document.');
});

test('references cannot duplicate a target or chain through another omitted section', async () => {
  const { report } = await fixture();
  assert.throws(() => parseMusicianReuse(reuse(report, [confirmed(), confirmed()]), report), /only one reuse/);
  assert.throws(() => parseMusicianReuse(reuse(report, [confirmed(), confirmed('A14', 109, 93)]), report), /cannot chain/);
});

test('cue comparison ignores surrounding whitespace but preserves written cue differences', async () => {
  const input = await fixture(), values = input.source.values.map(row => [...row]);
  const column = values[input.mapping.barRow - 1].findIndex(text => text === '93');
  assert.ok(column >= 0);
  values[13][column] = '  -  ';
  const { report } = await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping });
  const parsed = parseMusicianReuse(reuse(report, [confirmed()]), report);
  assert.equal(parsed.length, 1);
  values[13][column] = '!';
  const changed = (await importSheetMusicXml({ source: { ...input.source, values }, mapping: input.mapping })).report;
  assert.throws(() => parseMusicianReuse(reuse(changed, [confirmed()]), changed), /identical/);
});

test('repeat equivalence follows canonical hit timing and sampling rather than provenance text', async () => {
  const { report } = await fixture();
  const bass = musician(report, 'A14');
  const original = bass.cells.find(cell => cell.bar === 85);
  const repeated = bass.cells.find(cell => cell.bar === 93);
  assert.ok(original && repeated);
  original.reading = { kind: 'hits', offsets: [0, 1.5], sampled: false };
  repeated.reading = { kind: 'hits', offsets: [0, 1.5], sampled: false };
  repeated.text = 'Provenance must not determine equivalence';
  assert.deepEqual(parseMusicianReuse(reuse(report, [confirmed()]), report), [confirmed()]);
  assert.ok(musicianRepeatCandidates(bass, report).some(candidate => candidate.sectionStartBar === 93 && candidate.sourceSectionStartBar === 85));
  repeated.reading = { kind: 'hits', offsets: [0, 2], sampled: false };
  assert.throws(() => parseMusicianReuse(reuse(report, [confirmed()]), report), /identical/);
  assert.equal(musicianRepeatCandidates(bass, report).some(candidate => candidate.sectionStartBar === 93 && candidate.sourceSectionStartBar === 85), false);
  repeated.reading = { kind: 'hits', offsets: [0, 1.5], sampled: true };
  assert.throws(() => parseMusicianReuse(reuse(report, [confirmed()]), report), /identical/);
});
