import { resolve, join } from 'node:path';
import type { MusicXmlReport } from '../lib/performance/musicxml-model.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { importSheetMusicXml } from '../lib/performance/sheet-musicxml.js';
import { writeMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { importSheetChart } from '../lib/performance/chart.js';
import { decodeCompiledSong } from '../lib/performance/compiled-song.js';
import { parseSongSource } from '../lib/performance/song-source.js';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out-dir' || !args[1]) throw new Error('Usage: node --import tsx scripts/migrate-song-musicxml.ts --out-dir NEW_DIRECTORY');
const output = resolve(args[1]);
await mkdir(output);

const source: unknown = JSON.parse(await readFile('songs/dance-yrself-clean.source.json', 'utf8'));
const mapping: unknown = JSON.parse(await readFile('songs/dance-yrself-clean.mapping.json', 'utf8'));
const dyc = await importSheetMusicXml({ source, mapping });
await writeFile(join(output, 'dance-yrself-clean.musicxml'), dyc.xml, { flag: 'wx' });
for (const id of ['drunk-girls', 'i-can-change']) {
  const input: unknown = JSON.parse(await readFile(`songs/${id}.chart.json`, 'utf8'));
  const chart = importSheetChart(input);
  const song = decodeCompiledSong({ schemaVersion: 5, notationVersion: 'dyc-v1', id, title: chart.title,
    ticksPerQuarter: 960, meter: { numerator: 4, denominator: 4 },
    source: { spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId, sheetName: chart.sheetName, range: 'A1:A1', digest: '' },
    mappingDigest: '', chart, voices: [], parts: [], rotation: null, cueWindow: null, cues: [], takes: [], selections: [], playback: [],
    diagnostics: [], executable: false });
  const cells = chart.bars.map(bar => ({ cell: `A${bar.bar}`, bar: bar.bar, text: '', reading: { kind: 'blank' } satisfies { kind: 'blank' } }));
  const report: MusicXmlReport = { profile: 'show-tools-song-v1', title: chart.title, sourceDigest: '', mappingDigest: '', meter: song.meter,
    bpmPerChartCount: chart.bpm, measureCount: chart.bars.length, selectedLabelCells: ['A1'], nativeCompilationExecutable: false,
    compilerDiagnostics: [], conventions: ['Timing-only song. Performance instructions and instrumental detail are unspecified.'],
    sections: chart.sections, vocalCues: [], parts: [{ id: 'P-form', name: 'Form', labelCell: 'A1', managed: false, cells }] };
  const archive = parseSongSource({ sourceVersion: 1, spreadsheetId: chart.spreadsheetId, sheetId: chart.sheetId, sheetName: chart.sheetName,
    range: 'A1:A1', values: [], notes: {} });
  await writeFile(join(output, `${id}.musicxml`), await writeMusicXmlSong({ song, report, source: archive, mapping: input }), { flag: 'wx' });
}
process.stdout.write('Migrated three canonical MusicXML song fixtures.\n');
