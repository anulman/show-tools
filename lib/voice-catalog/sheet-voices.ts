import type { CompiledSong } from '../performance/compiled-song.js';
import type { SongSource } from '../performance/song-source.js';
import { columnName } from '../performance/columns.js';
import type { SheetBinding } from './model.js';

export interface SheetVoiceRow {
  readonly key: string;
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly sheetName: string;
  readonly labelCell: string;
  readonly sourceLabel: string;
  readonly name: string;
  readonly managed: boolean;
  readonly profile: number | null;
  readonly partId: string | null;
  readonly cues: readonly { readonly bar: number; readonly text: string; readonly cell: string }[];
}

type BindingIdentity = Pick<SheetBinding, 'spreadsheetId' | 'sheetId' | 'labelCell'>;
const managedPrefix = /^AF\s*-\s*/;
const structuralLabels = new Set(['key', 'meter', 'section', 'bar', 'start time', 'local bpm', 'bpm']);
export function sheetVoiceKey(binding: BindingIdentity): string {
  return JSON.stringify([binding.spreadsheetId, binding.sheetId, binding.labelCell]);
}
function coordinate(cell: string): { row: number; column: number } {
  const match = /^([A-Z]+)([1-9]\d*)$/.exec(cell);
  if (!match) throw new Error(`Invalid source cell ${cell}`);
  return { row: Number(match[2]), column: Array.from(match[1]).reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) };
}
export function bindingMatches(row: SheetVoiceRow, binding: Pick<SheetBinding, 'spreadsheetId' | 'sheetId' | 'labelCell' | 'sourceLabel'>): boolean {
  return row.key === sheetVoiceKey(binding) && row.sourceLabel === binding.sourceLabel;
}

export function discoverSheetVoices(compiled: CompiledSong, source?: SongSource): SheetVoiceRow[] {
  const identity = { spreadsheetId: compiled.source.spreadsheetId, sheetId: compiled.source.sheetId, sheetName: compiled.source.sheetName };
  if (!source) return compiled.parts.map(part => {
    const sourceLabel = part.source.text || part.source.note;
    const binding = { ...identity, labelCell: part.source.a1 };
    return { ...binding, key: sheetVoiceKey(binding), sourceLabel, name: part.name,
      managed: managedPrefix.test(sourceLabel.trim()), profile: part.profile, partId: part.id, cues: [] };
  });
  if (source.spreadsheetId !== identity.spreadsheetId || source.sheetId !== identity.sheetId) {
    throw new Error('The source snapshot belongs to a different worksheet than the compiled song');
  }
  const origin = coordinate(source.range.split(':')[0]);
  const controlRows = new Set(compiled.cues.map(cue => coordinate(cue.source.a1).row));
  for (const window of compiled.rotation?.windows ?? []) {
    for (const cell of window.sources) controlRows.add(coordinate(cell.a1).row);
    controlRows.add(coordinate(window.source.a1).row);
    controlRows.add(coordinate(window.endSource.a1).row);
  }
  const firstControlRow = Math.min(...controlRows);
  const firstBarColumn = Math.min(...compiled.chart.bars.map(bar => bar.column));
  const labels = source.values.flatMap((values, offset) => {
    const labelIndex = values.findIndex(value => value.trim() !== '');
    if (labelIndex < 0) return [];
    const sourceLabel = values[labelIndex];
    const row = origin.row + offset, column = origin.column + labelIndex;
    const labelCell = `${columnName(column)}${row}`;
    return [{ row, column, labelCell, sourceLabel, values, managed: managedPrefix.test(sourceLabel.trim()) }];
  });
  const firstManagedRow = Math.min(...labels.filter(label => label.managed && !controlRows.has(label.row)).map(label => label.row));
  const parts = new Map(compiled.parts.filter(part => part.source.sheetId === identity.sheetId).map(part => [part.source.a1, part]));
  return labels.flatMap(label => {
    if (controlRows.has(label.row)) return [];
    const part = parts.get(label.labelCell);
    const reference = label.row >= firstManagedRow && label.row < firstControlRow && label.column < firstBarColumn
      && !structuralLabels.has(label.sourceLabel.trim().toLowerCase());
    if (!label.managed && !part && !reference) return [];
    const binding = { ...identity, sheetName: source.sheetName, labelCell: label.labelCell };
    return [{ ...binding, key: sheetVoiceKey(binding), sourceLabel: label.sourceLabel,
      name: label.sourceLabel.trim().replace(managedPrefix, '').trim(), managed: label.managed,
      profile: part?.profile ?? null, partId: part?.id ?? null,
      cues: compiled.chart.bars.flatMap(bar => {
        if (bar.column === label.column) return [];
        const text = label.values[bar.column - origin.column] ?? '';
        return text.trim() ? [{ bar: bar.bar, text, cell: `${columnName(bar.column)}${label.row}` }] : [];
      }) }];
  });
}
