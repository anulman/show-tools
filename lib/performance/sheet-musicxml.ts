import { normalizeSheetMusicalAnnotations } from './sheet-musical-annotations.js';
import { MusicXmlValidationError } from './musicxml-errors.js';
import { compileSheetsSong, decodeSongMapping } from './compiled-song.js';
import { parseSongSource } from './song-source.js';
import { discoverSheetVoices } from '../voice-catalog/sheet-voices.js';
import { columnName } from './columns.js';
import { writeMusicXmlSong, readMusicXmlSong, MUSICXML_SONG_PROFILE } from './musicxml-song.js';
import { scoreXmlText as xml, stableMusicXmlJson } from './score-xml.js';
import type { CellReading, MusicXmlReport } from './musicxml-model.js';

export const MUSICXML_PROFILE = MUSICXML_SONG_PROFILE;
const convention = 'Canonical song. Onset-only directions specify attacks without inventing pitch or played duration. Text-only measures do not establish silence.';

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

export async function importSheetMusicXml(options: { source: unknown; mapping: unknown; selectedRows?: readonly number[] }): Promise<{ xml: string; report: MusicXmlReport }> {
  const source = parseSongSource(options.source), mapping = decodeSongMapping(options.mapping);
  if (!source.range.startsWith('A1:')) throw new MusicXmlValidationError('Canonical MusicXML import requires an A1-origin source.');
  const writtenBars = (source.values[mapping.barRow - 1] ?? []).flatMap((text, index) => /^\d+(?:\*| \(part\))?$/.test(text.trim()) ? [{ bar: Number.parseInt(text, 10), cell: `${columnName(index + 1)}${mapping.barRow}` }] : []);
  const countInCell = `${columnName(mapping.leadInColumn)}${mapping.barRow}`;
  const outside = writtenBars.find(entry => (entry.bar < mapping.startBar || entry.bar > mapping.endBar)
    && !(entry.bar === 0 && entry.cell === countInCell));
  if (outside) throw new MusicXmlValidationError(`The complete worksheet contains bar ${outside.bar} at ${outside.cell} outside the import mapping ${mapping.startBar}-${mapping.endBar}. Update the mapping to cover the complete numbered chart before importing.`);
  for (const [r, row] of source.values.entries()) for (const [c, text] of row.entries()) {
    try { xml(text); } catch (error) { throw new MusicXmlValidationError(`${columnName(c + 1)}${r + 1}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const [cell, text] of Object.entries(source.notes)) {
    try { xml(text); } catch (error) { throw new MusicXmlValidationError(`${cell} note: ${error instanceof Error ? error.message : String(error)}`); }
  }
  const song = await compileSheetsSong(source, mapping);
  const sourceJson = stableMusicXmlJson(source), mappingJson = stableMusicXmlJson(mapping);
  const [sourceDigest, mappingDigest] = await Promise.all([sha256(sourceJson), sha256(mappingJson)]);
  if (options.selectedRows?.some(row => !Number.isSafeInteger(row) || row < 1)) throw new MusicXmlValidationError('Selected row numbers must be positive safe integers.');
  const rows = discoverSheetVoices(song, source);
  const selected = rows.filter(row => options.selectedRows === undefined || options.selectedRows.includes(Number(row.labelCell.replace(/^[A-Z]+/, ''))));
  if (!selected.length) throw new MusicXmlValidationError('Select at least one voice or instrument row. Header and control rows are included automatically.');
  const vocalPart = song.parts.find(part => part.role.kind === 'default-live');
  const vocalRow = vocalPart ? Number(vocalPart.source.a1.replace(/^[A-Z]+/, '')) : null;
  const report = normalizeSheetMusicalAnnotations({
    profile: MUSICXML_PROFILE, title: song.title, sourceDigest, mappingDigest, meter: mapping.meter,
    bpmPerChartCount: song.chart.bpm, measureCount: song.chart.bars.length,
    selectedLabelCells: selected.map(row => row.labelCell),
    nativeCompilationExecutable: song.executable, compilerDiagnostics: song.diagnostics,
    conventions: [convention, 'Hidden measure rests are structural spacers, not authored silence.',
      'Apostrophe = sampled source notation; ! and !! remain visual markers, never musical dynamics.',
      'Blank arrangement cells have no authored activity. Blank control cells perform no action and do not stop audio.',
      'Implicit subdivisions advance to the earliest following occurrence: &e3a& = 1&, 2e, 3, 3a, 4&.',
      'Capture, layered takes, prefix views and rotary eligibility remain Show Tools metadata, not MusicXML playback instructions.'],
    sections: song.chart.sections,
    vocalCues: vocalRow === null ? [] : song.chart.bars.flatMap(bar => {
      const text = source.values[vocalRow - 1]?.[bar.column - 1] ?? '';
      return text.trim() ? [{ bar: bar.bar, cell: `${columnName(bar.column)}${vocalRow}`, text }] : [];
    }),
    parts: rows.map(row => ({ id: `P${row.labelCell}`, name: row.name, labelCell: row.labelCell, managed: row.managed,
      cells: song.chart.bars.map(bar => {
        const cell = `${columnName(bar.column)}${Number(row.labelCell.replace(/^[A-Z]+/, ''))}`;
        const text = source.values[Number(row.labelCell.replace(/^[A-Z]+/, '')) - 1]?.[bar.column - 1] ?? '';
        const reading: CellReading = song.parts.some(part => part.id === row.partId && part.role.kind === 'default-live') && text.trim()
          ? { kind: 'text', text, reason: 'Main-vocal text has no authored syllable timing; preserved literally.' }
          : readCell(text, mapping.meter.numerator);
        return { cell, bar: bar.bar, text, reading };
      }) })),
  });
  const tailColumn = song.tail && song.chart.bars[song.tail.bar - 1]?.column;
  const boundaryCues: NonNullable<MusicXmlReport['annotations']['boundaryCues']> = report.parts.flatMap(part =>
    (source.values[mapping.barRow - 1] ?? []).flatMap((label, index) => {
      const position = label.trim() === 'Lead-in' || index + 1 === mapping.leadInColumn ? 'lead-in'
        : label.trim() === 'Tail' && index + 1 !== tailColumn ? 'tail' : null;
      const row = Number(part.labelCell.replace(/^[A-Z]+/, ''));
      const text = source.values[row - 1]?.[index] ?? '';
      return position && text.trim() ? [{ partId: part.id, cell: `${columnName(index + 1)}${row}`, position, text }] : [];
    }));
  if (boundaryCues.length) report.annotations.boundaryCues = boundaryCues;
  const output = await writeMusicXmlSong({ song, report, source, mapping });
  const document = await readMusicXmlSong(output);
  return { xml: output, report: document.report };
}

export function renderMusicXmlReview(report: MusicXmlReport, filename: string): string {
  const rows = report.sections.map(section => `<section id="bar-${section.startBar}"><h2>${xml(section.label)} <small>bars ${section.startBar}–${section.endBar}</small></h2><div class="scroll"><table><thead><tr><th>Part</th>${Array.from({ length: section.endBar - section.startBar + 1 }, (_, i) => `<th>${section.startBar + i}</th>`).join('')}</tr></thead><tbody>${report.parts.map(part => `<tr><th>${xml(part.name)}</th>${part.cells.filter(c => c.bar >= section.startBar && c.bar <= section.endBar).map(cell => `<td title="${xml(cell.cell)}"><span>${xml(cell.text || '·')}</span>${cell.reading.kind === 'hits' ? `<small>${cell.reading.offsets.map(n => n + 1).join(' · ')}${cell.reading.sampled ? ' / sampled' : ''}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`).join('\n');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${xml(report.title)} — MusicXML song</title><style>body{font:16px/1.5 system-ui;background:#f7f5f0;color:#242b28;margin:0 auto;padding:36px;max-width:1500px}h1{font-size:36px;margin-bottom:8px}h2{font-size:22px}small{font-size:12px;color:#58625c}header{max-width:950px}a{color:#145c48}nav{display:flex;flex-wrap:wrap;gap:8px}nav a{font-size:13px;background:white;padding:6px 10px;border-radius:6px}.scroll{overflow:auto;border:1px solid #d4d9d1;background:white}table{border-collapse:collapse;font-size:13px;min-width:100%}th,td{padding:10px;border:1px solid #e2e6df;min-width:90px;max-width:210px;vertical-align:top}th:first-child{position:sticky;left:0;background:#eef1e9;min-width:135px}td small{display:block;white-space:nowrap;margin-top:6px}section{margin:36px 0}li{margin:6px 0}code{font-size:12px;overflow-wrap:anywhere}</style><header><small>CANONICAL SONG · ${MUSICXML_PROFILE}</small><h1>${xml(report.title)}</h1><p>${report.measureCount} bars · ${report.parts.length} parts · ${report.meter.numerator}/${report.meter.denominator} · ${report.bpmPerChartCount} BPM per chart count</p><p><a href="${xml(filename)}" download>Download MusicXML</a> · <a href="report.json">Inspect interpretation report</a> · <a href="engraved.html">Open independently engraved score (if rendered)</a></p><p>This is a source-to-score inspection, not observed playback. The grid below shows exact source text and parsed attack counts. The separately engraved score is rendered from the MusicXML file.</p><ul>${report.conventions.map(c => `<li>${xml(c)}</li>`).join('')}</ul><p>Source SHA-256: <code>${report.sourceDigest}</code></p></header><nav>${report.sections.map(s => `<a href="#bar-${s.startBar}">${xml(s.label)}</a>`).join('')}</nav>${rows}</html>\n`;
}
