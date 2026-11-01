import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { unzipSync, strFromU8 } from 'fflate';
import { buildSheetsMusicXml } from '../build-sheets-musicxml.js';
import { prepareSelectedMusicXml } from '../../ui/sheets-musicxml/export.js';
import { importSheetMusicXml } from '../../lib/performance/sheet-musicxml.js';
import { parseSongSource } from '../../lib/performance/song-source.js';
import { decodeSongMapping } from '../../lib/performance/compiled-song.js';

async function inputs() {
  const source = parseSongSource(JSON.parse(await readFile(new URL('../../songs/dance-yrself-clean.source.json', import.meta.url), 'utf8')));
  const mapping = decodeSongMapping(JSON.parse(await readFile(new URL('../../songs/dance-yrself-clean.mapping.json', import.meta.url), 'utf8')));
  return { source, mapping };
}

test('selected voices retain full-song context and identical selection yields identical MusicXML', async () => {
  const input = await inputs();
  const selected = await prepareSelectedMusicXml({ source: input.source, selection: [{ firstRow: 11, lastRow: 12 }] });
  assert.deepEqual(selected.report.selectedLabelCells, ['A11', 'A12']);
  assert.equal(selected.report.measureCount, 218);
  assert.equal(selected.filename, 'dance-yrself-clean.musicxml');
  assert.match(selected.xml, /show-tools:selected-label-cells[^>]*>\[&quot;A11&quot;,&quot;A12&quot;\]/);
  assert.equal(selected.xml, (await importSheetMusicXml({ ...input, selectedRows: [12, 11, 11] })).xml);
  assert.equal(selected.xml, (await prepareSelectedMusicXml({ source: input.source, selection: [
    { firstRow: 12, lastRow: 12 }, { firstRow: 11, lastRow: 12 }, { firstRow: 1, lastRow: 5 },
  ] })).xml);
  assert.match(selected.xml, /Walking up to me expecting/);
  assert.match(selected.xml, /sourceArmCell/);
  assert.equal((await prepareSelectedMusicXml({ source: input.source, selection: [{ firstRow: 1, lastRow: 1048576 }] })).xml,
    (await importSheetMusicXml(input)).xml);
});

test('empty/control-only/invalid selections and a stale source fail instead of exporting all voices', async () => {
  const input = await inputs();
  for (const selection of [[], [{ firstRow: 17, lastRow: 21 }]]) {
    await assert.rejects(prepareSelectedMusicXml({ source: input.source, selection }), /Select at least one voice/);
  }
  await assert.rejects(prepareSelectedMusicXml({ source: input.source, selection: [{ firstRow: 12, lastRow: 11 }] }), /Invalid selected/);
  await assert.rejects(prepareSelectedMusicXml({ source: input.source, selection: [{ firstRow: .5, lastRow: 12 }] }));
  const values = input.source.values.map(row => [...row]); values[10][97] = '';
  await assert.rejects(prepareSelectedMusicXml({ source: { ...input.source, values }, selection: [{ firstRow: 12, lastRow: 12 }] }), /CT11/);
});

test('selected reference musicians get separate writing sheets while AF voices stay managed', async () => {
  const { source } = await inputs();
  const selected = await prepareSelectedMusicXml({ source, selection: [{ firstRow: 14, lastRow: 15 }] });
  assert.deepEqual(selected.musicianSheets.map(sheet => sheet.name), ['Bass', 'Drums']);
  assert.deepEqual(selected.musicianSheets.map(sheet => sheet.pages.length), [4, 5]);
  for (const sheet of selected.musicianSheets) {
    assert.match(sheet.xml, /<staff-lines>5<\/staff-lines>/);
    assert.match(sheet.html, /Print \/ Save PDF/);
  }
  const mixed = await prepareSelectedMusicXml({ source, selection: [{ firstRow: 13, lastRow: 14 }] });
  assert.deepEqual(mixed.musicianSheets.map(sheet => sheet.name), ['Bass']);
});

test('bound-script package is deterministic, exposes top-level functions and reads only configured chart data', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'sheets-musicxml-'));
  try {
    const first = join(temporary, 'first'), second = join(temporary, 'second');
    await buildSheetsMusicXml(first); await buildSheetsMusicXml(second);
    for (const name of ['Code.gs', 'Export.html', 'appsscript.json', 'show-tools-musicxml.zip']) {
      assert.deepEqual(await readFile(join(first, name)), await readFile(join(second, name)));
    }
    await assert.rejects(buildSheetsMusicXml(first), /EEXIST/);
    const code = await readFile(join(first, 'Code.gs'), 'utf8');
    const html = await readFile(join(first, 'Export.html'), 'utf8');
    assert.equal((html.match(/<script>/g) ?? []).length, 1);
    assert.equal((html.match(/<\/script>/g) ?? []).length, 1);
    assert.equal(html.includes('<!-- export-bundle -->'), false);
    assert.deepEqual(JSON.parse(await readFile(join(first, 'appsscript.json'), 'utf8')).oauthScopes,
      ['https://www.googleapis.com/auth/spreadsheets.currentonly', 'https://www.googleapis.com/auth/script.container.ui']);
    const zip = unzipSync(await readFile(join(first, 'show-tools-musicxml.zip')));
    assert.equal(strFromU8(zip['Code.gs']), code);
    assert.equal(strFromU8(zip['Export.html']), html);
    const input = await inputs();
    const notes = input.source.values.map(row => row.map(() => ''));
    for (const [cell, text] of Object.entries(input.source.notes)) {
      const match = /^([A-Z]+)(\d+)$/.exec(cell); assert.ok(match);
      const column = [...match[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
      notes[Number(match[2]) - 1] ??= []; notes[Number(match[2]) - 1][column - 1] = text;
    }
    const calls: string[] = [];
    let activeSheetId = input.source.sheetId;
    const sheet = {
      getSheetId: () => activeSheetId, getName: () => input.source.sheetName,
      getActiveRangeList: () => ({ getRanges: () => [{ getRow: () => 11, getNumRows: () => 2 }] }),
      getRange: (range: string) => { calls.push(range); return { getDisplayValues: () => input.source.values, getNotes: () => notes }; },
    };
    const context = vm.createContext({ SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getId: () => input.source.spreadsheetId, getActiveSheet: () => sheet }),
      getUi: () => ({ createMenu: (name: string) => ({ addItem: (label: string, handler: string) => ({ addToUi: () => calls.push(`${name}/${label}/${handler}`) }) }) }),
    } });
    vm.runInContext(code, context);
    vm.runInContext('onOpen()', context);
    const payload: unknown = JSON.parse(vm.runInContext('JSON.stringify(getMusicXmlSelection())', context));
    const converted = await prepareSelectedMusicXml(payload);
    assert.deepEqual(converted.report.selectedLabelCells, ['A11', 'A12']);
    assert.equal(converted.xml, (await prepareSelectedMusicXml({ source: input.source, selection: [{ firstRow: 11, lastRow: 12 }] })).xml);
    assert.ok(calls.includes(input.source.range));
    assert.ok(calls.some(call => call.endsWith('/showMusicXmlExport')));
    activeSheetId = 999;
    const before = calls.length;
    assert.throws(() => vm.runInContext('getMusicXmlSelection()', context), /supports only/);
    assert.equal(calls.length, before);
  } finally { await rm(temporary, { recursive: true, force: true }); }
});

test('source strings resembling script markup remain data, never inline executable HTML', async () => {
  const input = await inputs(), values = input.source.values.map(row => [...row]);
  values[7][14] = '</script><script>alert("test")</script>';
  const result = await prepareSelectedMusicXml({ source: { ...input.source, values }, selection: [{ firstRow: 8, lastRow: 8 }] });
  assert.match(result.xml, /&lt;\/script&gt;&lt;script&gt;/);
  assert.equal(result.xml.includes('<script>'), false);
});
