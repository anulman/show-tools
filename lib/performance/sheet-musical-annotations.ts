import { normalizeSheetStageCells } from './sheet-stage-notation.js';
import type { MusicXmlReport, MusicalAnnotations } from './musicxml-model.js';

export function normalizeSheetMusicalAnnotations(report: Omit<MusicXmlReport, 'annotations'>): MusicXmlReport {
  const feels: MusicalAnnotations['feels'] = [];
  const activities: MusicalAnnotations['activities'] = report.parts.flatMap(part => part.managed ? [] : part.cells.map(cell => ({ cell: cell.cell, kind: cell.text.trim() ? 'playing' : 'rest' })));
  const instrumentDisplays: MusicalAnnotations['instrumentDisplays'] = [];
  for (const part of report.parts) {
    for (const section of part.managed ? [] : report.sections) {
      let current: MusicalAnnotations['feels'][number] | undefined;
      for (const cell of part.cells.filter(cell => cell.bar >= section.startBar && cell.bar <= section.endBar)) {
        const token = cell.text.trim();
        const text = token === '!' || token === '!-' ? 'Funky' : token === '!!' ? 'Extra funky' : token === '!!!' ? 'Higher intensity' : undefined;
        if (!text) { current = undefined; continue; }
        if (current && current.text === text && current.endBar + 1 === cell.bar) current.endBar = cell.bar;
        else { current = { partId: part.id, startBar: cell.bar, endBar: cell.bar, text }; feels.push(current); }
      }
    }
    for (const cell of part.managed ? [] : part.cells) if (cell.text.trim() && !['-', '!', '!!', '!!!', '!-'].includes(cell.text.trim())) instrumentDisplays.push({ cell: cell.cell, text: cell.text.trim() });
  }
  const vocals: MusicalAnnotations['vocals'] = report.vocalCues.map(cue => cue.text.trim() === '-3] &'
    ? { cell: cue.cell, kind: 'count-and', countOffset: 2, andOffset: 2.5 }
    : { cell: cue.cell, kind: 'text' });
  return { ...report, annotations: { stageCells: normalizeSheetStageCells(report), activities, feels, vocals, instrumentDisplays } };
}
