import type { MusicXmlReport } from './sheet-musicxml.js';

type Part = MusicXmlReport['parts'][number];
export interface FeelRange { startBar: number; endBar: number; text: 'Funky' | 'Extra funky' }
export type VocalAnnotation = MusicXmlReport['vocalCues'][number] & (
  | { kind: 'text' }
  | { kind: 'count-and'; countOffset: number; andOffset: number }
);

export function musicianFeelRanges(part: Part, report: MusicXmlReport): FeelRange[] {
  const ranges: FeelRange[] = [];
  for (const section of report.sections) {
    let current: FeelRange | undefined;
    for (const cell of part.cells.filter(cell => cell.bar >= section.startBar && cell.bar <= section.endBar)) {
      const token = cell.text.trim();
      const text = token === '!' || token === '!-' ? 'Funky' : token === '!!' ? 'Extra funky' : undefined;
      if (!text) { current = undefined; continue; }
      if (current && current.text === text && current.endBar + 1 === cell.bar) current.endBar = cell.bar;
      else { current = { startBar: cell.bar, endBar: cell.bar, text }; ranges.push(current); }
    }
  }
  return ranges;
}

export function vocalAnnotation(cue: MusicXmlReport['vocalCues'][number]): VocalAnnotation {
  return cue.text.trim() === '-3] &' ? { ...cue, kind: 'count-and', countOffset: 2, andOffset: 2.5 }
    : { ...cue, kind: 'text' };
}

export function literalInstrumentCue(text: string): string {
  return ['-', '!', '!!', '!-'].includes(text.trim()) ? '' : text.trim();
}
