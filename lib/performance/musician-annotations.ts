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


export function sectionFeelSummary(section: MusicXmlReport['sections'][number], ranges: FeelRange[]): string {
  const feels = ranges.filter(range => range.startBar >= section.startBar && range.endBar <= section.endBar);
  const complete = feels[0]?.startBar === section.startBar && feels.at(-1)?.endBar === section.endBar
    && feels.every((range, index) => index === 0 || feels[index - 1].endBar + 1 === range.startBar);
  return feels.map((range, index) => complete && index === 0 ? range.text
    : `${range.text}, bars ${range.startBar}-${range.endBar}`).join('; ');
}
