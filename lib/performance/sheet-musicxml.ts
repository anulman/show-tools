import { compileSong, decodeSongMapping } from './compiled-song.js';
import { parseSongSource } from './song-source.js';
import { discoverSheetVoices } from '../voice-catalog/sheet-voices.js';
import { columnName } from './columns.js';

export const MUSICXML_PROFILE = 'show-tools-sheet-study-v1';
const divisions = 960;
const convention = 'Experimental rhythm guide: x notes mark attacks only; short glyph lengths are not authored durations. No pitch, MIDI or audio execution is specified. Text-only measures do not establish silence.';

type CellReading =
  | { kind: 'blank' }
  | { kind: 'hits'; offsets: number[]; sampled: boolean }
  | { kind: 'text'; text: string; reason: string };

export interface MusicXmlCell {
  cell: string;
  bar: number;
  text: string;
  reading: CellReading;
}
export interface MusicXmlReport {
  profile: string;
  title: string;
  sourceDigest: string;
  mappingDigest: string;
  meter: { numerator: number; denominator: number };
  bpmPerChartCount: number;
  measureCount: number;
  nativeCompilationExecutable: boolean;
  compilerDiagnostics: Awaited<ReturnType<typeof compileSong>>['diagnostics'];
  conventions: string[];
  sections: Awaited<ReturnType<typeof compileSong>>['chart']['sections'];
  parts: { id: string; name: string; labelCell: string; cells: MusicXmlCell[] }[];
}

export function stableMusicXmlJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('MusicXML metadata must be JSON data.');
    return encoded;
  }
  if (Array.isArray(value)) return '[' + value.map(stableMusicXmlJson).join(',') + ']';
  return '{' + Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, item]) => JSON.stringify(key) + ':' + stableMusicXmlJson(item)).join(',') + '}';
}

function xml(text: string): string {
  for (const symbol of text) {
    const code = symbol.codePointAt(0) ?? 0;
    if (!(code === 9 || code === 10 || code === 13 || code >= 32 && code <= 0xd7ff
      || code >= 0xe000 && code <= 0xfffd || code >= 0x10000 && code <= 0x10ffff)) {
      throw new Error(`XML 1.0 cannot represent character U+${code.toString(16).toUpperCase()}.`);
    }
  }
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&apos;').replaceAll('\r', '&#13;');
}

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

function readCell(text: string, counts: number): CellReading {
  if (!text.trim()) return { kind: 'blank' };
  const value = text.trim().replace(/'$/, '');
  let cursor = 0, anchor: number | null = null;
  const offsets: number[] = [];
  while (cursor < value.length) {
    const remaining = value.slice(cursor);
    const anchored = /^\(([1-9])\)/.exec(remaining);
    if (anchored) { anchor = Number(anchored[1]) - 1; cursor += anchored[0].length; continue; }
    const symbol = value[cursor++];
    if (/\s/.test(symbol)) continue;
    let offset: number;
    if (/^[1-9]$/.test(symbol)) {
      anchor = Number(symbol) - 1;
      offset = anchor;
    } else if (symbol === 'e' || symbol === '&' || symbol === 'a') {
      const fraction = symbol === 'e' ? .25 : symbol === '&' ? .5 : .75;
      if (anchor === null) anchor = 0;
      offset = anchor + fraction;
      while (offset <= (offsets.at(-1) ?? -1)) { anchor++; offset = anchor + fraction; }
    } else return { kind: 'text', text, reason: 'Preserved literally: lyric, activity, visual emphasis or span; no note attacks inferred.' };
    if (offset >= counts || offset <= (offsets.at(-1) ?? -1)) {
      return { kind: 'text', text, reason: 'Rhythm is outside the measure or not strictly increasing; no note attacks inferred.' };
    }
    offsets.push(offset);
  }
  return offsets.length ? { kind: 'hits', offsets, sampled: text.trim().endsWith("'") }
    : { kind: 'text', text, reason: 'No explicit attacks; preserved literally.' };
}

function words(text: string, id: string, options: { placement?: 'above' | 'below'; offset?: number; y?: number } = {}): string {
  const placement = options.placement ?? 'above', offset = options.offset ?? 0;
  return `<direction placement="${placement}"><direction-type><words id="${xml(id)}" font-size="8" default-y="${options.y ?? (placement === 'above' ? 15 : -35)}">${xml(text)}</words></direction-type>${offset ? `<offset>${offset}</offset>` : ''}</direction>`;
}

function gap(duration: number, countTicks: number, hidden: boolean): string {
  let remaining = duration, result = '';
  const sizes = [1920, 960, 480, 240, 120];
  const types = ['half', 'quarter', 'eighth', '16th', '32nd'];
  while (remaining > 0) {
    const index = sizes.findIndex(size => size <= remaining && size <= countTicks);
    if (index < 0) throw new Error('Rhythm cannot be engraved on the supported count grid.');
    result += `<note${hidden ? ' print-object="no"' : ''}><rest/><duration>${sizes[index]}</duration><type>${types[index]}</type></note>`;
    remaining -= sizes[index];
  }
  return result;
}

function rhythm(cell: MusicXmlCell, countTicks: number, counts: number): string {
  const duration = countTicks * counts;
  if (cell.reading.kind !== 'hits') return `<note print-object="no"><rest measure="yes"/><duration>${duration}</duration></note>`;
  let cursor = 0, result = '';
  for (const [index, offset] of cell.reading.offsets.entries()) {
    const at = offset * countTicks, length = countTicks / 4;
    result += gap(at - cursor, countTicks, false);
    result += `<note id="hit-${cell.cell}-${index}"><unpitched><display-step>E</display-step><display-octave>4</display-octave></unpitched><duration>${length}</duration><type>${countTicks === 960 ? '16th' : '32nd'}</type><stem>up</stem><notehead>x</notehead></note>`;
    cursor = at + length;
  }
  return result + gap(duration - cursor, countTicks, false);
}

export async function importSheetMusicXml(options: { source: unknown; mapping: unknown }): Promise<{ xml: string; report: MusicXmlReport }> {
  const source = parseSongSource(options.source), mapping = decodeSongMapping(options.mapping);
  if (!source.range.startsWith('A1:')) throw new Error('The MusicXML study requires an A1-origin source, as does the song compiler.');
  for (const [r, row] of source.values.entries()) for (const [c, text] of row.entries()) {
    try { xml(text); } catch (error) { throw new Error(`${columnName(c + 1)}${r + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const [cell, text] of Object.entries(source.notes)) {
    try { xml(text); } catch (error) { throw new Error(`${cell} note: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const song = await compileSong(source, mapping);
  if (!song.executable) throw new Error('MusicXML study blocked by chart diagnostics:\n' + song.diagnostics.map(d => `${d.source.a1}: ${d.message}`).join('\n'));
  const sourceJson = stableMusicXmlJson(source), mappingJson = stableMusicXmlJson(mapping);
  const [sourceDigest, mappingDigest] = await Promise.all([sha256(sourceJson), sha256(mappingJson)]);
  const rows = discoverSheetVoices(song, source);
  if (!rows.length) throw new Error('The source has no discoverable arrangement voices.');
  const report: MusicXmlReport = {
    profile: MUSICXML_PROFILE, title: song.title, sourceDigest, mappingDigest, meter: mapping.meter,
    bpmPerChartCount: song.chart.bpm, measureCount: song.chart.bars.length,
    nativeCompilationExecutable: song.executable, compilerDiagnostics: song.diagnostics,
    conventions: [convention, 'Rhythm rests show gaps between onset markers, not measured sound lengths.',
      'Apostrophe = sampled source notation; ! and !! remain visual markers, never musical dynamics.',
      'Blank arrangement cells have no authored activity. Blank control cells perform no action and do not stop audio.',
      'Implicit subdivisions advance to the earliest following occurrence: &e3a& = 1&, 2e, 3, 3a, 4&.',
      'Capture, layered takes, prefix views and rotary eligibility remain Show Tools metadata, not MusicXML playback instructions.'],
    sections: song.chart.sections,
    parts: rows.map(row => ({ id: `P${row.labelCell}`, name: row.name, labelCell: row.labelCell,
      cells: song.chart.bars.map(bar => {
        const cell = `${columnName(bar.column)}${Number(row.labelCell.replace(/^[A-Z]+/, ''))}`;
        const text = source.values[Number(row.labelCell.replace(/^[A-Z]+/, '')) - 1]?.[bar.column - 1] ?? '';
        const reading: CellReading = song.parts.some(part => part.id === row.partId && part.role.kind === 'default-live') && text.trim()
          ? { kind: 'text', text, reason: 'Main-vocal text has no authored syllable timing; preserved literally.' }
          : readCell(text, mapping.meter.numerator);
        return { cell, bar: bar.bar, text, reading };
      }) })),
  };
  const fields: [string, string][] = [['show-tools:profile', MUSICXML_PROFILE], ['show-tools:source-sha256', sourceDigest],
    ['show-tools:mapping-sha256', mappingDigest], ['show-tools:source', sourceJson], ['show-tools:mapping', mappingJson]];
  const countTicks = divisions * 4 / mapping.meter.denominator;
  const parts = report.parts.map((part, partIndex) => {
    const row = rows[partIndex];
    const measures = part.cells.map((cell, index) => {
      const bar = song.chart.bars[index];
      let body = '';
      if (index === 0) {
        body += `<attributes><divisions>${divisions}</divisions><time><beats>${mapping.meter.numerator}</beats><beat-type>${mapping.meter.denominator}</beat-type></time><clef><sign>percussion</sign></clef><staff-details><staff-lines>1</staff-lines></staff-details></attributes>`;
        if (partIndex === 0) body += words('Onsets only; pitch and played duration unspecified', 'score-convention', { y: 85 });
        if (partIndex === 0) body += `<direction><direction-type><metronome><beat-unit>${mapping.meter.denominator === 8 ? 'eighth' : 'quarter'}</beat-unit><per-minute>${song.chart.bpm}</per-minute></metronome></direction-type><sound tempo="${song.chart.bpm * 4 / mapping.meter.denominator}"/></direction>`;
        for (const cue of song.cues.filter(c => c.bar === 0 && c.voiceId === row.partId)) {
          body += words(`Lead-in ${cue.buttonId}: ${cue.source.text}`, `lead-${cue.source.a1}`, { placement: 'below', y: -55 });
        }
      }
      if (partIndex === 0 && song.chart.sections.some(s => s.startBar === bar.bar)) {
        body += `<direction><direction-type><rehearsal default-y="45">${xml(bar.section)}</rehearsal></direction-type></direction>`;
      }
      if (cell.text.trim()) body += words(cell.text, `cell-${cell.cell}`);
      for (const cue of song.cues.filter(c => c.bar === bar.bar && c.voiceId === row.partId)) {
        const where = cue.execution.kind === 'beat' ? `count ${cue.execution.beat + 1}` : cue.execution.kind;
        body += words(`${cue.buttonId}: ${cue.source.text} → ${where}`, `cue-${cue.source.a1}`, { placement: 'below', offset: (cue.cueBeat ?? 0) * countTicks });
      }
      body += rhythm(cell, countTicks, mapping.meter.numerator);
      if (index === part.cells.length - 1) body += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
      return `    <measure number="${bar.bar}">${body}</measure>`;
    }).join('\n');
    return `  <part id="${part.id}">\n${measures}\n  </part>`;
  }).join('\n');
  const output = `<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0">\n  <work><work-title>${xml(song.title)} — rhythm guide study</work-title></work>\n  <identification><encoding><software>${MUSICXML_PROFILE}</software><encoding-description>${xml(convention)}</encoding-description></encoding><miscellaneous>${fields.map(([name, value]) => `<miscellaneous-field name="${name}">${xml(value)}</miscellaneous-field>`).join('')}</miscellaneous></identification>\n  <part-list>${report.parts.map(part => `<score-part id="${part.id}"><part-name>${xml(part.name)} [rhythm guide]</part-name></score-part>`).join('')}</part-list>\n${parts}\n</score-partwise>\n`;
  return { xml: output, report };
}

export function renderMusicXmlReview(report: MusicXmlReport, filename: string): string {
  const rows = report.sections.map(section => `<section id="bar-${section.startBar}"><h2>${xml(section.label)} <small>bars ${section.startBar}–${section.endBar}</small></h2><div class="scroll"><table><thead><tr><th>Rhythm guide</th>${Array.from({ length: section.endBar - section.startBar + 1 }, (_, i) => `<th>${section.startBar + i}</th>`).join('')}</tr></thead><tbody>${report.parts.map(part => `<tr><th>${xml(part.name)}</th>${part.cells.filter(c => c.bar >= section.startBar && c.bar <= section.endBar).map(cell => `<td title="${xml(cell.cell)}"><span>${xml(cell.text || '·')}</span>${cell.reading.kind === 'hits' ? `<small>${cell.reading.offsets.map(n => n + 1).join(' · ')}${cell.reading.sampled ? ' / sampled' : ''}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(report.title)} — MusicXML study</title><style>body{font:16px/1.5 system-ui;background:#f7f5f0;color:#242b28;margin:0 auto;padding:36px;max-width:1500px}h1{font-size:36px;margin-bottom:8px}h2{font-size:22px}small{font-size:12px;color:#58625c}header{max-width:950px}a{color:#145c48}nav{display:flex;flex-wrap:wrap;gap:8px}nav a{font-size:13px;background:white;padding:6px 10px;border-radius:6px}.scroll{overflow:auto;border:1px solid #d4d9d1;background:white}table{border-collapse:collapse;font-size:13px;min-width:100%}th,td{padding:10px;border:1px solid #e2e6df;min-width:90px;max-width:210px;vertical-align:top}th:first-child{position:sticky;left:0;background:#eef1e9;min-width:135px}td small{display:block;white-space:nowrap;margin-top:6px}section{margin:36px 0}li{margin:6px 0}code{font-size:12px;overflow-wrap:anywhere}</style><header><small>EXPERIMENT · ${MUSICXML_PROFILE}</small><h1>${xml(report.title)}</h1><p>${report.measureCount} bars · ${report.parts.length} parts · ${report.meter.numerator}/${report.meter.denominator} · ${report.bpmPerChartCount} BPM per chart count</p><p><a href="${xml(filename)}" download>Download MusicXML</a> · <a href="report.json">Inspect interpretation report</a> · <a href="engraved.html">Open independently engraved score (if rendered)</a></p><p>This is a source-to-score inspection, not observed playback. The grid below shows exact source text and parsed attack counts. The separately engraved score is rendered from the MusicXML file.</p><ul>${report.conventions.map(c => `<li>${xml(c)}</li>`).join('')}</ul><p>Source SHA-256: <code>${report.sourceDigest}</code></p></header><nav>${report.sections.map(s => `<a href="#bar-${s.startBar}">${xml(s.label)}</a>`).join('')}</nav>${rows}</html>\n`;
}
