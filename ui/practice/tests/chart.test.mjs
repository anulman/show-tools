import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { importSheetChart, columnName, rangeForBar } from '../../../lib/performance/chart.js';
import { selectionFromEvent, selectionURL } from '../sheets-extension/selection.js';

const source = JSON.parse(await readFile(new URL('../../../songs/dance-yrself-clean.chart.json', import.meta.url)));
const chart = importSheetChart(source);

test('real chart maps bars and sections to their actual sheet columns', () => {
  assert.equal(chart.bpm, 98);
  assert.equal(chart.bars.length, 218);
  assert.equal(chart.bars[0].column, 3);
  assert.equal(chart.bars[12].section, 'Verse A1');
  assert.equal(chart.bars[76].section, 'Intro B1');
  assert.equal(chart.bars[217].partial, true);
  assert.equal(chart.bars[1].cues.R1, 'cb');
  assert.equal(chart.bars[10].cues.R2, 'x');
  assert.equal(rangeForBar(chart, 1), 'C:C');
  assert.equal(rangeForBar(chart, null, 'count-in'), 'B:B');
  assert.equal(rangeForBar(chart, 77), 'CA:CA');
  assert.equal(columnName(222), 'HN');
  assert.throws(() => rangeForBar(chart, 219));
  assert.throws(() => columnName(0));
});

test('Sheets follower selects the explicit column and preserves the current loaded document URL', () => {
  const event = { v: 1, runId: 'test-run', seq: 1, type: 'beat', state: { phase: 'playing', bar: 2,
    chart: { spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId,
      columns: chart.bars.map(bar => bar.column), leadInColumn: chart.leadInColumn } } };
  const selection = selectionFromEvent(event);
  assert.equal(selection.range, 'D:D');
  const current = `https://docs.google.com/spreadsheets/d/${chart.spreadsheetId}/edit?pli=1&gid=101#gid=101`;
  const selected = new URL(selectionURL(current, selection));
  assert.equal(selected.search, '?pli=1&gid=101');
  assert.equal(new URLSearchParams(selected.hash.slice(1)).get('range'), 'D:D');
  assert.equal(new URLSearchParams(new URL(selectionURL(current.replace('gid=101#gid=101', 'gid=102#gid=102'), selection)).hash.slice(1)).get('gid'), '101');
  assert.throws(() => selectionURL('https://example.com/', selection), /different spreadsheet/);
  assert.equal(selectionFromEvent({ ...event, state: { ...event.state, phase: 'idle' } }), null);
  assert.equal(selectionFromEvent({ ...event, state: { ...event.state, bar: -1 } }), null);
});
