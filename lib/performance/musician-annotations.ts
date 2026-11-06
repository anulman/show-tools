import type { MusicXmlReport } from './musicxml-model.js';

type Part = MusicXmlReport['parts'][number];
export interface FeelRange { startBar: number; endBar: number; text: 'Funky' | 'Extra funky' }
export type VocalAnnotation = MusicXmlReport['vocalCues'][number] & (
  | { kind: 'text' }
  | { kind: 'count-and'; countOffset: number; andOffset: number }
);

export function musicianFeelRanges(part: Part, report: MusicXmlReport): FeelRange[] {
  return report.annotations.feels.filter(range => range.partId === part.id)
    .map(({ startBar, endBar, text }) => ({ startBar, endBar, text }));
}

export function vocalAnnotation(cue: MusicXmlReport['vocalCues'][number], report: MusicXmlReport): VocalAnnotation {
  const annotation = report.annotations.vocals.find(annotation => annotation.cell === cue.cell);
  if (!annotation) throw new Error(`Missing canonical vocal annotation for ${cue.cell}.`);
  return { ...cue, ...annotation };
}

export function instrumentCue(cell: string, report: MusicXmlReport): string {
  return report.annotations.instrumentDisplays.find(display => display.cell === cell)?.text ?? '';
}

export function sectionFeelSummary(section: MusicXmlReport['sections'][number], ranges: FeelRange[]): string {
  const feels = ranges.filter(range => range.startBar >= section.startBar && range.endBar <= section.endBar);
  const complete = feels[0]?.startBar === section.startBar && feels.at(-1)?.endBar === section.endBar
    && feels.every((range, index) => index === 0 || feels[index - 1].endBar + 1 === range.startBar);
  return feels.map((range, index) => complete && index === 0 ? range.text
    : `${range.text}, bars ${range.startBar}-${range.endBar}`).join('; ');
}
