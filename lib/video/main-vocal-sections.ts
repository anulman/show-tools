import { parseArrangementHits, type CompiledSong, type CompiledPart } from '../performance/compiled-song.js';
import { columnName } from '../performance/columns.js';
import type { SongSource } from '../performance/song-source.js';

type Eligibility =
  | { readonly kind: 'lyric' }
  | { readonly kind: 'inactive'; readonly reason: 'blank' | 'notation' }
  | { readonly kind: 'unresolved'; readonly message: string };

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

function eligibility(text: string): Eligibility {
  const value = text.trim();
  if (!value) return { kind: 'inactive', reason: 'blank' };
  if (parseArrangementHits(value) !== null || /^(?:-+'?|!{1,2})$/.test(value)) return { kind: 'inactive', reason: 'notation' };
  if (/^[A-Za-z][A-Za-z\s'’"“”.,!?…:;()/-]*$/.test(value) && !/^[ea]$/i.test(value)) return { kind: 'lyric' };
  return { kind: 'unresolved', message: 'Section start is neither plain lyric text, a blank, nor recognized notation; classify it before preparing song activity.' };
}

export function deriveMainVocalSections({ compiled, source }: { readonly compiled: CompiledSong; readonly source: SongSource }): readonly MainVocalSection[] {
  if (compiled.source.spreadsheetId !== source.spreadsheetId || compiled.source.sheetId !== source.sheetId) throw new Error('Main-vocal source must match the compiled worksheet');
  const main = compiled.parts.find(part => part.role.kind === 'default-live');
  if (!main) return [];
  const rowMatch = /^[A-Z]+([1-9][0-9]*)$/.exec(main.source.a1);
  if (!rowMatch) throw new Error('Main-vocal source label needs a qualified cell');
  const row = Number(rowMatch[1]);
  return compiled.chart.sections.map(section => {
    const bar = compiled.chart.bars.find(bar => bar.bar === section.startBar);
    if (!bar) throw new Error(`Section ${section.id} has no compiled first bar`);
    const a1 = `${columnName(bar.column)}${row}`;
    const text = source.values[row - 1]?.[bar.column - 1] ?? '';
    return {
      partId: main.id, sectionId: section.id, startBar: section.startBar, endBar: section.endBar,
      startCount: (section.startBar - 1) * compiled.chart.beatsPerBar,
      endCount: section.endBar * compiled.chart.beatsPerBar,
      source: { sheetId: source.sheetId, a1, text, note: source.notes[a1] ?? '' },
      eligibility: eligibility(text),
    };
  });
}
