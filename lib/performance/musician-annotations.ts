import type { MusicXmlReport } from './musicxml-model.js';

type Part = MusicXmlReport['parts'][number];
export interface FeelRange { startBar: number; endBar: number; text: MusicXmlReport['annotations']['feels'][number]['text'] }
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

export type MusicianFill = {
  bracket: 'none' | 'start' | 'end' | 'both';
  leadingDash: boolean;
  display: string;
} & (
  | { kind: 'exact'; counts: string }
  | { kind: 'freeform'; fromCount: number }
);

export function parseMusicianFill(text: string): MusicianFill | null {
  const trimmed = text.trim();
  const start = trimmed.startsWith('['), end = trimmed.endsWith(']');
  const bracket = start ? end ? 'both' : 'start' : end ? 'end' : 'none';
  const phrase = trimmed.slice(start ? 1 : 0, end ? -1 : undefined).trim();
  const leadingDash = phrase.startsWith('-');
  const content = (leadingDash ? phrase.slice(1) : phrase).trim();
  const wrap = (display: string) => `${start ? '[' : ''}${display}${end ? ']' : ''}`;
  const freeform = /^([1-4])!$/.exec(content);
  if (freeform) {
    const fromCount = Number(freeform[1]);
    return { kind: 'freeform', fromCount, bracket, leadingDash, display: wrap(`Fill from ${fromCount}`) };
  }
  if (!/^(?:[1-4](?:e?&?a?)\s*)+$/.test(content)) return null;
  const counts = [...content.matchAll(/[1-4](?:e?&?a?)/g)].map(match => match[0]);
  if (counts.length === 1 && counts[0].length === 1) return null;
  if (counts.some((count, index) => index > 0 && Number(count[0]) <= Number(counts[index - 1][0]))) return null;
  const display = counts.flatMap(count => [...count]).join(' ');
  return { kind: 'exact', counts: content, bracket, leadingDash, display: wrap(`Fill: ${display}`) };
}

export function isMusicianVocalCue(cue: Pick<MusicXmlReport['vocalCues'][number], 'text'>): boolean {
  return !/^-(?:['′’ʼʹ])?$/.test(cue.text.trim());
}

export function instrumentCue(cell: string, report: MusicXmlReport): string {
  const text = report.annotations.instrumentDisplays.find(display => display.cell === cell)?.text ?? '';
  return parseMusicianFill(text)?.display ?? text;
}

export function sectionFeelSummary(section: MusicXmlReport['sections'][number], ranges: FeelRange[], label: (bar: number) => string = String): string {
  const feels = ranges.filter(range => range.startBar >= section.startBar && range.endBar <= section.endBar);
  const complete = feels[0]?.startBar === section.startBar && feels.at(-1)?.endBar === section.endBar
    && feels.every((range, index) => index === 0 || feels[index - 1].endBar + 1 === range.startBar);
  return feels.map((range, index) => complete && index === 0 ? range.text
    : range.startBar === range.endBar ? `${range.text}, bar ${label(range.startBar)}`
      : `${range.text}, bars ${label(range.startBar)}-${label(range.endBar)}`).join('; ');
}
