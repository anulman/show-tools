import type { CompiledSong, CompiledPart } from '../performance/compiled-song.js';
import { columnName } from '../performance/columns.js';
import type { SongSource } from '../performance/song-source.js';
import type { MusicalAnnotations, StageCellAnnotation } from '../performance/musicxml-model.js';

type Eligibility = StageCellAnnotation['eligibility'];

export interface MainVocalSection {
  readonly partId: string;
  readonly sectionId: string;
  readonly startBar: number;
  readonly endBar: number;
  readonly startCount: number;
  readonly endCount: number;
  readonly source: CompiledPart['source'];
  readonly eligibility: Eligibility;
}

export function deriveMainVocalSections({ compiled, source, annotations }: { readonly compiled: CompiledSong; readonly source: SongSource; readonly annotations: MusicalAnnotations }): readonly MainVocalSection[] {
  if (compiled.source.spreadsheetId !== source.spreadsheetId || compiled.source.sheetId !== source.sheetId) throw new Error('Main-vocal source must match the compiled worksheet');
  const main = compiled.parts.find(part => part.role.kind === 'default-live');
  if (!main) return [];
  const rowMatch = /^[A-Z]+([1-9][0-9]*)$/.exec(main.source.a1);
  if (!rowMatch) throw new Error('Main-vocal source label needs a qualified cell');
  const row = Number(rowMatch[1]);
  const origin = /^([A-Z]+)([1-9][0-9]*)/.exec(source.range);
  if (!origin) throw new Error('Invalid source range');
  const originRow = Number(origin[2]);
  const originColumn = [...origin[1]].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const eligibilityByCell = new Map(annotations.stageCells.map(annotation => [annotation.cell, annotation.eligibility]));
  return compiled.chart.sections.map(section => {
    const bar = compiled.chart.bars.find(bar => bar.bar === section.startBar);
    if (!bar) throw new Error(`Section ${section.id} has no compiled first bar`);
    const a1 = `${columnName(bar.column)}${row}`;
    const text = source.values[row - originRow]?.[bar.column - originColumn] ?? '';
    const eligibility = eligibilityByCell.get(a1);
    if (!eligibility) throw new Error(`Missing canonical section eligibility for ${a1}`);
    return {
      partId: main.id, sectionId: section.id, startBar: section.startBar, endBar: section.endBar,
      startCount: (section.startBar - 1) * compiled.chart.beatsPerBar,
      endCount: section.endBar * compiled.chart.beatsPerBar,
      source: { sheetId: source.sheetId, a1, text, note: source.notes[a1] ?? '' },
      eligibility,
    };
  });
}
