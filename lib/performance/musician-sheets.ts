import { importSheetMusicXml, stableMusicXmlJson, type MusicXmlReport } from './sheet-musicxml.js';
import { parseSongSource } from './song-source.js';
import { decodeSongMapping } from './compiled-song.js';
import { musicianFeelRanges, sectionFeelSummary, vocalAnnotation, literalInstrumentCue, type VocalAnnotation } from './musician-annotations.js';
import { scoreXmlText as xml } from './score-xml.js';
import { planMusicianRows, parseMusicianReuse, musicianRepeatCandidates, type MusicianRow, type SectionReference } from './musician-sheet-plan.js';

const profile = 'show-tools-musician-sheet-v3';
const width = 595.28, height = 841.89, margin = 38, top = 80, bottom = 795;
const sectionHeadingHeight = 17;
const staffStart = margin + 25, staffEnd = width - margin;
const convention = 'Blank five-line staff for handwritten notes. Normal playing is implicit; whole-bar ! and !! indicate Funky and Extra funky. Other arrangement marks and vocal cues retain source indications; pitches, patterns and played durations are unspecified.';
type Part = MusicXmlReport['parts'][number];
interface PlacedVocal { cue: VocalAnnotation; x: number; lines: string[] }
interface System { row: MusicianRow; label: string; cueLines: string[]; vocals: PlacedVocal[]; height: number; staffOffset: number }

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

function referenceText(row: Extract<MusicianRow, { kind: 'reference' }>, report: MusicXmlReport): string {
  const end = row.cells.at(-1)?.bar ?? row.cells[0].bar;
  return `As ${row.source.label}, bars ${row.source.startBar}-${row.source.endBar}. ${row.cells.length} bars; ${end < report.measureCount ? `continue at ${end + 1}` : 'then end'}.`;
}

function present(row: MusicianRow, report: MusicXmlReport, firstOnPage: boolean, previousSection: string | null): System {
  const start = row.cells[0].bar, end = row.cells.at(-1)?.bar ?? start;
  const label = firstOnPage || row.section.id !== previousSection ? row.section.label : '';
  const cues = report.vocalCues.filter(cue => cue.bar >= start && cue.bar <= end);
  const cueText = cues.map(cue => `b.${cue.bar}: ${cue.text}`).join(' / ');
  const measureWidth = (staffEnd - staffStart) / row.cells.length;
  const vocals = row.kind === 'staff' ? cues.map((cue): PlacedVocal => {
    const x = staffStart + (cue.bar - start) * measureWidth + 23;
    const right = staffStart + (cue.bar - start + 1) * measureWidth;
    const annotation = vocalAnnotation(cue);
    return { cue: annotation, x, lines: annotation.kind === 'text' ? wrap(cue.text, Math.max(8, Math.floor((right - x - 5) / 4.7))) : [] };
  }) : [];
  const cueLines = row.kind === 'staff' ? [] : wrap(cueText, 46);
  const cueHeight = (row.kind === 'staff' ? Math.max(0, ...vocals.map(vocal => Math.max(1, vocal.lines.length))) : cueLines.length) * 10;
  const heading = label ? sectionHeadingHeight : 0;
  const bodyLines = row.kind === 'reference' ? wrap(referenceText(row, report), 60).length : 0;
  const height = row.kind === 'staff' ? 60 + heading + cueHeight
    : row.kind === 'rest' ? heading + Math.max(20, cueHeight + 6) + 8
      : heading + cueHeight + bodyLines * 10 + 16;
  if (height > bottom - top) throw new Error(`Cues near bar ${start} exceed one writing page.`);
  return { row, label, cueLines, vocals, height, staffOffset: heading + cueHeight + 14 };
}

function paginate(rows: MusicianRow[], report: MusicXmlReport): System[][] {
  const pages: System[][] = [];
  let page: System[] = [], y = top;
  for (const row of rows) {
    let system = present(row, report, !page.length, page.at(-1)?.row.section.id ?? null);
    if (y + system.height > bottom && page.length) {
      pages.push(page); page = []; y = top; system = present(row, report, true, null);
    }
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
      const balanced = rows.map((row, index) => present(row, report, index === 0, rows[index - 1]?.section.id ?? null));
      if (balanced.reduce((sum, system) => sum + system.height, 0) <= bottom - top) {
        pages[pages.length - 2] = previous.slice(0, split); pages[pages.length - 1] = balanced;
      }
    }
  }
  return pages;
}

function clef(part: Part): 'bass' | 'percussion' | 'none' {
  return part.name.trim().toLowerCase() === 'bass' ? 'bass' : part.name.trim().toLowerCase() === 'drums' ? 'percussion' : 'none';
}

function clefSvg(kind: ReturnType<typeof clef>, y: number): string {
  if (kind === 'percussion') return `<path d="M46 ${y + 5}v14m6-14v14" stroke="#222" stroke-width="3"/>`;
  if (kind === 'bass') return `<path d="M42 ${y + 6}C38 ${y - 1} 52 ${y - 3} 53 ${y + 6}C55 ${y + 15} 47 ${y + 23} 41 ${y + 26}C48 ${y + 20} 51 ${y + 12} 48 ${y + 6}C46 ${y + 2} 41 ${y + 3} 42 ${y + 6}" fill="#222"/><circle cx="42" cy="${y + 6}" r="2.3"/><circle cx="56" cy="${y + 3}" r="1.4"/><circle cx="56" cy="${y + 9}" r="1.4"/>`;
  return '';
}

function svgPage(page: System[], pageIndex: number, pageCount: number, part: Part, report: MusicXmlReport): string {
  const first = page[0].row.cells[0].bar, last = page.at(-1)?.row.cells.at(-1)?.bar ?? first;
  const feels = musicianFeelRanges(part, report);
  const body: string[] = [];
  let y = top;
  for (const system of page) {
    const { row } = system, heading = system.label ? sectionHeadingHeight : 0;
    const start = row.cells[0].bar, end = row.cells.at(-1)?.bar ?? start;
    body.push(`<g data-system-start="${start}" data-kind="${row.kind}">`);
    if (system.label) {
      const summary = sectionFeelSummary(row.section, feels);
      body.push(`<text data-section="${row.section.id}" x="${margin}" y="${y + 8}" font-size="9" font-weight="bold"><tspan>${xml(system.label)}</tspan>${summary ? `<tspan data-section-feel="true" dx="10" font-size="8" font-weight="normal" font-style="italic">${xml(summary)}</tspan>` : ''}</text>`);
    }
    if (row.kind !== 'staff') body.push(`<text x="${staffEnd}" y="${y + 3}" font-size="7" text-anchor="end" fill="#555">${start}-${end}</text>`);
    if (row.kind !== 'staff') for (const [line, text] of system.cueLines.entries()) body.push(`<text x="${row.kind === 'rest' ? 160 : margin}" y="${y + heading + 10 + line * 10}" font-size="8" fill="#525252">${xml(text)}</text>`);
    if (row.kind === 'rest') {
      body.push(`<g data-rest-start="${start}" data-rest-end="${end}"><text x="101" y="${y + heading + 7}" text-anchor="middle" font-size="9">${row.cells.length}</text><path d="M65 ${y + heading + 16}h72m-72-5v10m72-10v10" stroke="#333" stroke-width="2" fill="none"/><text x="141" y="${y + heading + 19}" font-size="6" fill="#666">rest</text></g></g>`);
      y += system.height; continue;
    }
    if (row.kind === 'reference') {
      body.push(`<g data-reference-start="${start}" data-reference-end="${end}" data-reference-source="${row.source.startBar}">`);
      for (const [line, text] of wrap(referenceText(row, report)).entries()) body.push(`<text x="${margin}" y="${y + heading + system.cueLines.length * 10 + 11 + line * 10}" font-size="8">${xml(text)}</text>`);
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
      body.push(`<g data-bar="${cell.bar}"><text x="${x + 4}" y="${vocalY}" font-size="7" fill="#555">${cell.bar}</text><line x1="${x}" y1="${staffY}" x2="${x}" y2="${staffY + 24}" stroke="#777" stroke-width=".55"/>`);
      if (literalInstrumentCue(cell.text)) body.push(`<text data-source-cell="${cell.cell}" x="${x + 4}" y="${staffY + 41}" font-size="8" fill="#444">${xml(literalInstrumentCue(cell.text))}</text>`);
      body.push('</g>');
    }
    body.push(`<line x1="${staffEnd}" y1="${staffY}" x2="${staffEnd}" y2="${staffY + 24}" stroke="#444" stroke-width=".7"/></g>`);
    y += system.height;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(part.name)} notes, bars ${first} to ${last}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#222"><text x="${margin}" y="40" font-size="23" font-weight="bold"><tspan>${xml(part.name)}</tspan><tspan dx="8" dy="-3.5" font-size="13" font-weight="normal"> ${xml(report.title)}</tspan></text><text x="${staffEnd}" y="29" text-anchor="end" font-size="9">${report.meter.numerator}/${report.meter.denominator} · ${report.bpmPerChartCount} BPM</text><text x="${staffEnd}" y="40" text-anchor="end" font-size="9">Bars ${first}-${last}</text>${body.join('')}<text x="${staffEnd}" y="818" text-anchor="end" font-size="8" fill="#666">Page ${pageIndex + 1} of ${pageCount}</text></g></svg>`;
}

function musicianXml(part: Part, report: MusicXmlReport, pages: System[][], source: string, mapping: string, condensation: MusicianSheet['condensation']): string {
  const systems = pages.flat(), kind = clef(part);
  const initialClef = kind === 'bass' ? '<sign>F</sign><line>4</line>' : `<sign>${kind === 'percussion' ? 'percussion' : 'none'}</sign>`;
  const pageStarts = new Set(pages.slice(1).map(page => page[0].row.cells[0].bar));
  const systemStarts = new Map(systems.map(system => [system.row.cells[0].bar, system]));
  const restStarts = new Map(systems.filter(system => system.row.kind === 'rest').map(system => [system.row.cells[0].bar, system.row.cells.length]));
  const feels = musicianFeelRanges(part, report);
  const direction = (text: string, id: string, placement: 'above' | 'below', countOffset = 0) => `<direction placement="${placement}"><direction-type><words id="${id}" font-size="9">${xml(text)}</words></direction-type>${countOffset ? `<offset>${countOffset * 960 * 4 / report.meter.denominator}</offset>` : ''}</direction>`;
  const measures = part.cells.map((cell, index) => {
    let body = '';
    const system = systemStarts.get(cell.bar);
    if (system) body += `<print${pageStarts.has(cell.bar) ? ' new-page="yes"' : index ? ' new-system="yes"' : ''}><measure-numbering>measure</measure-numbering></print>`;
    const restCount = restStarts.get(cell.bar);
    if (!index || restCount) body += `<attributes>${!index ? `<divisions>960</divisions><time><beats>${report.meter.numerator}</beats><beat-type>${report.meter.denominator}</beat-type></time><clef>${initialClef}</clef><staff-details><staff-lines>5</staff-lines></staff-details>` : ''}${restCount ? `<measure-style><multiple-rest use-symbols="no">${restCount}</multiple-rest></measure-style>` : ''}</attributes>`;
    if (!index) body += `<direction><direction-type><metronome><beat-unit>${report.meter.denominator === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${report.bpmPerChartCount}</per-minute></metronome></direction-type><sound tempo="${report.bpmPerChartCount * 4 / report.meter.denominator}"/></direction>`;
    const section = report.sections.find(section => section.startBar === cell.bar);
    if (section) body += `<direction><direction-type><rehearsal>${xml(section.label)}</rehearsal></direction-type></direction>`;
    if (system?.label && !section) body += direction(system.label, `section-${cell.bar}`, 'above');
    for (const cue of report.vocalCues.filter(cue => cue.bar === cell.bar)) {
      const annotation = vocalAnnotation(cue);
      if (annotation.kind === 'count-and') {
        body += direction('Vocal cue: 3', `vocal-${cue.cell}-count`, 'above', annotation.countOffset);
        body += direction('Vocal cue: > &', `vocal-${cue.cell}-and`, 'above', annotation.andOffset);
      } else body += direction(`Vocal cue: ${cue.text}`, `vocal-${cue.cell}`, 'above');
    }
    if (system?.row.kind === 'reference') body += direction(referenceText(system.row, report), `reference-${cell.bar}`, 'above');
    if (system?.label) {
      const summary = sectionFeelSummary(system.row.section, feels);
      if (summary) body += direction(summary, `feel-${cell.bar}`, 'above');
    }
    if (literalInstrumentCue(cell.text)) body += direction(literalInstrumentCue(cell.text), `chart-${cell.cell}`, 'below');
    body += `<note${cell.text.trim() ? ' print-object="no"' : ''}><rest measure="yes"/><duration>${report.meter.numerator * 960 * 4 / report.meter.denominator}</duration></note>`;
    if (index === part.cells.length - 1) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    return `<measure number="${cell.bar}">${body}</measure>`;
  }).join('\n');
  const fields: [string, string][] = [['show-tools:profile', profile], ['show-tools:source-sha256', report.sourceDigest],
    ['show-tools:mapping-sha256', report.mappingDigest], ['show-tools:selected-label-cells', stableMusicXmlJson([part.labelCell])],
    ['show-tools:source', source], ['show-tools:mapping', mapping], ['show-tools:condensation', stableMusicXmlJson(condensation)]];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(report.title)} — ${xml(part.name)} notes</work-title></work><identification><encoding><software>${profile}</software><encoding-description>${xml(convention)} Blank chart cells are authored rests. Hidden rests are writing-area spacers, not performed note durations.</encoding-description></encoding><miscellaneous>${fields.map(([name, value]) => `<miscellaneous-field name="${name}">${xml(value)}</miscellaneous-field>`).join('')}</miscellaneous></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><system-layout><system-distance>120</system-distance></system-layout></defaults><part-list><score-part id="${part.id}"><part-name>${xml(part.name)}</part-name><part-abbreviation>${xml(part.name)}</part-abbreviation></score-part></part-list><part id="${part.id}">${measures}</part></score-partwise>\n`;
}

export async function createMusicianSheets(options: Parameters<typeof importSheetMusicXml>[0] & { reuse?: unknown }): Promise<MusicianSheet[]> {
  const { report } = await importSheetMusicXml(options);
  const references = parseMusicianReuse(options.reuse, report);
  const source = stableMusicXmlJson(parseSongSource(options.source)), mapping = stableMusicXmlJson(decodeSongMapping(options.mapping));
  return report.parts.filter(part => !part.managed).map(part => {
    const rows = planMusicianRows(part, report, references);
    const layout = paginate(rows, report);
    const condensation: MusicianSheet['condensation'] = { sourceDigest: report.sourceDigest, mappingDigest: report.mappingDigest,
      rests: rows.filter(row => row.kind === 'rest').map(row => ({ startBar: row.cells[0].bar, endBar: row.cells.at(-1)?.bar ?? row.cells[0].bar })),
      references: references.filter(reference => reference.partLabelCell === part.labelCell), repeatCandidates: musicianRepeatCandidates(part, report) };
    const pages = layout.map((page, index) => svgPage(page, index, layout.length, part, report));
    const stem = part.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + part.labelCell.toLowerCase();
    const score = musicianXml(part, report, layout, source, mapping, condensation);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(report.title)} — ${xml(part.name)}</title><style>@page{size:A4;margin:0}body{margin:0;background:#e9ebe6;font:15px system-ui}.controls{max-width:740px;margin:20px auto;padding:16px}article{width:210mm;height:297mm;background:white;margin:16px auto;break-after:page}article:last-child{break-after:auto}article svg{display:block;width:100%;height:100%}@media print{body{background:white}.controls{display:none}article{margin:0;box-shadow:none}}</style><div class="controls"><strong>${xml(part.name)} · ${xml(report.title)}</strong><p>${pages.length} A4 pages · all ${report.measureCount} bars · blank five-line staff</p><button onclick="window.print()">Print / Save PDF</button> <a href="data:application/vnd.recordare.musicxml+xml;charset=utf-8,${encodeURIComponent(score)}" download="${stem}.musicxml">MusicXML</a></div>${pages.map(page => `<article>${page}</article>`).join('')}</html>\n`;
    return { name: part.name, labelCell: part.labelCell, stem, pages, html, xml: score, condensation };
  });
}
