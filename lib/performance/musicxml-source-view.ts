import type { readMusicXmlSong } from './musicxml-song.js';
import type { SongSource } from './song-source.js';
import { columnName } from './columns.js';

export function musicXmlSourceView(document: Pick<Awaited<ReturnType<typeof readMusicXmlSong>>, 'song' | 'report'>): SongSource {
  const { song, report } = document;
  const values: string[][] = [];
  const notes: Record<string, string> = {};
  let allocatedCells = 0;
  function put(cell: string, text: string, note = '') {
    const match = /^([A-Z]+)([1-9]\d*)$/.exec(cell);
    if (!match) throw new Error(`Invalid MusicXML sheet provenance ${cell}.`);
    const row = Number(match[2]) - 1;
    const column = [...match[1]].reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) - 1;
    if (!Number.isSafeInteger(row) || row >= 4096 || column >= 16384) throw new Error('MusicXML source view exceeds the supported coordinate range.');
    const growth = Math.max(0, column + 1 - (values[row]?.length ?? 0));
    if (allocatedCells + growth > 2_000_000) throw new Error('MusicXML source view exceeds the two-million-cell limit.');
    allocatedCells += growth;
    while (values.length <= row) values.push([]);
    while (values[row].length <= column) values[row].push('');
    values[row][column] = text;
    if (note) notes[cell] = note;
  }
  for (const part of report.parts) {
    put(part.labelCell, `${part.managed ? 'AF - ' : ''}${part.name}`);
    for (const cell of part.cells) put(cell.cell, cell.text);
  }
  for (const cue of song.cues) {
    const row = cue.source.a1.replace(/^[A-Z]+/, '');
    put(`A${row}`, cue.buttonId, song.chart.controlNames[cue.buttonId]);
    put(cue.source.a1, cue.source.text, cue.source.note);
  }
  for (const window of song.rotation?.windows ?? []) {
    for (const source of [...window.sources, window.source, window.endSource]) {
      const row = source.a1.replace(/^[A-Z]+/, '');
      put(`A${row}`, 'Knob');
      put(source.a1, source.text, source.note);
    }
  }
  const columns = Math.max(1, ...values.map(row => row.length));
  return { sourceVersion: 1, spreadsheetId: song.source.spreadsheetId, sheetId: song.source.sheetId,
    sheetName: song.source.sheetName, range: `A1:${columnName(columns)}${Math.max(1, values.length)}`, values, notes };
}
