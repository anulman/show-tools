import type { MusicXmlReport } from './musicxml-model.js';
import { readMusicXmlSong } from './musicxml-song.js';
import { musicianFeelRanges, sectionFeelSummary, vocalAnnotation, instrumentCue, isMusicianVocalCue, type VocalAnnotation } from './musician-annotations.js';
import { scoreXmlText as xml, stableMusicXmlJson } from './score-xml.js';
import { planMusicianRows, parseMusicianReuse, musicianRepeatCandidates, type MusicianRow, type SectionReference } from './musician-sheet-plan.js';

const profile = 'show-tools-musician-sheet-projection-v5';
const width = 595.28, height = 841.89, margin = 38, top = 80, bottom = 795;
const sectionHeadingHeight = 17;
const staffStart = margin + 25, staffEnd = width - margin;
const convention = 'Blank five-line staff for handwritten notes. Normal playing is implicit; whole-bar ! and !! indicate Funky, Extra funky and Higher intensity (!!!). Other arrangement marks and vocal cues retain source indications; pitches, patterns and played durations are unspecified.';
type Part = MusicXmlReport['parts'][number];
type Presentation = { labels: ReadonlyMap<number, string>; parts: readonly Part[]; grouped: boolean; name: string };
function barLabel(bar: number, presentation: Presentation) { return presentation.labels.get(bar) ?? String(bar); }
function barRange(start: number, end: number, presentation: Presentation): string {
  return start === end ? `bar ${barLabel(start, presentation)}` : `bars ${barLabel(start, presentation)}-${barLabel(end, presentation)}`;
}
interface PlacedVocal { cue: VocalAnnotation; x: number; lines: string[] }
interface InstrumentLine { cell: string; partId: string; text: string }
interface System { row: MusicianRow; label: string; cueLines: string[]; vocals: PlacedVocal[]; instruments: InstrumentLine[][]; summary: string; feelLines: string[]; height: number; staffOffset: number }

export interface MusicianChart extends Omit<MusicianSheet, 'labelCell'> {
  sourceParts: { id: string; name: string; labelCell: string }[];
}

export interface MusicianSheet {
  name: string;
  labelCell: string;
  stem: string;
  xml: string;
  html: string;
  pages: string[];
  condensation: { sourceDigest: string; mappingDigest: string; rests: { startBar: number; endBar: number }[];
    references: SectionReference[]; repeatCandidates: ReturnType<typeof musicianRepeatCandidates> };
}

function wrap(text: string, limit = 60): string[] {
  const words = text.trim().split(/\s+/), lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (const chunk of word.match(new RegExp(`.{1,${limit}}`, 'gu')) ?? []) {
      if (line && [...line, ' ', ...chunk].length > limit) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + chunk;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function voiceName(part: Part, presentation: Presentation): string {
  const prefix = `${presentation.name} - `;
  return presentation.grouped && part.name.startsWith(prefix) ? part.name.slice(prefix.length) : part.name;
}

function activeParts(bar: number, report: MusicXmlReport, presentation: Presentation): Part[] {
  return presentation.parts.filter(part => part.cells.some(cell => cell.bar === bar
    && report.annotations.activities.some(activity => activity.cell === cell.cell && activity.kind === 'playing')));
}

function allResting(bar: number, report: MusicXmlReport, presentation: Presentation): boolean {
  return presentation.parts.length > 0 && presentation.parts.every(part => {
    const cell = part.cells.find(cell => cell.bar === bar);
    return cell !== undefined && report.annotations.activities.some(activity => activity.cell === cell.cell && activity.kind === 'rest');
  });
}

function instrumentLines(bar: number, report: MusicXmlReport, presentation: Presentation, firstOnPage: boolean, limit: number): InstrumentLine[] {
  const active = activeParts(bar, report, presentation), previous = activeParts(bar - 1, report, presentation);
  const changed = active.map(part => part.id).join('/') !== previous.map(part => part.id).join('/');
  return presentation.parts.flatMap(part => {
    const cell = part.cells.find(cell => cell.bar === bar);
    if (!cell) return [];
    const cue = instrumentCue(cell.cell, report);
    const label = presentation.grouped && presentation.parts.length > 1 && (firstOnPage || changed) && active.includes(part);
    if (!cue && !label) return [];
    const text = presentation.parts.length > 1 ? `${voiceName(part, presentation)}${cue ? ': ' + cue : ''}` : cue;
    return wrap(text, limit).map(text => ({ cell: cell.cell, partId: part.id, text }));
  });
}

function feelSummary(section: MusicXmlReport['sections'][number], report: MusicXmlReport, presentation: Presentation): string {
  return presentation.parts.flatMap(part => {
    const text = sectionFeelSummary(section, musicianFeelRanges(part, report), bar => barLabel(bar, presentation));
    return text ? [presentation.parts.length > 1 ? `${voiceName(part, presentation)}: ${text}` : text] : [];
  }).join('; ');
}

function selectedBoundaries(report: MusicXmlReport, presentation: Presentation, position: 'lead-in' | 'tail'): InstrumentLine[] {
  return (report.annotations.boundaryCues ?? []).flatMap(cue => {
    const part = presentation.parts.find(part => part.id === cue.partId);
    if (!part || cue.position !== position) return [];
    const text = presentation.parts.length > 1 ? `${voiceName(part, presentation)}: ${cue.text}` : cue.text;
    return [{ cell: cue.cell, partId: cue.partId, text }];
  });
}

function tailHeight(report: MusicXmlReport, presentation: Presentation): number {
  const lines = selectedBoundaries(report, presentation, 'tail').flatMap(cue => wrap(cue.text, 80));
  return lines.length ? 75 + Math.max(0, lines.length - 1) * 10 : 0;
}

function referenceText(row: Extract<MusicianRow, { kind: 'reference' }>, report: MusicXmlReport, presentation: Presentation): string {
  const end = row.cells.at(-1)?.bar ?? row.cells[0].bar;
  return `As ${row.source.label}, ${barRange(row.source.startBar, row.source.endBar, presentation)}. ${row.cells.length} bars; ${end < report.measureCount ? `continue at ${barLabel(end + 1, presentation)}` : 'then end'}.`;
}

function present(row: MusicianRow, report: MusicXmlReport, firstOnPage: boolean, previousSection: string | null, presentation: Presentation): System {
  const start = row.cells[0].bar, end = row.cells.at(-1)?.bar ?? start;
  const label = firstOnPage || row.section.id !== previousSection ? row.section.label : '';
  const cues = report.vocalCues.filter(cue => cue.bar >= start && cue.bar <= end);
  const cueText = cues.map(cue => `b.${barLabel(cue.bar, presentation)}: ${cue.text}`).join(' / ');
  const measureWidth = (staffEnd - staffStart) / row.cells.length;
  const vocals = row.kind === 'staff' ? cues.map((cue): PlacedVocal => {
    const labelSpace = Math.max(23, barLabel(cue.bar, presentation).length * 4 + 10);
    const x = staffStart + (cue.bar - start) * measureWidth + labelSpace;
    const right = staffStart + (cue.bar - start + 1) * measureWidth;
    const annotation = vocalAnnotation(cue, report);
    return { cue: annotation, x, lines: annotation.kind === 'text' ? wrap(cue.text, Math.max(8, Math.floor((right - x - 5) / 4.7))) : [] };
  }) : [];
  const cueLines = row.kind === 'staff' ? [] : wrap(cueText, 46);
  const cueHeight = (row.kind === 'staff' ? Math.max(0, ...vocals.map(vocal => Math.max(1, vocal.lines.length))) : cueLines.length) * 10;
  const instruments = row.kind === 'staff' ? row.cells.map((cell, index) => instrumentLines(cell.bar, report, presentation, firstOnPage && index === 0, Math.max(12, Math.floor((measureWidth - 8) / 4.7)))) : [];
  const instrumentHeight = Math.max(0, ...instruments.map(lines => lines.length - 1)) * 10;
  const summary = label ? feelSummary(row.section, report, presentation) : '';
  const available = staffEnd - margin - label.length * 5.2 - 10;
  const feelLines = summary.length * 4.1 > available ? wrap(summary, 110) : [];
  const heading = label ? sectionHeadingHeight + feelLines.length * 10 : 0;
  const bodyLines = row.kind === 'reference' ? wrap(referenceText(row, report, presentation), 60).length : 0;
  const height = row.kind === 'staff' ? 60 + heading + cueHeight + instrumentHeight
    : row.kind === 'rest' ? heading + Math.max(20, cueHeight + 6) + 8
      : heading + cueHeight + bodyLines * 10 + 16;
  if (height > bottom - top) throw new Error(`Cues near bar ${start} exceed one writing page.`);
  return { row, label, cueLines, vocals, instruments, summary, feelLines, height, staffOffset: heading + cueHeight + 14 };
}

function paginate(rows: MusicianRow[], report: MusicXmlReport, presentation: Presentation, firstTop = top, tailSpace = 0): System[][] {
  const pages: System[][] = [];
  let page: System[] = [], y = firstTop;
  for (const row of rows) {
    let system = present(row, report, !page.length, page.at(-1)?.row.section.id ?? null, presentation);
    if (y + system.height > bottom - (row === rows.at(-1) ? tailSpace : 0) && page.length) {
      pages.push(page); page = []; y = top; system = present(row, report, true, null, presentation);
    }
    if (y + system.height + (row === rows.at(-1) ? tailSpace : 0) > bottom) throw new Error('Boundary cues do not fit one writing page.');
    page.push(system); y += system.height;
  }
  if (page.length) pages.push(page);
  if (pages.length > 1) {
    const last = pages[pages.length - 1], previous = pages[pages.length - 2];
    const sectionId = last[0].row.section.id;
    let split = previous.length;
    while (split > 0 && previous[split - 1].row.section.id === sectionId) split--;
    if (split > 0 && split < previous.length) {
      const rows = [...previous.slice(split), ...last].map(system => system.row);
      const balanced = rows.map((row, index) => present(row, report, index === 0, rows[index - 1]?.section.id ?? null, presentation));
      if (balanced.reduce((sum, system) => sum + system.height, 0) <= bottom - top - tailSpace) {
        pages[pages.length - 2] = previous.slice(0, split); pages[pages.length - 1] = balanced;
      }
    }
  }
  return pages;
}

function clef(part: Part): 'bass' | 'percussion' | 'none' {
  return /^bass(?:\s|$)/.test(part.name.trim().toLowerCase()) ? 'bass' : part.name.trim().toLowerCase() === 'drums' ? 'percussion' : 'none';
}

function clefSvg(kind: ReturnType<typeof clef>, y: number): string {
  if (kind === 'percussion') return `<path d="M46 ${y + 5}v14m6-14v14" stroke="#222" stroke-width="3"/>`;
  if (kind === 'bass') return `<path d="M42 ${y + 6}C38 ${y - 1} 52 ${y - 3} 53 ${y + 6}C55 ${y + 15} 47 ${y + 23} 41 ${y + 26}C48 ${y + 20} 51 ${y + 12} 48 ${y + 6}C46 ${y + 2} 41 ${y + 3} 42 ${y + 6}" fill="#222"/><circle cx="42" cy="${y + 6}" r="2.3"/><circle cx="56" cy="${y + 3}" r="1.4"/><circle cx="56" cy="${y + 9}" r="1.4"/>`;
  return '';
}

function svgPage(page: System[], pageIndex: number, pageCount: number, part: Part, report: MusicXmlReport, presentation: Presentation): string {
  const first = page[0].row.cells[0].bar, last = page.at(-1)?.row.cells.at(-1)?.bar ?? first;
  const body: string[] = [];
  const lead = pageIndex === 0 ? selectedBoundaries(report, presentation, 'lead-in').flatMap(cue => wrap(`Lead-in (uncounted): ${cue.text}`, 100).map(text => ({ ...cue, text }))) : [];
  let y = top + Math.max(0, lead.length - 1) * 10;
  for (const [index, cue] of lead.entries()) body.push(`<text data-boundary-cell="${cue.cell}" x="${margin}" y="${62 + index * 10}" font-size="8">${xml(cue.text)}</text>`);
  for (const system of page) {
    const { row } = system, heading = system.label ? sectionHeadingHeight + system.feelLines.length * 10 : 0;
    const start = row.cells[0].bar, end = row.cells.at(-1)?.bar ?? start;
    body.push(`<g data-system-start="${start}" data-kind="${row.kind}">`);
    if (system.label) {
      const summary = system.feelLines.length ? '' : system.summary;
      body.push(`<text data-section="${row.section.id}" x="${margin}" y="${y + 8}" font-size="9" font-weight="bold"><tspan>${xml(system.label)}</tspan>${summary ? `<tspan data-section-feel="true" dx="10" font-size="8" font-weight="normal" font-style="italic">${xml(summary)}</tspan>` : ''}</text>`);
    }
    for (const [line, text] of system.feelLines.entries()) body.push(`<text data-section-feel="true" x="${margin}" y="${y + 18 + line * 10}" font-size="8" font-style="italic">${xml(text)}</text>`);
    if (row.kind !== 'staff') body.push(`<text x="${staffEnd}" y="${y + 3}" font-size="7" text-anchor="end" fill="#555">${xml(barRange(start, end, presentation))}</text>`);
    if (row.kind !== 'staff') for (const [line, text] of system.cueLines.entries()) body.push(`<text x="${row.kind === 'rest' ? 160 : margin}" y="${y + heading + 10 + line * 10}" font-size="8" fill="#525252">${xml(text)}</text>`);
    if (row.kind === 'rest') {
      body.push(`<g data-rest-start="${start}" data-rest-end="${end}"><text x="101" y="${y + heading + 7}" text-anchor="middle" font-size="9">${row.cells.length}</text><path d="M65 ${y + heading + 16}h72m-72-5v10m72-10v10" stroke="#333" stroke-width="2" fill="none"/><text x="141" y="${y + heading + 19}" font-size="6" fill="#666">rest</text></g></g>`);
      y += system.height; continue;
    }
    if (row.kind === 'reference') {
      body.push(`<g data-reference-start="${start}" data-reference-end="${end}" data-reference-source="${row.source.startBar}">`);
      for (const [line, text] of wrap(referenceText(row, report, presentation)).entries()) body.push(`<text x="${margin}" y="${y + heading + system.cueLines.length * 10 + 11 + line * 10}" font-size="8">${xml(text)}</text>`);
      body.push('</g></g>'); y += system.height; continue;
    }
    const staffY = y + system.staffOffset;
    const vocalY = staffY - 6 - Math.max(0, ...system.vocals.map(vocal => Math.max(1, vocal.lines.length) - 1)) * 10;
    const measureWidth = (staffEnd - staffStart) / row.cells.length;
    for (const vocal of system.vocals) {
      body.push(`<g data-vocal-bar="${vocal.cue.bar}">`);
      if (vocal.cue.kind === 'count-and') {
        const barX = staffStart + (vocal.cue.bar - start) * measureWidth;
        const countX = barX + vocal.cue.countOffset / report.meter.numerator * measureWidth;
        const andX = barX + vocal.cue.andOffset / report.meter.numerator * measureWidth;
        body.push(`<text x="${countX}" y="${vocalY}" font-size="8" fill="#525252">3</text><text data-vocal-accent="true" x="${andX}" y="${vocalY - 8}" text-anchor="middle" font-size="10">&gt;</text><text data-vocal-count-offset="2.5" x="${andX}" y="${vocalY}" text-anchor="middle" font-size="8" fill="#525252">&amp;</text>`);
      } else for (const [line, text] of vocal.lines.entries()) body.push(`<text x="${vocal.x}" y="${vocalY + line * 10}" font-size="8" fill="#525252">${xml(text)}</text>`);
      body.push('</g>');
    }
    for (let line = 0; line < 5; line++) body.push(`<line data-staff-line="${line + 1}" x1="${margin}" y1="${staffY + line * 6}" x2="${staffEnd}" y2="${staffY + line * 6}" stroke="#4c4c4c" stroke-width=".55"/>`);
    body.push(clefSvg(clef(part), staffY));
    for (const [i, cell] of row.cells.entries()) {
      const x = staffStart + i * measureWidth;
      body.push(`<g data-bar="${cell.bar}"><text x="${x + 4}" y="${vocalY}" font-size="7" fill="#555">${xml(barLabel(cell.bar, presentation))}</text><line x1="${x}" y1="${staffY}" x2="${x}" y2="${staffY + 24}" stroke="#777" stroke-width=".55"/>`);
      for (const [line, cue] of system.instruments[i].entries()) body.push(`<text data-source-cell="${cue.cell}" data-voice="${cue.partId}" x="${x + 4}" y="${staffY + 41 + line * 10}" font-size="8" fill="#444">${xml(cue.text)}</text>`);
      body.push('</g>');
    }
    body.push(`<line x1="${staffEnd}" y1="${staffY}" x2="${staffEnd}" y2="${staffY + 24}" stroke="#444" stroke-width=".7"/></g>`);
    y += system.height;
  }
  if (pageIndex === pageCount - 1 && tailHeight(report, presentation)) {
    const staffY = y + 24;
    body.push(`<g data-tail-bar="true"><text x="${margin}" y="${y + 8}" font-size="9" font-weight="bold">Tail</text>`);
    for (let line = 0; line < 5; line++) body.push(`<line data-tail-staff-line="${line + 1}" x1="${margin}" y1="${staffY + line * 6}" x2="${staffEnd}" y2="${staffY + line * 6}" stroke="#4c4c4c" stroke-width=".55"/>`);
    body.push(clefSvg(clef(part), staffY));
    body.push(`<line x1="${staffStart}" y1="${staffY}" x2="${staffStart}" y2="${staffY + 24}" stroke="#777" stroke-width=".55"/><line x1="${staffEnd}" y1="${staffY}" x2="${staffEnd}" y2="${staffY + 24}" stroke="#444" stroke-width="1.4"/>`);
    const lines = selectedBoundaries(report, presentation, 'tail').flatMap(cue => wrap(cue.text, 80).map(text => ({ ...cue, text })));
    for (const [index, cue] of lines.entries()) body.push(`<text data-boundary-cell="${cue.cell}" data-voice="${cue.partId}" x="${staffStart + 4}" y="${staffY + 41 + index * 10}" font-size="8">${xml(cue.text)}</text>`);
    body.push('</g>');
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(part.name)} notes, bars ${first} to ${last}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#222"><text x="${margin}" y="40" font-size="23" font-weight="bold"><tspan>${xml(report.title)}</tspan><tspan dx="8" dy="-3.5" font-size="13" font-weight="normal">— ${xml(part.name)}</tspan></text><text x="${staffEnd}" y="29" text-anchor="end" font-size="9">${report.meter.numerator}/${report.meter.denominator} · ${report.bpmPerChartCount} BPM</text><text x="${staffEnd}" y="40" text-anchor="end" font-size="9">${xml(barRange(first, last, presentation).replace(/^b/, 'B'))}</text>${body.join('')}<text x="${staffEnd}" y="818" text-anchor="end" font-size="8" fill="#666">Page ${pageIndex + 1} of ${pageCount}</text></g></svg>`;
}

function musicianXml(part: Part, report: MusicXmlReport, pages: System[][], source: string, mapping: string, condensation: MusicianSheet['condensation'], presentation: Presentation): string {
  const systems = pages.flat(), kind = clef(part);
  const initialClef = kind === 'bass' ? '<sign>F</sign><line>4</line>' : `<sign>${kind === 'percussion' ? 'percussion' : 'none'}</sign>`;
  const pageStarts = new Set(pages.slice(1).map(page => page[0].row.cells[0].bar));
  const systemStarts = new Map(systems.map(system => [system.row.cells[0].bar, system]));
  const restStarts = new Map(systems.filter(system => system.row.kind === 'rest').map(system => [system.row.cells[0].bar, system.row.cells.length]));
  const direction = (text: string, id: string, placement: 'above' | 'below', countOffset = 0) => `<direction placement="${placement}"><direction-type><words id="${id}" font-size="9">${xml(text)}</words></direction-type>${countOffset ? `<offset>${countOffset * 960 * 4 / report.meter.denominator}</offset>` : ''}</direction>`;
  const measures = part.cells.map((cell, index) => {
    let body = '';
    const system = systemStarts.get(cell.bar);
    if (system) body += `<print${pageStarts.has(cell.bar) ? ' new-page="yes"' : index ? ' new-system="yes"' : ''}><measure-numbering>measure</measure-numbering></print>`;
    const restCount = restStarts.get(cell.bar);
    if (!index || restCount) body += `<attributes>${!index ? `<divisions>960</divisions><time><beats>${report.meter.numerator}</beats><beat-type>${report.meter.denominator}</beat-type></time><clef>${initialClef}</clef><staff-details><staff-lines>5</staff-lines></staff-details>` : ''}${restCount ? `<measure-style><multiple-rest use-symbols="no">${restCount}</multiple-rest></measure-style>` : ''}</attributes>`;
    if (!index) body += `<direction><direction-type><metronome><beat-unit>${report.meter.denominator === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${report.bpmPerChartCount}</per-minute></metronome></direction-type><sound tempo="${report.bpmPerChartCount * 4 / report.meter.denominator}"/></direction>`;
    if (!index) for (const cue of selectedBoundaries(report, presentation, 'lead-in')) body += direction(`Lead-in (uncounted): ${cue.text}`, `boundary-lead-in-${cue.cell}`, 'above');
    const section = report.sections.find(section => section.startBar === cell.bar);
    if (section) body += `<direction><direction-type><rehearsal>${xml(section.label)}</rehearsal></direction-type></direction>`;
    if (system?.label && !section) body += direction(system.label, `section-${cell.bar}`, 'above');
    for (const cue of report.vocalCues.filter(cue => cue.bar === cell.bar)) {
      const annotation = vocalAnnotation(cue, report);
      if (annotation.kind === 'count-and') {
        body += direction('Vocal cue: 3', `vocal-${cue.cell}-count`, 'above', annotation.countOffset);
        body += direction('Vocal cue: > &', `vocal-${cue.cell}-and`, 'above', annotation.andOffset);
      } else body += direction(`Vocal cue: ${cue.text}`, `vocal-${cue.cell}`, 'above');
    }
    if (system?.row.kind === 'reference') body += direction(referenceText(system.row, report, presentation), `reference-${cell.bar}`, 'above');
    if (system?.label) {
      const summary = feelSummary(system.row.section, report, presentation);
      if (summary) body += direction(summary, `feel-${cell.bar}`, 'above');
    }
    for (const cue of instrumentLines(cell.bar, report, presentation, pageStarts.has(cell.bar) || index === 0, 10000)) body += direction(cue.text, `chart-${cue.cell}`, 'below');
    body += `<note${!allResting(cell.bar, report, presentation) ? ' print-object="no"' : ''}><rest measure="yes"/><duration>${report.meter.numerator * 960 * 4 / report.meter.denominator}</duration></note>`;
    if (index === part.cells.length - 1 && !tailHeight(report, presentation)) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    return `<measure number="${xml(barLabel(cell.bar, presentation))}">${body}</measure>`;
  }).join('\n');
  const tails = selectedBoundaries(report, presentation, 'tail');
  const tail = tails.length ? `<measure number="Tail" implicit="yes" non-controlling="yes">${direction('Tail', 'tail-heading', 'above')}${tails.map(cue => direction(cue.text, `boundary-tail-${cue.cell}`, 'below')).join('')}<note print-object="no"><rest measure="yes"/><duration>${report.meter.numerator * 960 * 4 / report.meter.denominator}</duration></note><barline location="right"><bar-style>light-heavy</bar-style></barline></measure>` : '';
  const fields: [string, string][] = [['show-tools:profile', profile], ['show-tools:document-kind', presentation.grouped ? 'musician-projection' : 'part-projection'], ['show-tools:source-sha256', report.sourceDigest],
    ['show-tools:mapping-sha256', report.mappingDigest], ['show-tools:selected-label-cells', stableMusicXmlJson(presentation.parts.map(part => part.labelCell))],
    ['show-tools:boundary-cues', stableMusicXmlJson((report.annotations.boundaryCues ?? []).filter(cue => presentation.parts.some(part => part.id === cue.partId)))], ['show-tools:bar-labels', stableMusicXmlJson([...presentation.labels])], ['show-tools:source-parts', stableMusicXmlJson(presentation.parts.map(({ id, name, labelCell }) => ({ id, name, labelCell })))], ['show-tools:voice-feels', stableMusicXmlJson(report.annotations.feels.filter(feel => presentation.parts.some(part => part.id === feel.partId)))], ['show-tools:worksheet-scope', 'charted'], ['show-tools:source', source], ['show-tools:mapping', mapping], ['show-tools:condensation', stableMusicXmlJson(condensation)]];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(report.title)} — ${xml(part.name)}</work-title></work><identification><encoding><software>${profile}</software><encoding-description>${xml(convention)} A passage is resting only when all selected voices are resting. A Tail writing bar is uncounted and does not define its performed duration. Hidden rests are writing-area spacers, not performed note durations.</encoding-description></encoding><miscellaneous>${fields.map(([name, value]) => `<miscellaneous-field name="${name}">${xml(value)}</miscellaneous-field>`).join('')}</miscellaneous></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><system-layout><system-distance>120</system-distance></system-layout></defaults><part-list><score-part id="${part.id}"><part-name>${xml(part.name)}</part-name><part-abbreviation>${xml(part.name)}</part-abbreviation></score-part></part-list><part id="${part.id}">${measures}${tail}</part></score-partwise>\n`;
}

function renderSheet(part: Part, report: MusicXmlReport, rows: MusicianRow[], source: string, mapping: string, presentation: Presentation,
  references: SectionReference[] = []): Omit<MusicianSheet, 'labelCell'> {
  const leadLines = selectedBoundaries(report, presentation, 'lead-in').flatMap(cue => wrap(`Lead-in (uncounted): ${cue.text}`, 100)).length;
  const layout = paginate(rows, report, presentation, top + Math.max(0, leadLines - 1) * 10, tailHeight(report, presentation));
  const condensation: MusicianSheet['condensation'] = { sourceDigest: report.sourceDigest, mappingDigest: report.mappingDigest,
    rests: rows.filter(row => row.kind === 'rest').map(row => ({ startBar: row.cells[0].bar, endBar: row.cells.at(-1)?.bar ?? row.cells[0].bar })),
    references, repeatCandidates: presentation.parts.length === 1 ? presentation.parts.flatMap(part => musicianRepeatCandidates(part, report)) : [] };
  const pages = layout.map((page, index) => svgPage(page, index, layout.length, part, report, presentation));
  const nameStem = part.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stem = (nameStem || `musician-${part.id.toLowerCase()}`) + (presentation.grouped ? '' : '-' + part.labelCell.toLowerCase());
  const score = musicianXml(part, report, layout, source, mapping, condensation, presentation);
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(report.title)} — ${xml(part.name)}</title><style>@page{size:A4;margin:0}body{margin:0;background:#e9ebe6;font:15px system-ui}.controls{max-width:740px;margin:20px auto;padding:16px}article{width:210mm;height:297mm;background:white;margin:16px auto;break-after:page}article:last-child{break-after:auto}article svg{display:block;width:100%;height:100%}@media print{body{background:white}.controls{display:none}article{margin:0;box-shadow:none}}</style><div class="controls"><strong>${xml(report.title)}</strong> — ${xml(part.name)}<p>${pages.length} A4 pages · all ${report.measureCount} bars · blank five-line staff</p><button onclick="window.print()">Print / Save PDF</button> <a href="data:application/vnd.recordare.musicxml+xml;charset=utf-8,${encodeURIComponent(score)}" download="${stem}.musicxml">MusicXML</a></div>${pages.map(page => `<article>${page}</article>`).join('')}</html>\n`;
  return { name: part.name, stem, pages, html, xml: score, condensation };
}

export async function createMusicianSheets(options: { musicxml: string; selectedRows?: readonly number[]; reuse?: unknown }): Promise<MusicianSheet[]> {
  const document = await readMusicXmlSong(options.musicxml), report = { ...document.report, vocalCues: document.report.vocalCues.filter(isMusicianVocalCue) };
  const references = parseMusicianReuse(options.reuse, report);
  const labels = new Map(document.song.chart.bars.map(bar => [bar.bar, bar.label ?? String(bar.bar)]));
  return report.parts.filter(part => !part.managed && (options.selectedRows === undefined || options.selectedRows.includes(Number(part.labelCell.replace(/^[A-Z]+/, ''))))).map(part => ({
    ...renderSheet(part, report, planMusicianRows(part, report, references), stableMusicXmlJson(document.source), stableMusicXmlJson(document.mapping), { labels, parts: [part], grouped: false, name: part.name },
      references.filter(reference => reference.partLabelCell === part.labelCell)), labelCell: part.labelCell,
  }));
}

function chartRows(part: Part, report: MusicXmlReport, presentation: Presentation): MusicianRow[] {
  const rows: MusicianRow[] = [];
  const resting = (bar: number) => allResting(bar, report, presentation);
  for (const section of report.sections) {
    const cells = part.cells.filter(cell => cell.bar >= section.startBar && cell.bar <= section.endBar);
    let cursor = 0;
    while (cursor < cells.length) {
      let end = cursor;
      while (end < cells.length && resting(cells[end].bar)) end++;
      if (end - cursor >= 4 || end - cursor === cells.length) {
        const boundaries = [cursor, ...report.vocalCues.filter(cue => cue.bar > cells[cursor].bar && cue.bar <= cells[end - 1].bar)
          .map(cue => cursor + cue.bar - cells[cursor].bar), end];
        for (let index = 0; index < boundaries.length - 1; index++) rows.push({ kind: 'rest', section, cells: cells.slice(boundaries[index], boundaries[index + 1]) });
        cursor = end; continue;
      }
      end = Math.min(cursor + 4, cells.length);
      for (let next = cursor + 1; next < end; next++) {
        let blankEnd = next;
        while (blankEnd < cells.length && resting(cells[blankEnd].bar)) blankEnd++;
        if (blankEnd - next >= 4) { end = next; break; }
      }
      rows.push({ kind: 'staff', section, cells: cells.slice(cursor, end) }); cursor = end;
    }
  }
  return rows;
}

export async function createMusicianChart(options: { musicxml: string; instrument: string; reuse?: unknown;
  parts: readonly { labelCell: string; name: string }[] }): Promise<MusicianChart | null> {
  const instrument = options.instrument.trim();
  if (!instrument) throw new Error('Specify a nonempty musician name.');
  if (!options.parts.length) return null;
  if (new Set(options.parts.map(part => part.labelCell)).size !== options.parts.length) throw new Error('Select distinct charted musician voices.');
  const document = await readMusicXmlSong(options.musicxml);
  const report = { ...document.report, vocalCues: document.report.vocalCues.filter(isMusicianVocalCue) };
  const parts = options.parts.map(selected => {
    const part = report.parts.find(part => !part.managed && part.labelCell === selected.labelCell && part.name === selected.name);
    if (!part) throw new Error(`Missing or changed musician voice ${selected.labelCell} ${selected.name}.`);
    return part;
  });
  const first = parts[0];
  if (!first) throw new Error('A charted musician voice is required.');
  const references = parseMusicianReuse(options.reuse, report).filter(reference => parts.some(part => part.labelCell === reference.partLabelCell));
  if (parts.length > 1 && references.length) throw new Error('Multi-voice section reuse requires combined musician confirmation.');
  const part: Part = { ...first, id: `P-musician-${first.id}`, name: instrument, labelCell: '' };
  const presentation: Presentation = { labels: new Map(document.song.chart.bars.map(bar => [bar.bar, bar.label ?? String(bar.bar)])), parts, grouped: true, name: instrument };
  const rows = parts.length === 1 ? planMusicianRows(first, report, references) : chartRows(part, report, presentation);
  return { ...renderSheet(part, report, rows, stableMusicXmlJson(document.source), stableMusicXmlJson(document.mapping), presentation, references),
    sourceParts: parts.map(({ id, name, labelCell }) => ({ id, name, labelCell })) };
}

export async function createMusicianCharts(options: { musicxml: string; selectedRows?: readonly number[]; reuse?: unknown }): Promise<MusicianChart[]> {
  const document = await readMusicXmlSong(options.musicxml);
  const groups = new Map<string, { labelCell: string; name: string }[]>();
  for (const part of document.report.parts) {
    if (part.managed || (options.selectedRows !== undefined && !options.selectedRows.includes(Number(part.labelCell.slice(1))))) continue;
    const separator = part.name.indexOf(' - ');
    const musician = (separator < 0 ? part.name : part.name.slice(0, separator)).trim();
    if (!musician) throw new Error(`Missing musician name in ${part.labelCell}. Use Musician - Voice.`);
    const voices = groups.get(musician) ?? [];
    voices.push({ labelCell: part.labelCell, name: part.name }); groups.set(musician, voices);
  }
  const charts: MusicianChart[] = [];
  for (const [instrument, parts] of groups) {
    const chart = await createMusicianChart({ ...options, instrument, parts });
    if (chart) charts.push(chart);
  }
  if (new Set(charts.map(chart => chart.stem)).size !== charts.length) throw new Error('Musician names must produce distinct file names. Rename the colliding musician groups.');
  return charts;
}
