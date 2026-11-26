import { link, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseSongSource } from '../lib/performance/song-source.js';
import { importSheetMusicXml } from '../lib/performance/sheet-musicxml.js';
import { readMusicXmlSong } from '../lib/performance/musicxml-song.js';
import { inspectCompiledSong, type SongMapping } from '../lib/performance/compiled-song.js';

const args = process.argv.slice(2);
const [sourcePath, output] = args;
if (args.length !== 2 || !sourcePath || !output) throw new Error('Usage: prepare-drunk-girls.ts source.json output.musicxml');
const source = parseSongSource(JSON.parse(await readFile(sourcePath, 'utf8')));
function requiredRow(label: string) {
  const rows = source.values.flatMap((cells, index) => cells[0]?.trim() === label ? [index + 1] : []);
  if (rows.length !== 1) throw new Error(`Expected one ${label} label in column A; found ${rows.length}`);
  return rows[0];
}
const cueRows = { R1: requiredRow('R1'), R2: requiredRow('R2'), L1: requiredRow('L1'), L2: requiredRow('L2') };
const barRow = source.values[6];
const pickupLabels = barRow[3] === 'Pickup'
  ? ['Pickup', ...Array.from({ length: 8 }, (_, index) => `0.${index + 1}`)]
  : Array.from({ length: 9 }, (_, index) => `Pickup ${index}`);
const tailColumn = barRow.findIndex(value => value === 'Tail') + 1;
const { columnName } = await import('../lib/performance/columns.js');
const mapping: SongMapping = {
  mappingVersion: 6, notationVersion: 'terse-v2', songId: 'drunk-girls',
  spreadsheetId: source.spreadsheetId, sheetId: source.sheetId, sheetName: source.sheetName,
  titleCell: 'B1', bpmCell: 'O3', sectionRow: 6, barRow: 7, leadInColumn: 3, startBar: 1, endBar: 128,
  prelude: pickupLabels.map(label => ({ label, counts: 4 })),
  terminalStops: [`${columnName(tailColumn)}${cueRows.L2}`], meter: { numerator: 4, denominator: 4 },
  controls: [
    { buttonId: 'R1', voiceId: 'day', cueRow: cueRows.R1, arrangementRow: 14, nameNoteCell: `A${cueRows.R1}`, playbackMode: 'loop' },
    { buttonId: 'R2', voiceId: 'girls', cueRow: cueRows.R2, arrangementRow: 12, nameNoteCell: `A${cueRows.R2}`, playbackMode: 'one-shot' },
    { buttonId: 'L1', voiceId: 'boys', cueRow: cueRows.L1, arrangementRow: 13, nameNoteCell: `A${cueRows.L1}`, playbackMode: 'one-shot' },
    { buttonId: 'L2', voiceId: 'guitar', cueRow: cueRows.L2, arrangementRow: 11, nameNoteCell: `A${cueRows.L2}`, playbackMode: 'loop' },
  ],
  liveParts: [{ id: 'vocals', labelCell: 'A10', role: 'default-live' }],
  sourceBindings: [
    { buttonId: 'R1', sourceName: 'lead', voiceId: 'vocals', profile: 4, sourceCell: 'A10', default: true, playbackMode: 'loop' },
    { buttonId: 'R1', sourceName: 'day', voiceId: 'day', sourceCell: 'A14', playbackMode: 'loop' },
    { buttonId: 'R2', sourceName: 'drunk-g', playbackMode: 'one-shot' },
    { buttonId: 'R2', sourceName: 'girls', default: true, playbackMode: 'one-shot' },
    { buttonId: 'L1', sourceName: 'drunk-b', playbackMode: 'one-shot' },
    { buttonId: 'L1', sourceName: 'b', default: true, playbackMode: 'one-shot', sustain: { kind: 'periodic' } },
    { buttonId: 'L2', sourceName: 'guitar', default: true, playbackMode: 'loop', captureReplacement: true, loopCounts: 32, sustain: { kind: 'periodic' } },
  ], cueWindow: { earlyMs: 25, lateMs: 25, ties: 'reject' },
  capturePolicies: ['day', 'girls', 'boys', 'guitar'].map(voiceId => ({ voiceId, retention: 'variant' as const, gain: 1 })),
  layerGroups: [], variantRules: [], variantReuses: [], overrides: [],
  deferredRows: [
    { row: requiredRow('Knob'), reason: 'Signed knob motion bends the single eligible held or gated source in native playback; chart emphasis does not schedule sound.' },
    { row: requiredRow('Big red button'), reason: 'Transport input is handled by practice controls; row text is preserved as authoring metadata.' },
    { row: requiredRow('Pedal'), reason: 'Pedal annotation is preserved; no additional audio action is inferred.' },
  ],
};
const result = await importSheetMusicXml({ source, mapping });
const canonical = await readMusicXmlSong(result.xml);
if (!canonical.song.executable) {
  process.stderr.write(inspectCompiledSong(canonical.song) + '\n');
  process.exitCode = 2;
} else {
  const temporary = await mkdtemp(join(dirname(resolve(output)), '.drunk-girls-import-'));
  try {
    const complete = join(temporary, 'score.musicxml');
    await writeFile(complete, result.xml);
    await link(complete, resolve(output));
  } finally { await rm(temporary, { recursive: true, force: true }); }
  process.stdout.write(inspectCompiledSong(canonical.song) + '\n');
}
