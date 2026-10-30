import { readFile, writeFile, rename, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { compileSong, decodeCompiledSong, inspectCompiledSong, canonicalSongJson } from '../lib/performance/compiled-song.js';
import { compiledProgramBytes } from '../lib/performance/compiled-native.js';
import { fetchSongSource, parseSongSource, parseWorkbookSource, canonicalSourceJson } from '../lib/performance/song-source.js';

export const CHART_HELP = `Usage:
  show-tools chart fetch --url WORKSHEET_URL --out SOURCE.json [--sheet-name NAME]
  show-tools chart import --csv CHART.csv --workbook CHART.xlsx --url WORKSHEET_URL --out SOURCE.json
  show-tools chart compile --source SOURCE.json --mapping MAPPING.json --out SONG.json [--draft]
  show-tools chart encode --song SONG.json --out SONG.pfp
  show-tools chart inspect SONG.json

Fetch reads public worksheet values and cell notes. Compile runs offline.
Executable output requires resolved notation and explicit capture/cue policies.
--draft writes a reviewable artifact with diagnostics and never emits native audio data.
Encode reads the validated compiled JSON; each command publishes one output atomically.
`;

async function jsonFile(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')); }
async function atomicWrite(path: string, data: string | Uint8Array, inputs: readonly string[] = []) {
  if (!basename(path) || ['.', '..'].includes(basename(path)) || /[\\/]$/.test(path))
    throw new Error('Choose an output filename rather than a directory.');
  const inputStats = await Promise.all(inputs.map(input => stat(input)));
  let existing;
  try { existing = await stat(path); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (existing && inputStats.some(input => input.dev === existing.dev && input.ino === existing.ino))
    throw new Error(`Output ${path} is an input file. Choose a separate output filename and rerun.`);
  await mkdir(dirname(path), { recursive: true });
  const parent = realpathSync.native(dirname(path));
  const staging = await mkdtemp(join(parent, '.chart-'));
  try {
    const temporary = join(staging, 'output');
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, join(parent, basename(path)));
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function runChartCompiler(args: readonly string[]): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) { process.stdout.write(CHART_HELP); return; }
  const command = args[0];
  if (command === 'inspect') {
    if (args.length !== 2) throw new Error('Specify one compiled song JSON file to inspect.');
    process.stdout.write(inspectCompiledSong(await jsonFile(args[1])));
    return;
  }
  const allowed = command === 'fetch' ? ['--url', '--out', '--sheet-name']
    : command === 'import' ? ['--url', '--out', '--csv', '--workbook']
      : command === 'compile' ? ['--source', '--mapping', '--out', '--draft']
        : command === 'encode' ? ['--song', '--out'] : [];
  if (!allowed.length) throw new Error('Expected chart fetch, import, compile, encode, or inspect. Run show-tools chart --help.');
  const options = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const key = args[index];
    if (key === '--native-out') throw new Error('Compile now publishes JSON only. Run show-tools chart encode --song SONG.json --out SONG.pfp after compilation.');
    if (!allowed.includes(key) || options.has(key)) throw new Error(`Unknown or repeated chart option ${key}.`);
    if (key === '--draft') options.set(key, 'true');
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}.`);
      options.set(key, value);
    }
  }
  const required = (key: string) => {
    const value = options.get(key);
    if (!value) throw new Error(`Specify ${key}.`);
    return value;
  };
  if (command === 'fetch') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const source = await fetchSongSource(required('--url'), { signal: controller.signal, sheetName: options.get('--sheet-name') });
      await atomicWrite(required('--out'), canonicalSourceJson(source));
      process.stdout.write(`Fetched ${source.sheetName}, gid ${source.sheetId}, ${Object.keys(source.notes).length} cell notes.\n`);
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return;
  }
  if (command === 'import') {
    const { parseWorksheetUrl } = await import('../lib/performance/song-source.js');
    const source = parseWorkbookSource(await readFile(required('--csv'), 'utf8'), new Uint8Array(await readFile(required('--workbook'))), parseWorksheetUrl(required('--url')));
    await atomicWrite(required('--out'), canonicalSourceJson(source), [required('--csv'), required('--workbook')]);
    process.stdout.write(`Imported ${source.sheetName}, gid ${source.sheetId}.\n`);
    return;
  }
  if (command === 'encode') {
    const song = decodeCompiledSong(await jsonFile(required('--song')));
    if (!song.executable) throw new Error('Native encoding is blocked by chart diagnostics. Inspect the song, resolve its source/mapping diagnostics, and compile again.');
    await atomicWrite(required('--out'), compiledProgramBytes(song), [required('--song')]);
    process.stdout.write(`Encoded ${song.id}, schema ${song.schemaVersion}.\n`);
    return;
  }
  const source = parseSongSource(await jsonFile(required('--source')));
  const song = decodeCompiledSong(await compileSong(source, await jsonFile(required('--mapping'))));
  const draft = options.has('--draft');
  process.stdout.write(inspectCompiledSong(song));
  if (!song.executable && !draft) throw new Error('Compilation is blocked. Resolve the listed diagnostics or use --draft for inspection only.');
  await atomicWrite(required('--out'), canonicalSongJson(song), [required('--source'), required('--mapping')]);
}
