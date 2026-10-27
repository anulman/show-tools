import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { canonicalSourceJson, fetchSongSource, parseCsv, parseSongSource, parseWorkbookSource, parseWorksheetUrl } from '../../lib/performance/song-source.js';

const spreadsheetId = 'abcdefghijklmnopqrstuv';
const location = { spreadsheetId, sheetId: 101 };
const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=101`;
const csv = ',Dance Yrself Clean\r\nBPM,98\r\nMeter,4/4';

function workbook({ duplicate = false, badNote = false, badRelationship = false, brokenString = false, targetFormulaError = false } = {}) {
  const parts = {
    'xl/workbook.xml': `<workbook><sheets><sheet name="Other" sheetId="1" r:id="rId1"/><sheet name="DYC" sheetId="77" r:id="rId2"/>${duplicate ? '<sheet name="Copy" sheetId="78" r:id="rId3"/>' : ''}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/other.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${badRelationship ? '../../../escape.xml' : 'worksheets/target.xml'}"/>${duplicate ? '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/target.xml"/>' : ''}</Relationships>`,
    'xl/sharedStrings.xml': '<sst><si><t>Dance Yrself Clean</t></si><si><t>BPM</t></si><si><t>Meter</t></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="164" formatCode="m/d"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>',
    'xl/worksheets/other.xml': '<worksheet><sheetData><row><c r="A1" t="e"><v>#REF!</v></c></row></sheetData></worksheet>',
    'xl/worksheets/target.xml': `<worksheet><sheetData><row r="1"><c r="B1" t="s"><v>${brokenString ? 99 : 0}</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" ${targetFormulaError ? 't="e"' : ''}><v>${targetFormulaError ? '#REF!' : '98.0'}</v></c></row><row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" s="1"><v>46116.0</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/_rels/target.xml.rels': '<Relationships><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments/notes.xml"/></Relationships>',
    'xl/comments/notes.xml': `<comments><commentList><comment ref="A2"><text><t xml:space="preserve">Reference tempo </t></text></comment><comment ref="${badNote ? 'not-a-cell' : 'Z7'}"><text><r><t>Chorus &amp; </t></r><r><t>video</t></r></text></comment></commentList></comments>`,
  };
  return zipSync(Object.fromEntries(Object.entries(parts).map(([name, text]) => [name, strToU8(text)])));
}

test('CSV retains multiline quoted fields, escaped quotes, BOM, and trailing blank cells', () => {
  assert.deepEqual(parseCsv('\uFEFF"a,b","line 1\r\nline 2","a""b",\r\n,,\r\n'), [
    ['a,b', 'line 1\nline 2', 'a"b', ''], ['', '', ''],
  ]);
  assert.deepEqual(parseCsv('a,b,'), [['a', 'b', '']]);
  assert.deepEqual(parseCsv('""'), [['']]);
  assert.deepEqual(parseCsv('\n'), [['']]);
  assert.deepEqual(parseCsv(''), []);
  for (const input of ['"unfinished', 'plain"quote', '"closed"junk']) assert.throws(() => parseCsv(input), /CSV/);
});

test('worksheet URLs require an unambiguous numeric gid and Google Sheets identity', () => {
  assert.deepEqual(parseWorksheetUrl(url), location);
  assert.deepEqual(parseWorksheetUrl(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit?gid=101#gid=101&range=A1`), location);
  assert.deepEqual(parseWorksheetUrl(`https://docs.google.com/spreadsheets/d/${spreadsheetId}/?gid=0`), { spreadsheetId, sheetId: 0 });
  for (const input of [url.replace('https:', 'http:'), url.replace('docs.google.com', 'example.com'),
    url.replace('/edit#gid=101', '/edit'), url.replace('#gid=101', '?gid=102#gid=101'),
    url.replace('#gid=101', '#gid=101.5'), url.replace('#gid=101', '#gid=9007199254740992'),
    url.replace('https://', 'https://user:password@')]) assert.throws(() => parseWorksheetUrl(input));
});

test('workbook joins gid CSV to the matching sheet and preserves notes on blank cells', () => {
  const source = parseWorkbookSource(csv, workbook(), location);
  assert.equal(source.sheetName, 'DYC');
  assert.equal(source.sheetId, 101, 'XLSX internal sheetId 77 never replaces the Google worksheet ID');
  assert.equal(source.range, 'A1:Z7');
  assert.equal(source.values[1][1], '98', 'CSV display value survives numeric normalization');
  assert.equal(source.values[2][1], '4/4', 'CSV meter display survives Excel date coercion');
  assert.deepEqual(source.notes, { A2: 'Reference tempo ', Z7: 'Chorus & video' });
  assert.equal(source.values[6], undefined, 'a note on a blank cell does not invent CSV data');
});

test('mismatched or ambiguous worksheets fail instead of inventing note provenance', () => {
  assert.throws(() => parseWorkbookSource(csv.replace('98', '99'), workbook(), location), /values differ/);
  assert.throws(() => parseWorkbookSource(csv, workbook({ duplicate: true }), location), /multiple sheets/);
  assert.equal(parseWorkbookSource(csv, workbook({ duplicate: true }), { ...location, sheetName: 'DYC' }).sheetName, 'DYC');
  assert.throws(() => parseWorkbookSource(csv, workbook(), { ...location, sheetName: 'Missing' }), /values differ/);
  assert.throws(() => parseWorkbookSource(csv, workbook({ badNote: true }), location));
  assert.throws(() => parseWorkbookSource(csv, workbook({ badRelationship: true }), location), /escapes/);
  assert.throws(() => parseWorkbookSource(csv, workbook({ brokenString: true }), location), /shared string/);
  assert.throws(() => parseWorkbookSource(csv.replace('98', '#REF!'), workbook({ targetFormulaError: true }), location), /formula error at B2/);
});

test('source schema rejects untyped values and canonical serialization is deterministic', () => {
  const source = parseWorkbookSource(csv, workbook(), location);
  const reordered = { ...source, notes: { Z7: 'Chorus & video', A2: 'Reference tempo ' } };
  assert.equal(canonicalSourceJson(source), canonicalSourceJson(reordered));
  assert.equal(canonicalSourceJson({ ...source, notes: { A1: 'a\r\nb' } }), canonicalSourceJson({ ...source, notes: { A1: 'a\nb' } }));
  assert.throws(() => parseSongSource({ ...source, sourceVersion: 2 }));
  assert.throws(() => parseSongSource({ ...source, values: [[98]] }));
  assert.throws(() => parseSongSource({ ...source, sheetId: -1 }));
});

test('public fetch carries cancellation and fails explicitly when notes cannot be read', async () => {
  const originalFetch = globalThis.fetch;
  const requests: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const controller = new AbortController();
  try {
    globalThis.fetch = async (input, init) => {
      const address = String(input);
      requests.push({ url: address, signal: init?.signal });
      return address.includes('format=csv') ? new Response(csv) : new Response(workbook());
    };
    const source = await fetchSongSource(url, { signal: controller.signal });
    assert.equal(source.sheetName, 'DYC');
    assert.equal(requests.length, 2);
    assert(requests.some(request => request.url.endsWith('format=csv&gid=101')));
    assert(requests.every(request => request.signal === controller.signal));
    globalThis.fetch = async input => String(input).includes('format=csv') ? new Response(csv) : new Response('denied', { status: 403 });
    await assert.rejects(fetchSongSource(url), /notes fetch failed.*CSV alone cannot supply notes/);
    globalThis.fetch = async () => new Response('denied', { status: 403 });
    await assert.rejects(fetchSongSource(url), /CSV fetch failed/);
  } finally { globalThis.fetch = originalFetch; }
});
