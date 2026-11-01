import { spreadsheetId, sheetId, sheetName } from '../../songs/dance-yrself-clean.mapping.json';
import { range as sourceRange } from '../../songs/dance-yrself-clean.source.json';

interface SheetRange {
  getRow(): number;
  getNumRows(): number;
  getDisplayValues(): string[][];
  getNotes(): string[][];
}
interface Sheet {
  getSheetId(): number;
  getName(): string;
  getRange(a1: string): SheetRange;
  getActiveRangeList(): { getRanges(): SheetRange[] } | null;
}
interface HtmlOutput { setWidth(width: number): HtmlOutput; setHeight(height: number): HtmlOutput }
interface SheetUi {
  createMenu(name: string): { addItem(label: string, handler: string): { addToUi(): void } };
  showModalDialog(html: HtmlOutput, title: string): void;
}
declare const SpreadsheetApp: {
  getActiveSpreadsheet(): { getId(): string; getActiveSheet(): Sheet } | null;
  getUi(): SheetUi;
};
declare const HtmlService: { createHtmlOutputFromFile(name: string): HtmlOutput };

export function onOpen(): void {
  SpreadsheetApp.getUi().createMenu('Show Tools').addItem('Export selected voices…', 'showMusicXmlExport').addToUi();
}

export function showMusicXmlExport(): void {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('Export').setWidth(580).setHeight(560), 'Export MusicXML');
}

export function getMusicXmlSelection() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) throw new Error('Open this script from the bound chart spreadsheet.');
  const sheet = spreadsheet.getActiveSheet();
  if (spreadsheet.getId() !== spreadsheetId || sheet.getSheetId() !== sheetId || sheet.getName() !== sheetName) {
    throw new Error(`This experimental build supports only “${sheetName}” (worksheet ${sheetId}) in the configured chart spreadsheet.`);
  }
  const selected = sheet.getActiveRangeList()?.getRanges() ?? [];
  if (!selected.length) throw new Error('Select voice or instrument rows before choosing Export.');
  const selection = selected.map(range => ({ firstRow: range.getRow(), lastRow: range.getRow() + range.getNumRows() - 1 }));
  const range = sheet.getRange(sourceRange), values = range.getDisplayValues(), notes: Record<string, string> = {};
  for (const [row, cells] of range.getNotes().entries()) for (const [column, text] of cells.entries()) {
    if (!text) continue;
    let letters = '';
    for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
    notes[`${letters}${row + 1}`] = text;
  }
  return { source: { sourceVersion: 1, spreadsheetId, sheetId, sheetName, range: sourceRange, values, notes }, selection };
}
