import type { CatalogDocument } from './model.js';
import type { SongSource } from '../performance/song-source.js';
import { decodeSongMapping, type SongMapping } from '../performance/compiled-song.js';

function coordinate(cell: string) {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(cell);
  if (!match) throw new Error(`Invalid cue-row cell ${cell}`);
  return { row: Number(match[2]), column: [...match[1]].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) };
}

/** Changes compiler inputs only. Loading the inspected result remains an explicit stopped action. */
export function applyCatalogCueRows(document: CatalogDocument, source: SongSource, mapping: SongMapping): SongMapping {
  if (source.spreadsheetId !== mapping.spreadsheetId || source.sheetId !== mapping.sheetId) throw new Error('Cue mapping and source belong to different worksheets');
  const origin = coordinate(source.range.split(':')[0]);
  const text = (cell: string) => { const point = coordinate(cell); return source.values[point.row - origin.row]?.[point.column - origin.column] ?? ''; };
  function cueRow(labelCell: string): number | null {
    const binding = document.bindings.find(binding => binding.spreadsheetId === source.spreadsheetId && binding.sheetId === source.sheetId && binding.labelCell === labelCell);
    if (!binding?.cueRow) return null;
    if (text(labelCell) !== binding.sourceLabel) throw new Error(`Voice row ${labelCell} changed. Review its saved sheet connection before compiling.`);
    if (text(binding.cueRow.labelCell) !== binding.cueRow.sourceLabel) throw new Error(`Cue row ${binding.cueRow.labelCell} changed or is missing. Review its saved connection before compiling.`);
    return coordinate(binding.cueRow.labelCell).row;
  }
  const controls = mapping.controls.map(control => ({ ...control, cueRow: cueRow(`A${control.arrangementRow}`) ?? control.cueRow }));
  let rotationRule = mapping.rotationRule;
  if (rotationRule) {
    const part = mapping.liveParts.find(part => part.id === rotationRule?.voiceId);
    if (part) rotationRule = { ...rotationRule, row: cueRow(part.labelCell) ?? rotationRule.row };
  }
  for (const part of mapping.liveParts.filter(part => part.role === 'default-live')) {
    if (cueRow(part.labelCell) !== null) throw new Error(`The default live voice at ${part.labelCell} has no command-row control. A cue connection does not assign a control.`);
  }
  return decodeSongMapping({ ...mapping, controls, rotationRule });
}
