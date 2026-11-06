import { Schema } from 'effect';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const SpreadsheetId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{20,}$/));
const CellAddress = Schema.String.check(Schema.isPattern(/^[A-Z]+[1-9][0-9]*$/));
const CellRange = Schema.String.check(Schema.isPattern(/^[A-Z]+[1-9][0-9]*:[A-Z]+[1-9][0-9]*$/));
export const SongSourceSchema = Schema.Struct({
  sourceVersion: Schema.Literal(1),
  spreadsheetId: SpreadsheetId,
  sheetId: Schema.Natural,
  sheetName: Schema.NonEmptyString,
  range: CellRange,
  values: Schema.Array(Schema.Array(Schema.String)),
  notes: Schema.Record(CellAddress, Schema.String),
});
export type SongSource = typeof SongSourceSchema.Type;
export const parseSongSource = Schema.decodeUnknownSync(SongSourceSchema);
export const decodeSongSource = parseSongSource;

const WorksheetLocationSchema = Schema.Struct({ spreadsheetId: SpreadsheetId, sheetId: Schema.Natural });
export type WorksheetLocation = typeof WorksheetLocationSchema.Type;

export function parseWorksheetUrl(input: string): WorksheetLocation {
  const url = new URL(input);
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})(?:\/edit)?\/?$/.exec(url.pathname);
  if (url.origin !== 'https://docs.google.com' || url.username || url.password || !match) {
    throw new Error('Expected an HTTPS Google Sheets worksheet URL.');
  }
  const ids = [...url.searchParams.getAll('gid'), ...new URLSearchParams(url.hash.slice(1)).getAll('gid')];
  if (!ids.length || ids.some(value => !/^\d+$/.test(value)) || ids.some(value => value !== ids[0])) {
    throw new Error('Specify one consistent numeric worksheet gid in the URL.');
  }
  const sheetId = Number(ids[0]);
  if (!Number.isSafeInteger(sheetId)) throw new Error('Worksheet gid is outside the supported integer range.');
  return Schema.decodeUnknownSync(WorksheetLocationSchema)({ spreadsheetId: match[1], sheetId });
}

export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, '');
  if (!text) return [];
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false, newline = false;
  for (let index = 0; index < text.length; index++) {
    const symbol = text[index];
    if (quoted) {
      if (symbol === '"') {
        if (text[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closed = true; }
      } else if (symbol === '\r') {
        field += '\n';
        if (text[index + 1] === '\n') index++;
      } else field += symbol;
      newline = false;
      continue;
    }
    if (symbol === ',') { row.push(field); field = ''; closed = false; newline = false; }
    else if (symbol === '\n' || symbol === '\r') {
      row.push(field); rows.push(row); row = []; field = ''; closed = false; newline = true;
      if (symbol === '\r' && text[index + 1] === '\n') index++;
    } else if (symbol === '"' && !field && !closed) { quoted = true; newline = false; }
    else {
      if (closed || symbol === '"') throw new Error(`Malformed CSV near character ${index + 1}.`);
      field += symbol; newline = false;
    }
  }
  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (!newline) { row.push(field); rows.push(row); }
  return rows;
}

const XmlText = Schema.Union([Schema.String, Schema.Struct({ '#text': Schema.optionalKey(Schema.String) })]);
const RichText = Schema.Struct({
  t: Schema.optionalKey(XmlText),
  r: Schema.optionalKey(Schema.Array(Schema.Struct({ t: Schema.optionalKey(XmlText) }))),
});
const Workbook = Schema.Struct({ workbook: Schema.Struct({ sheets: Schema.Struct({
  sheet: Schema.Array(Schema.Struct({ name: Schema.NonEmptyString, id: Schema.NonEmptyString })),
}) }) });
const Relationships = Schema.Struct({ Relationships: Schema.Struct({
  Relationship: Schema.Array(Schema.Struct({ Id: Schema.String, Type: Schema.String, Target: Schema.String,
    TargetMode: Schema.optionalKey(Schema.String) })),
}) });
const Cell = Schema.Struct({ r: CellAddress, t: Schema.optionalKey(Schema.String), s: Schema.optionalKey(Schema.String), v: Schema.optionalKey(Schema.String),
  is: Schema.optionalKey(RichText) });
const SheetData = Schema.Union([Schema.Literal(''), Schema.Struct({
  row: Schema.optionalKey(Schema.Array(Schema.Struct({ c: Schema.optionalKey(Schema.Array(Cell)) }))),
})]);
const Worksheet = Schema.Struct({ worksheet: Schema.Struct({ sheetData: SheetData }) });
const SharedStrings = Schema.Struct({ sst: Schema.Struct({ si: Schema.Array(RichText) }) });
const Styles = Schema.Struct({ styleSheet: Schema.Struct({
  numFmts: Schema.optionalKey(Schema.Struct({ numFmt: Schema.Array(Schema.Struct({ numFmtId: Schema.String, formatCode: Schema.String })) })),
  cellXfs: Schema.Struct({ xf: Schema.Array(Schema.Struct({ numFmtId: Schema.String })) }),
}) });
const Comments = Schema.Struct({ comments: Schema.Struct({ commentList: Schema.Struct({
  comment: Schema.Array(Schema.Struct({ ref: CellAddress, text: RichText })),
}) }) });
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', removeNSPrefix: true,
  parseTagValue: false, parseAttributeValue: false, trimValues: false,
  isArray: (name, _path, _leaf, attribute) => !attribute && ['sheet', 'Relationship', 'si', 'row', 'c', 'comment', 'r', 'numFmt', 'xf'].includes(name) });

function plainText(value: typeof XmlText.Type | undefined): string {
  return value === undefined ? '' : typeof value === 'string' ? value : value['#text'] || '';
}
function richText(value: typeof RichText.Type): string {
  return plainText(value.t) + (value.r || []).map(run => plainText(run.t)).join('');
}
function xmlPart<T>(files: Record<string, Uint8Array>, path: string, schema: Schema.ConstraintDecoder<T>): T {
  const bytes = files[path];
  if (!bytes) throw new Error(`Workbook is missing ${path}.`);
  const unknown: unknown = parser.parse(strFromU8(bytes), true);
  return Schema.decodeUnknownSync(schema)(unknown);
}
function relatedPart(part: string, target: string): string {
  const stack = target.startsWith('/') ? [] : part.split('/').slice(0, -1);
  if (/^[a-z]+:/i.test(target) || target.includes('\\')) throw new Error('External workbook relationships are unsupported.');
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!stack.length) throw new Error('Workbook relationship escapes the archive.');
      stack.pop();
    } else stack.push(segment);
  }
  return stack.join('/');
}
function relationshipsPart(part: string): string {
  const pieces = part.split('/'), name = pieces.pop();
  return [...pieces, '_rels', `${name}.rels`].join('/');
}
function cellPosition(a1: string): { column: number; row: number } {
  const match = /^([A-Z]+)([1-9][0-9]*)$/.exec(a1);
  if (!match) throw new Error(`Invalid cell address ${a1}.`);
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row) || column > 16384 || row > 1048576) {
    throw new Error(`Cell address exceeds worksheet bounds: ${a1}.`);
  }
  return { column, row };
}
function columnName(column: number): string {
  let result = '';
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}
type WorkbookCell = { text: string; numeric: boolean; format: string | undefined; formulaError: boolean };
function worksheetCells(files: Record<string, Uint8Array>, path: string, strings: string[], styles: readonly (string | undefined)[]): Map<string, WorkbookCell> {
  const sheet = xmlPart(files, path, Worksheet).worksheet.sheetData;
  const cells = new Map<string, WorkbookCell>();
  if (typeof sheet === 'string') return cells;
  for (const row of sheet.row || []) for (const cell of row.c || []) {
    cellPosition(cell.r);
    let text = cell.v || '';
    if (cell.t === 's') {
      const index = Number(text);
      if (!/^\d+$/.test(text) || !Number.isSafeInteger(index) || strings[index] === undefined) throw new Error(`Invalid shared string at ${cell.r}.`);
      text = strings[index];
    } else if (cell.t === 'inlineStr') text = cell.is ? richText(cell.is) : '';
    else if (cell.t === 'b') text = text === '1' ? 'TRUE' : 'FALSE';
    const numeric = !cell.t || cell.t === 'n';
    if (text) cells.set(cell.r, { text: text.replace(/\r\n?/g, '\n'), numeric,
      format: cell.s === undefined ? undefined : styles[Number(cell.s)], formulaError: cell.t === 'e' });
  }
  return cells;
}
function equalCell(csv: string, cell: WorkbookCell | undefined): boolean {
  if (csv === (cell?.text || '')) return true;
  if (cell?.numeric && (cell.format === 'm/d' || cell.format === 'm d') && Number(cell.text) >= 61) {
    const date = new Date(Date.UTC(1899, 11, 30) + Number(cell.text) * 86400000);
    const separator = cell.format === 'm/d' ? '/' : ' ';
    if (`${date.getUTCMonth() + 1}${separator}${date.getUTCDate()}` === csv) return true;
  }
  return cell?.numeric === true && /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(csv)
    && Number.isFinite(Number(cell.text)) && Number(csv) === Number(cell.text);
}
function worksheetMatches(values: string[][], cells: Map<string, WorkbookCell>): boolean {
  for (let row = 0; row < values.length; row++) for (let column = 0; column < values[row].length; column++) {
    if (!equalCell(values[row][column], cells.get(`${columnName(column + 1)}${row + 1}`))) return false;
  }
  for (const [a1, cell] of cells) {
    const position = cellPosition(a1);
    if (!equalCell(values[position.row - 1]?.[position.column - 1] || '', cell)) return false;
  }
  return true;
}

export function parseWorkbookSource(csv: string, workbook: Uint8Array, location: WorksheetLocation & { sheetName?: string }): SongSource {
  const values = parseCsv(csv);
  if (!values.length) throw new Error('Worksheet CSV is empty.');
  const files = unzipSync(workbook, { filter: entry => /\.xml(?:\.rels)?$/.test(entry.name) || entry.name.endsWith('.rels') });
  const book = xmlPart(files, 'xl/workbook.xml', Workbook).workbook;
  const relationships = xmlPart(files, 'xl/_rels/workbook.xml.rels', Relationships).Relationships.Relationship;
  const strings = files['xl/sharedStrings.xml'] ? xmlPart(files, 'xl/sharedStrings.xml', SharedStrings).sst.si.map(richText) : [];
  const styleSheet = files['xl/styles.xml'] ? xmlPart(files, 'xl/styles.xml', Styles).styleSheet : undefined;
  const formats = new Map((styleSheet?.numFmts?.numFmt || []).map(entry => [entry.numFmtId, entry.formatCode]));
  const styles = (styleSheet?.cellXfs.xf || []).map(entry => formats.get(entry.numFmtId));
  const candidates: { name: string; path: string }[] = [];
  for (const sheet of book.sheets.sheet) {
    if (location.sheetName !== undefined && sheet.name !== location.sheetName) continue;
    const relationship = relationships.find(entry => entry.Id === sheet.id && entry.Type.endsWith('/worksheet'));
    if (!relationship || relationship.TargetMode === 'External') throw new Error(`Missing worksheet relationship for ${sheet.name}.`);
    const path = relatedPart('xl/workbook.xml', relationship.Target);
    if (worksheetMatches(values, worksheetCells(files, path, strings, styles))) candidates.push({ name: sheet.name, path });
  }
  if (candidates.length !== 1) throw new Error(candidates.length ? 'Worksheet contents match multiple sheets. Supply an explicit sheetName.' : 'CSV and workbook worksheet values differ. Refresh both exports or check the sheet mapping.');
  const selected = candidates[0];
  for (const [a1, cell] of worksheetCells(files, selected.path, strings, styles)) {
    if (cell.formulaError) throw new Error(`Worksheet formula error at ${a1}: ${cell.text}.`);
  }
  const notes: Record<string, string> = {};
  const relationPath = relationshipsPart(selected.path);
  if (files[relationPath]) {
    const selectedRelations = xmlPart(files, relationPath, Relationships).Relationships.Relationship;
    const commentRelations = selectedRelations.filter(entry => entry.Type.endsWith('/comments'));
    for (const relation of commentRelations) {
      if (relation.TargetMode === 'External') throw new Error('External worksheet notes are unsupported.');
      const path = relatedPart(selected.path, relation.Target);
      for (const comment of xmlPart(files, path, Comments).comments.commentList.comment) notes[comment.ref] = richText(comment.text).replace(/\r\n?/g, '\n');
    }
  }
  let width = Math.max(1, ...values.map(row => row.length)), height = values.length;
  for (const a1 of Object.keys(notes)) { const cell = cellPosition(a1); width = Math.max(width, cell.column); height = Math.max(height, cell.row); }
  return parseSongSource({ sourceVersion: 1, spreadsheetId: location.spreadsheetId, sheetId: location.sheetId,
    sheetName: selected.name, range: `A1:${columnName(width)}${height}`, values, notes });
}

export async function fetchSongSource(input: string, options: { signal?: AbortSignal; sheetName?: string } = {}): Promise<SongSource> {
  const location = parseWorksheetUrl(input);
  const base = `https://docs.google.com/spreadsheets/d/${location.spreadsheetId}/export`;
  const [csv, workbook] = await Promise.all([
    fetch(`${base}?format=csv&gid=${location.sheetId}`, { signal: options.signal }),
    fetch(`${base}?format=xlsx`, { signal: options.signal }),
  ]);
  if (!csv.ok) throw new Error(`Public worksheet CSV fetch failed (${csv.status}). Check read access or import a frozen source.`);
  if (!workbook.ok) throw new Error(`Public workbook notes fetch failed (${workbook.status}). CSV alone cannot supply notes; import it with an explicit notes sidecar.`);
  const [csvText, bytes] = await Promise.all([csv.text(), workbook.arrayBuffer()]);
  return parseWorkbookSource(csvText, new Uint8Array(bytes), { ...location, sheetName: options.sheetName });
}

export function canonicalSourceJson(input: unknown): string {
  const source = parseSongSource(input);
  const notes = Object.fromEntries(Object.entries(source.notes).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([a1, text]) => [a1, text.replace(/\r\n?/g, '\n')]));
  return JSON.stringify({ notes, range: source.range, sheetId: source.sheetId, sheetName: source.sheetName,
    sourceVersion: source.sourceVersion, spreadsheetId: source.spreadsheetId,
    values: source.values.map(row => row.map(text => text.replace(/\r\n?/g, '\n'))) }, null, 2) + '\n';
}
