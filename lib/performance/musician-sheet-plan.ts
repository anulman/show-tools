import { Schema } from 'effect';
import type { MusicXmlReport, MusicXmlCell } from './musicxml-model.js';

export type MusicianPart = MusicXmlReport['parts'][number];
type Section = MusicXmlReport['sections'][number];
interface Span { cells: MusicXmlCell[]; section: Section }
export type MusicianRow = Span & (
  | { kind: 'staff' }
  | { kind: 'rest' }
  | { kind: 'reference'; source: Section }
);
export interface SectionReference { partLabelCell: string; sectionStartBar: number; sourceSectionStartBar: number; equivalence: 'musician-confirmed' }

const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Bar = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 4096 }));
const ReuseSchema = Schema.Struct({ sourceDigest: Digest, mappingDigest: Digest,
  references: Schema.Array(Schema.Struct({ partLabelCell: Schema.String,
    sectionStartBar: Bar, sourceSectionStartBar: Bar, equivalence: Schema.Literal('musician-confirmed') })),
});

function sectionCells(part: MusicianPart, section: Section): MusicXmlCell[] {
  return part.cells.filter(cell => cell.bar >= section.startBar && cell.bar <= section.endBar);
}

function sameCues(first: MusicXmlCell[], second: MusicXmlCell[]): boolean {
  return first.length === second.length && first.every((cell, index) => cell.text.trim() === second[index].text.trim());
}

export function parseMusicianReuse(input: unknown, report: MusicXmlReport): SectionReference[] {
  if (input === undefined) return [];
  const config = Schema.decodeUnknownSync(ReuseSchema)(input);
  if (config.sourceDigest !== report.sourceDigest || config.mappingDigest !== report.mappingDigest) throw new Error('The section-reuse file belongs to different source or mapping data.');
  const targets = new Set<string>();
  for (const reference of config.references) {
    const key = `${reference.partLabelCell}/${reference.sectionStartBar}`;
    if (targets.has(key)) throw new Error('Each part section can have only one reuse reference.');
    targets.add(key);
    const part = report.parts.find(part => part.labelCell === reference.partLabelCell && !part.managed);
    const section = report.sections.find(section => section.startBar === reference.sectionStartBar);
    const source = report.sections.find(section => section.startBar === reference.sourceSectionStartBar);
    if (!part || !section || !source || source.endBar >= section.startBar) throw new Error('Reuse must name a selected musician part and an earlier complete section.');
    const cells = sectionCells(part, section), sourceCells = sectionCells(part, source);
    if (cells.length < 4 || !cells.some(cell => cell.text.trim()) || !sameCues(cells, sourceCells)) throw new Error('Reuse requires at least four bars with identical, nonempty chart cues and confirmed musical equivalence.');
    if (config.references.some(other => other.partLabelCell === reference.partLabelCell && other.sectionStartBar === source.startBar)) throw new Error('Section references cannot chain; point directly to a fully written section.');
  }
  return config.references.map(reference => ({ partLabelCell: reference.partLabelCell,
    sectionStartBar: reference.sectionStartBar, sourceSectionStartBar: reference.sourceSectionStartBar, equivalence: reference.equivalence }));
}

export function musicianRepeatCandidates(part: MusicianPart, report: MusicXmlReport): (Omit<SectionReference, 'equivalence'> & { sectionLabel: string; sourceSectionLabel: string; barCount: number })[] {
  return report.sections.flatMap((section, index) => {
    const cells = sectionCells(part, section);
    if (cells.length < 4 || !cells.some(cell => cell.text.trim())) return [];
    const source = report.sections.slice(0, index).find(source => sameCues(cells, sectionCells(part, source)));
    return source ? [{ partLabelCell: part.labelCell, sectionStartBar: section.startBar, sourceSectionStartBar: source.startBar,
      sectionLabel: section.label, sourceSectionLabel: source.label, barCount: cells.length }] : [];
  });
}

export function planMusicianRows(part: MusicianPart, report: MusicXmlReport, references: SectionReference[]): MusicianRow[] {
  const rows: MusicianRow[] = [];
  for (const section of report.sections) {
    const cells = sectionCells(part, section);
    const reuse = references.find(reference => reference.partLabelCell === part.labelCell && reference.sectionStartBar === section.startBar);
    if (reuse) {
      const source = report.sections.find(section => section.startBar === reuse.sourceSectionStartBar);
      if (!source) throw new Error('Resolved reuse section is missing.');
      rows.push({ kind: 'reference', section, cells, source }); continue;
    }
    let cursor = 0;
    while (cursor < cells.length) {
      let end = cursor;
      while (end < cells.length && !cells[end].text.trim()) end++;
      const restLength = end - cursor;
      if (restLength >= 4 || restLength === cells.length) {
        const boundaries = [cursor, ...report.vocalCues.filter(cue => cue.bar > cells[cursor].bar && cue.bar <= cells[end - 1].bar)
          .map(cue => cursor + cue.bar - cells[cursor].bar), end];
        for (let index = 0; index < boundaries.length - 1; index++) rows.push({ kind: 'rest', section, cells: cells.slice(boundaries[index], boundaries[index + 1]) });
        cursor = end; continue;
      }
      end = Math.min(cursor + 4, cells.length);
      for (let next = cursor + 1; next < end; next++) {
        let blankEnd = next;
        while (blankEnd < cells.length && !cells[blankEnd].text.trim()) blankEnd++;
        if (blankEnd - next >= 4) { end = next; break; }
      }
      rows.push({ kind: 'staff', section, cells: cells.slice(cursor, end) }); cursor = end;
    }
  }
  const covered = rows.flatMap(row => row.cells.map(cell => cell.bar));
  if (covered.length !== part.cells.length || covered.some((bar, index) => bar !== part.cells[index].bar)) throw new Error('Condensed sheet does not preserve chronological bar coverage.');
  return rows;
}
