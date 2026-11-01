import { importSheetMusicXml, stableMusicXmlJson, type MusicXmlReport, type MusicXmlCell } from './sheet-musicxml.js';
import { parseSongSource } from './song-source.js';
import { decodeSongMapping } from './compiled-song.js';
import { scoreXmlText as xml } from './score-xml.js';

const profile = 'show-tools-musician-sheet-v1';
const width = 595.28, height = 841.89, margin = 38, top = 105, bottom = 795;
const staffStart = margin + 25, staffEnd = width - margin;
const convention = 'Blank five-line staff for handwritten notes. Arrangement marks and vocal cues are literal source indications; pitches, patterns and played durations are unspecified.';
type Part = MusicXmlReport['parts'][number];
type Cue = MusicXmlReport['vocalCues'][number];
interface System { cells: MusicXmlCell[]; section: string; cueText: string; cueLines: string[]; cues: Cue[]; height: number }

export interface MusicianSheet {
  name: string;
  labelCell: string;
  stem: string;
  xml: string;
  html: string;
  pages: string[];
}

function wrap(text: string): string[] {
  const words = text.trim().split(/\s+/), lines: string[] = [];
  let line = '';
  for (const word of words) {
    for (const chunk of word.match(/.{1,60}/gu) ?? []) {
      if (line && [...line, ' ', ...chunk].length > 60) { lines.push(line); line = ''; }
      line += (line ? ' ' : '') + chunk;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function systemsFor(part: Part, report: MusicXmlReport): System[] {
  const systems: System[] = [];
  for (let index = 0; index < part.cells.length; index += 4) {
    const cells = part.cells.slice(index, index + 4), start = cells[0].bar, end = cells.at(-1)?.bar ?? start;
    const section = report.sections.find(section => start >= section.startBar && start <= section.endBar);
    if (!section) throw new Error(`Bar ${start} has no section.`);
    const changes = report.sections.filter(s => s.startBar > start && s.startBar <= end);
    const sectionText = section.label + (start > section.startBar ? ' (cont.)' : '')
      + changes.map(s => ` / b.${s.startBar}: ${s.label}`).join('');
    const cues = report.vocalCues.filter(cue => cue.bar >= start && cue.bar <= end);
    const carried = report.vocalCues.find(cue => cue.bar >= section.startBar && cue.bar < start);
    const cueText = cues.length ? 'Vocal cues: ' + cues.map(cue => `b.${cue.bar}: ${cue.text}`).join(' / ')
      : carried ? `Section vocal cue (b.${carried.bar}): ${carried.text}` : '';
    const cueLines = wrap(cueText);
    const rowHeight = 86 + Math.max(1, cueLines.length) * 10;
    if (rowHeight > bottom - top) throw new Error(`Vocal cues near bar ${start} exceed one writing page.`);
    systems.push({ cells, section: sectionText, cues, cueText, cueLines, height: rowHeight });
  }
  return systems;
}

function paginate(systems: System[]): System[][] {
  const pages: System[][] = [];
  let page: System[] = [], y = top;
  for (const system of systems) {
    if (y + system.height > bottom && page.length) { pages.push(page); page = []; y = top; }
    page.push(system); y += system.height;
  }
  if (page.length) pages.push(page);
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
  const first = page[0].cells[0].bar, last = page.at(-1)?.cells.at(-1)?.bar ?? first;
  const body: string[] = [];
  let y = top;
  for (const system of page) {
    const staffY = y + 35 + Math.max(0, system.cueLines.length - 1) * 10;
    body.push(`<g data-system-start="${system.cells[0].bar}"><text x="${margin}" y="${y}" font-size="9" font-weight="bold">${xml(system.section)}</text>`);
    for (const [line, text] of system.cueLines.entries()) body.push(`<text x="${margin}" y="${y + 14 + line * 10}" font-size="8" fill="#525252">${xml(text)}</text>`);
    for (let line = 0; line < 5; line++) body.push(`<line data-staff-line="${line + 1}" x1="${margin}" y1="${staffY + line * 6}" x2="${staffEnd}" y2="${staffY + line * 6}" stroke="#4c4c4c" stroke-width=".55"/>`);
    body.push(clefSvg(clef(part), staffY));
    const measureWidth = (staffEnd - staffStart) / system.cells.length;
    for (const [i, cell] of system.cells.entries()) {
      const x = staffStart + i * measureWidth;
      body.push(`<g data-bar="${cell.bar}"><text x="${x + 4}" y="${staffY - 6}" font-size="7" fill="#555">${cell.bar}</text><line x1="${x}" y1="${staffY}" x2="${x}" y2="${staffY + 24}" stroke="#777" stroke-width=".55"/>`);
      if (cell.text.trim()) body.push(`<text data-source-cell="${cell.cell}" x="${x + 4}" y="${staffY + 41}" font-size="8" fill="#444">${xml(cell.text)}</text>`);
      body.push('</g>');
    }
    body.push(`<line x1="${staffEnd}" y1="${staffY}" x2="${staffEnd}" y2="${staffY + 24}" stroke="#444" stroke-width=".7"/></g>`);
    y += system.height;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(part.name)} notes, bars ${first} to ${last}"><rect width="100%" height="100%" fill="white"/><g font-family="Arial, sans-serif" fill="#222"><text x="${margin}" y="40" font-size="23" font-weight="bold">${xml(part.name)}</text><text x="${margin}" y="61" font-size="13">${xml(report.title)}</text><text x="${staffEnd}" y="40" text-anchor="end" font-size="9">${report.meter.numerator}/${report.meter.denominator} · ${report.bpmPerChartCount} BPM</text><text x="${staffEnd}" y="61" text-anchor="end" font-size="9">Bars ${first}-${last} · ${pageIndex + 1}/${pageCount}</text><text x="${margin}" y="80" font-size="8" fill="#666">Write your notes on the staff. Original chart marks appear below it.</text>${body.join('')}<text x="${margin}" y="818" font-size="7" fill="#777">Vocal entry cues above. Original arrangement marks below. Staff left blank for your notes.</text></g></svg>`;
}

function musicianXml(part: Part, report: MusicXmlReport, pages: System[][], source: string, mapping: string): string {
  const systems = pages.flat(), kind = clef(part);
  const initialClef = kind === 'bass' ? '<sign>F</sign><line>4</line>' : `<sign>${kind === 'percussion' ? 'percussion' : 'none'}</sign>`;
  const pageStarts = new Set(pages.slice(1).map(page => page[0].cells[0].bar));
  const systemStarts = new Map(systems.map(system => [system.cells[0].bar, system]));
  const direction = (text: string, id: string, placement: 'above' | 'below') => `<direction placement="${placement}"><direction-type><words id="${id}" font-size="9">${xml(text)}</words></direction-type></direction>`;
  const measures = part.cells.map((cell, index) => {
    let body = '';
    const system = systemStarts.get(cell.bar);
    if (system) body += `<print${pageStarts.has(cell.bar) ? ' new-page="yes"' : index ? ' new-system="yes"' : ''}><measure-numbering>measure</measure-numbering></print>`;
    if (!index) body += `<attributes><divisions>960</divisions><time><beats>${report.meter.numerator}</beats><beat-type>${report.meter.denominator}</beat-type></time><clef>${initialClef}</clef><staff-details><staff-lines>5</staff-lines></staff-details></attributes><direction><direction-type><metronome><beat-unit>${report.meter.denominator === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${report.bpmPerChartCount}</per-minute></metronome></direction-type><sound tempo="${report.bpmPerChartCount * 4 / report.meter.denominator}"/></direction>`;
    const section = report.sections.find(section => section.startBar === cell.bar);
    if (section) body += `<direction><direction-type><rehearsal>${xml(section.label)}</rehearsal></direction-type></direction>`;
    if (system && !section) body += direction(system.section, `section-${cell.bar}`, 'above');
    for (const cue of report.vocalCues.filter(cue => cue.bar === cell.bar)) body += direction(`Vocal cue: ${cue.text}`, `vocal-${cue.cell}`, 'above');
    if (system && !system.cues.length && system.cueText) body += direction(system.cueText, `carried-vocal-${cell.bar}`, 'above');
    if (cell.text.trim()) body += direction(cell.text, `chart-${cell.cell}`, 'below');
    body += `<note print-object="no"><rest measure="yes"/><duration>${report.meter.numerator * 960 * 4 / report.meter.denominator}</duration></note>`;
    if (index === part.cells.length - 1) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    return `<measure number="${cell.bar}">${body}</measure>`;
  }).join('\n');
  const fields: [string, string][] = [['show-tools:profile', profile], ['show-tools:source-sha256', report.sourceDigest],
    ['show-tools:mapping-sha256', report.mappingDigest], ['show-tools:selected-label-cells', stableMusicXmlJson([part.labelCell])],
    ['show-tools:source', source], ['show-tools:mapping', mapping]];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work><work-title>${xml(report.title)} — ${xml(part.name)} notes</work-title></work><identification><encoding><software>${profile}</software><encoding-description>${xml(convention)} Hidden rests are engraving spacers, not authored silence.</encoding-description></encoding><miscellaneous>${fields.map(([name, value]) => `<miscellaneous-field name="${name}">${xml(value)}</miscellaneous-field>`).join('')}</miscellaneous></identification><defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling><system-layout><system-distance>120</system-distance></system-layout></defaults><part-list><score-part id="${part.id}"><part-name>${xml(part.name)}</part-name><part-abbreviation>${xml(part.name)}</part-abbreviation></score-part></part-list><part id="${part.id}">${measures}</part></score-partwise>\n`;
}

export async function createMusicianSheets(options: Parameters<typeof importSheetMusicXml>[0]): Promise<MusicianSheet[]> {
  const { report } = await importSheetMusicXml(options);
  const source = stableMusicXmlJson(parseSongSource(options.source)), mapping = stableMusicXmlJson(decodeSongMapping(options.mapping));
  return report.parts.filter(part => !part.managed).map(part => {
    const layout = paginate(systemsFor(part, report));
    const pages = layout.map((page, index) => svgPage(page, index, layout.length, part, report));
    const stem = part.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + part.labelCell.toLowerCase();
    const score = musicianXml(part, report, layout, source, mapping);
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(report.title)} — ${xml(part.name)}</title><style>@page{size:A4;margin:0}body{margin:0;background:#e9ebe6;font:15px system-ui}.controls{max-width:740px;margin:20px auto;padding:16px}article{width:210mm;height:297mm;background:white;margin:16px auto;break-after:page}article:last-child{break-after:auto}article svg{display:block;width:100%;height:100%}@media print{body{background:white}.controls{display:none}article{margin:0;box-shadow:none}}</style><div class="controls"><strong>${xml(part.name)} · ${xml(report.title)}</strong><p>${pages.length} A4 pages · all ${report.measureCount} bars · blank five-line staff</p><button onclick="window.print()">Print / Save PDF</button> <a href="data:application/vnd.recordare.musicxml+xml;charset=utf-8,${encodeURIComponent(score)}" download="${stem}.musicxml">MusicXML</a></div>${pages.map(page => `<article>${page}</article>`).join('')}</html>\n`;
    return { name: part.name, labelCell: part.labelCell, stem, pages, html, xml: score };
  });
}
