import { Schema } from 'effect';
import { CONTROL_IDS, CONTROLS, type Chart, type ChartBar, type ChartSection } from './model.js';
import { columnName } from './columns.js';
export { columnName, CONTROL_IDS, CONTROLS };

const ChartSource = Schema.Struct({
  spreadsheetId: Schema.String,
  sheetId: Schema.Int,
  sheetName: Schema.String,
  annotatedThroughBar: Schema.optionalKey(Schema.Int),
  rowNotes: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  values: Schema.Array(Schema.Array(Schema.NullOr(Schema.String))),
});
const decodeChartSource = Schema.decodeUnknownSync(ChartSource);

export function parseChart(input: unknown): Chart {
  const source = decodeChartSource(input);
  const rows = source.values;
  const barRow = rows.find(row => row[0] === 'Bar');
  const sectionRow = rows.find(row => row[0] === 'Section');
  const tempoRow = rows.find(row => row.includes('Dominant BPM'));
  const bpm = Number(tempoRow?.slice(tempoRow.indexOf('Dominant BPM') + 1).find(value => Number(value) > 0));
  if (!barRow || !sectionRow || !Number.isFinite(bpm) || bpm < 40 || bpm > 240) throw new Error('Chart needs bars, sections, and a 40–240 BPM tempo');
  const controlRows = new Map(CONTROL_IDS.map(id => [id, rows.find(row => row[0] === id)]));
  const bars: ChartBar[] = [];
  const sections: ChartSection[] = [];
  let section: ChartSection | null = null;
  let pendingSection: string | null = null;
  for (let index = 0; index < barRow.length; index++) {
    const sectionLabel = sectionRow[index];
    if (sectionLabel) pendingSection = sectionLabel;
    const label = barRow[index] || '';
    if (!/^\d+(?:\*| \(part\))?$/.test(label)) continue;
    const bar = Number.parseInt(label, 10);
    if (bar !== bars.length + 1) throw new Error('Chart bars must be consecutive from one');
    if (pendingSection) {
      section = { id: `section-${bar}`, label: pendingSection, startBar: bar, endBar: bar };
      sections.push(section);
    }
    pendingSection = null;
    if (!section) throw new Error('The first bar needs a section');
    bars.push({ bar, column: index + 1, sectionId: section.id, section: section.label,
      partial: label.includes('(part)'),
      cues: { L1: controlRows.get('L1')?.[index] || '', L2: controlRows.get('L2')?.[index] || '',
        R1: controlRows.get('R1')?.[index] || '', R2: controlRows.get('R2')?.[index] || '' } });
  }
  if (!bars.length) throw new Error('Chart has no numbered bars');
  sections.forEach((entry, index) => { entry.endBar = (sections[index + 1]?.startBar || bars.length + 1) - 1; });
  const leadInColumn = Math.max(1, barRow.findIndex(label => label === 'Lead-in') + 1);
  return { title: rows[0]?.[1] || source.sheetName, bpm, beatsPerBar: 4, bars, sections,
    spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName,
    leadInColumn, leadInCues: {
      L1: controlRows.get('L1')?.[leadInColumn - 1] || '', L2: controlRows.get('L2')?.[leadInColumn - 1] || '',
      R1: controlRows.get('R1')?.[leadInColumn - 1] || '', R2: controlRows.get('R2')?.[leadInColumn - 1] || '',
    }, controlNames: {
      L1: source.rowNotes?.L1?.trim() || 'L1', R1: source.rowNotes?.R1?.trim() || 'R1',
      L2: source.rowNotes?.L2?.trim() || 'L2', R2: source.rowNotes?.R2?.trim() || 'R2',
    }, annotatedThroughBar: source.annotatedThroughBar ?? 0 };
}

export function playableBars(chart: Chart): number {
  return chart.bars.at(-1)?.partial ? chart.bars.length - 1 : chart.bars.length;
}

export function rangeForBar(chart: Chart, bar: number | null, phase = 'playing'): string {
  const column = phase === 'count-in' ? chart.leadInColumn : bar === null ? null : chart.bars[bar - 1]?.column;
  if (!column) throw new Error('Bar is outside the chart');
  const name = columnName(column);
  return `${name}:${name}`;
}

export function sheetURL(chart: Chart, bar = 1, phase = 'playing'): string {
  const range = rangeForBar(chart, bar, phase);
  return `https://docs.google.com/spreadsheets/d/${chart.spreadsheetId}/edit#gid=${chart.sheetId}&range=${encodeURIComponent(range)}`;
}
