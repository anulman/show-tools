import assert from 'node:assert/strict';
import test from 'node:test';
import { importSheetMusicXml } from '../../performance/sheet-musicxml.js';
import { readMusicXmlSong } from '../../performance/musicxml-song.js';
import { parseSongSource } from '../../performance/song-source.js';
import { columnName } from '../../performance/columns.js';
import sourceInput from '../../../songs/dance-yrself-clean.source.json';
import mapping from '../../../songs/dance-yrself-clean.cutover.mapping.json';
import { deriveMainVocalSections } from '../main-vocal-sections.js';

const source = parseSongSource(sourceInput);
const { xml: musicxml } = await importSheetMusicXml({ source, mapping });
const { song: compiled, report } = await readMusicXmlSong(musicxml);

test('DYC lyric starts enable complete sections even when their section name is Instrumental', () => {
  const sections = deriveMainVocalSections({ compiled, source, annotations: report.annotations });
  assert.deepEqual(sections.filter(section => section.eligibility.kind === 'lyric').map(section => section.startBar), [13, 29, 53, 85, 93, 101, 109, 117, 125, 137, 153, 161, 169, 177, 185, 193, 201, 209]);
  assert.equal(sections.some(section => section.eligibility.kind === 'unresolved'), false);
  const instrumental = sections.find(section => section.startBar === 201);
  assert.equal(instrumental?.eligibility.kind, 'lyric');
  assert.equal(instrumental?.startCount, 800);
  assert.equal(instrumental?.endCount, 832);
  assert.equal(instrumental?.source.text, 'Show.');
});

test('section eligibility uses its leftmost vocal cell and retains exact source provenance', async () => {
  const values = source.values.map(row => [...row]);
  const firstBar = compiled.chart.bars[0];
  values[7][firstBar.column - 1] = 'Hello!';
  values[7][firstBar.column] = '';
  const cell = `${columnName(firstBar.column)}8`;
  const changedSource = { ...source, values, notes: { ...source.notes, [cell]: 'Section lyric' } };
  const { xml } = await importSheetMusicXml({ source: changedSource, mapping });
  const { song: changed, report: changedReport } = await readMusicXmlSong(xml);
  const first = deriveMainVocalSections({ compiled: changed, source: changedSource, annotations: changedReport.annotations })[0];
  assert.equal(first.eligibility.kind, 'lyric');
  assert.deepEqual([first.startCount, first.endCount], [0, 48]);
  assert.deepEqual(first.source, { sheetId: source.sheetId, a1: cell, text: 'Hello!', note: 'Section lyric' });
  const next = deriveMainVocalSections({ compiled: changed, source: changedSource, annotations: changedReport.annotations })[1];
  assert.equal(first.endCount, next.startCount);
});

test('unsupported marks remain unresolved and known notation does not become a lyric', async () => {
  for (const [text, expected] of [['???', 'unresolved'], ['&e', 'unresolved'], ['1&a', 'inactive'], ['-', 'inactive'], ['!!', 'inactive']]) {
    const values = source.values.map(row => [...row]);
    values[7][compiled.chart.bars[0].column - 1] = text;
    const changedSource = { ...source, values };
    const { xml } = await importSheetMusicXml({ source: changedSource, mapping });
    const { song: changed, report: changedReport } = await readMusicXmlSong(xml);
    assert.equal(deriveMainVocalSections({ compiled: changed, source: changedSource, annotations: changedReport.annotations })[0].eligibility.kind, expected);
  }
});

test('main section lookup respects a snapshot range outside A1', () => {
  const offsetSource = { ...source, range: 'C7:HL55', values: source.values.slice(6).map(row => row.slice(2)) };
  assert.deepEqual(deriveMainVocalSections({ compiled, source: offsetSource, annotations: report.annotations }), deriveMainVocalSections({ compiled, source, annotations: report.annotations }));
});
