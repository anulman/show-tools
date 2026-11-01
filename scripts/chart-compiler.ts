import { readFile, writeFile, rename, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { Schema } from 'effect';
import { compileSong, decodeCompiledSong, decodeSongMapping, inspectCompiledSong, canonicalSongJson } from '../lib/performance/compiled-song.js';
import { compiledProgramBytes } from '../lib/performance/compiled-native.js';
import { fetchSongSource, parseSongSource, parseWorkbookSource, parseWorksheetUrl, canonicalSourceJson } from '../lib/performance/song-source.js';
import { productFailure } from './lib/command-diagnostics.js';

export const CHART_HELP = `Usage:
  show-tools chart fetch --url WORKSHEET_URL --out SOURCE.json [--sheet-name NAME]
  show-tools chart import --csv CHART.csv --workbook CHART.xlsx --url WORKSHEET_URL --out SOURCE.json
  show-tools chart compile --source SOURCE.json --mapping MAPPING.json --out SONG.json [--draft]
  show-tools chart encode --song SONG.json --out SONG.pfp
  show-tools chart inspect SONG.json
  show-tools chart musicxml --source SOURCE.json --mapping MAPPING.json --out-dir NEW_DIRECTORY

Fetch reads public worksheet values and cell notes. Compile runs offline.
Executable output requires resolved notation and explicit capture/cue policies.
--draft writes a reviewable artifact with diagnostics and never emits native audio data.
Encode reads the validated compiled JSON; each command publishes one output atomically.
--json reports failures as one JSON object, with exit 2 for a blocked chart or 3 for Chief.
`;

function invalidArguments(message: string) {
  return productFailure({ code: 'CHART_ARGUMENTS', message, nextSteps: ['Run show-tools chart --help and supply the required options.'], locations: [] });
}
function worksheetLocation(input: string) {
  try { return parseWorksheetUrl(input); }
  catch {
    throw productFailure({ code: 'CHART_WORKSHEET_URL', message: 'The worksheet URL must identify one HTTPS Google Sheets worksheet and numeric gid.',
      nextSteps: ['Copy the worksheet URL from Google Sheets, including its gid, and rerun.'], locations: [] });
  }
}
async function jsonFile<T>(path: string, decode: (input: unknown) => T): Promise<T> {
  const text = await readFile(path, 'utf8');
  let value: unknown;
  try { value = JSON.parse(text); }
  catch {
    throw productFailure({ code: 'CHART_INPUT_JSON', message: 'The chart input is not valid JSON.',
      nextSteps: ['Correct the JSON syntax or export the input again, then rerun the command.'], locations: [path] });
  }
  try { return decode(value); }
  catch (error) {
    if (!(Schema.isSchemaError(error) || error instanceof Error && error.constructor === Error)) throw error;
    throw productFailure({ code: 'CHART_INPUT_SCHEMA', message: Schema.isSchemaError(error)
      ? 'The input does not satisfy the supported chart schema.' : error.message,
      nextSteps: ['Check the input version and chart timing, bindings, and references. Regenerate it with the current compiler.'], locations: [path] });
  }
}
async function atomicWrite(path: string, data: string | Uint8Array, inputs: readonly string[] = []) {
  if (!basename(path) || ['.', '..'].includes(basename(path)) || /[\\/]$/.test(path))
    throw invalidArguments('Choose an output filename rather than a directory.');
  const inputStats = await Promise.all(inputs.map(input => stat(input)));
  let existing;
  try { existing = await stat(path); }
  catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
  if (existing && inputStats.some(input => input.dev === existing.dev && input.ino === existing.ino))
    throw productFailure({ code: 'CHART_OUTPUT_IS_INPUT', message: 'The output is an input file or an alias of it.',
      nextSteps: ['Choose a separate output filename and rerun.'], locations: [path] });
  await mkdir(dirname(path), { recursive: true });
  const parent = realpathSync.native(dirname(path));
  const staging = await mkdtemp(join(parent, '.chart-'));
  try {
    const temporary = join(staging, 'output');
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, join(parent, basename(path)));
  } finally { await rm(staging, { recursive: true, force: true }); }
}

export async function runChartCompiler(args: readonly string[], report = (message: string) => { process.stdout.write(message); }): Promise<void> {
  try { await executeChartCompiler(args, report); }
  catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string'
      && ['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ENOSPC', 'EROFS', 'EEXIST', 'EINVAL', 'ENAMETOOLONG', 'EIO', 'EDQUOT'].includes(error.code)) {
      throw productFailure({ code: 'CHART_FILE_ACCESS', message: `Chart file access failed (${error.code}).`,
        nextSteps: ['Check the input/output paths, directory permissions and free disk space, then rerun. Inspect the output if cleanup failed after publication.'],
        locations: 'path' in error && typeof error.path === 'string' ? [error.path] : [] });
    }
    throw error;
  }
}

async function executeChartCompiler(args: readonly string[], report: (message: string) => void): Promise<void> {
  if (!args.length || args.includes('--help') || args.includes('-h')) { report(CHART_HELP); return; }
  const command = args[0];
  if (command === 'musicxml') {
    const { runMusicXmlStudy } = await import('./import-sheet-musicxml.js');
    await runMusicXmlStudy(args.slice(1));
    return;
  }
  if (command === 'inspect') {
    if (args.length !== 2) throw invalidArguments('Specify one compiled song JSON file to inspect.');
    report(inspectCompiledSong(await jsonFile(args[1], decodeCompiledSong)));
    return;
  }
  const allowed = command === 'fetch' ? ['--url', '--out', '--sheet-name']
    : command === 'import' ? ['--url', '--out', '--csv', '--workbook']
      : command === 'compile' ? ['--source', '--mapping', '--out', '--draft']
        : command === 'encode' ? ['--song', '--out'] : [];
  if (!allowed.length) throw invalidArguments('Expected chart fetch, import, compile, encode, or inspect.');
  const options = new Map<string, string>();
  for (let index = 1; index < args.length; index++) {
    const key = args[index];
    if (key === '--native-out') throw invalidArguments('Compile now publishes JSON only. Run show-tools chart encode --song SONG.json --out SONG.pfp after compilation.');
    if (!allowed.includes(key) || options.has(key)) throw invalidArguments(`Unknown or repeated chart option ${key}.`);
    if (key === '--draft') options.set(key, 'true');
    else {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw invalidArguments(`Missing value for ${key}.`);
      options.set(key, value);
    }
  }
  const required = (key: string) => {
    const value = options.get(key);
    if (!value) throw invalidArguments(`Specify ${key}.`);
    return value;
  };
  const output = required('--out');
  if (command === 'fetch') {
    const controller = new AbortController();
    const stop = () => controller.abort();
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    try {
      const url = required('--url');
      worksheetLocation(url);
      let source;
      try { source = await fetchSongSource(url, { signal: controller.signal, sheetName: options.get('--sheet-name') }); }
      catch (error) {
        if (!(Schema.isSchemaError(error) || error instanceof Error && (error.constructor === Error || error instanceof TypeError && error.message === 'fetch failed'))) throw error;
        throw productFailure({ code: 'CHART_SOURCE_FETCH', message: Schema.isSchemaError(error)
          ? 'The fetched worksheet does not satisfy the supported source schema.' : error.message,
          nextSteps: ['Check the worksheet URL, public read access and network. Retry, or import matching frozen CSV and XLSX exports.'], locations: [] });
      }
      await atomicWrite(output, canonicalSourceJson(source));
      report(`Fetched ${source.sheetName}, gid ${source.sheetId}, ${Object.keys(source.notes).length} cell notes.\n`);
    } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
    return;
  }
  if (command === 'import') {
    const location = worksheetLocation(required('--url'));
    const csv = await readFile(required('--csv'), 'utf8'), workbook = new Uint8Array(await readFile(required('--workbook')));
    let source;
    try { source = parseWorkbookSource(csv, workbook, location); }
    catch (error) {
      if (!(Schema.isSchemaError(error) || error instanceof Error && error.constructor === Error)) throw error;
      throw productFailure({ code: 'CHART_SOURCE_IMPORT', message: Schema.isSchemaError(error)
        ? 'The workbook does not satisfy the supported worksheet and notes schema.' : error.message,
        nextSteps: ['Refresh both exports from the same worksheet, correct formula errors or ambiguous sheet matches, then import again.'], locations: [required('--csv'), required('--workbook')] });
    }
    await atomicWrite(output, canonicalSourceJson(source), [required('--csv'), required('--workbook')]);
    report(`Imported ${source.sheetName}, gid ${source.sheetId}.\n`);
    return;
  }
  if (command === 'encode') {
    const song = await jsonFile(required('--song'), decodeCompiledSong);
    if (!song.executable) throw productFailure({ code: 'CHART_ENCODE_BLOCKED', message: 'Native encoding is blocked by chart diagnostics.',
      nextSteps: ['Inspect the song, resolve its source/mapping diagnostics, and compile again.'], locations: [required('--song')] });
    await atomicWrite(output, compiledProgramBytes(song), [required('--song')]);
    report(`Encoded ${song.id}, schema ${song.schemaVersion}.\n`);
    return;
  }
  const source = await jsonFile(required('--source'), parseSongSource);
  const mapping = await jsonFile(required('--mapping'), decodeSongMapping);
  let compiled;
  try { compiled = await compileSong(source, mapping); }
  catch (error) {
    if (!(error instanceof Error && error.message.startsWith('Invalid mapped cell '))) throw error;
    throw productFailure({ code: 'CHART_MAPPING_CELL', message: 'The mapping contains an invalid source-cell address.',
      nextSteps: ['Use A1-style cell addresses in the mapping, then compile again.'], locations: [required('--mapping')] });
  }
  const song = decodeCompiledSong(compiled);
  const draft = options.has('--draft');
  report(inspectCompiledSong(song));
  if (!song.executable && !draft) {
    const diagnostics = song.diagnostics.filter(item => item.severity === 'error');
    throw productFailure({ code: 'CHART_COMPILE_BLOCKED', message: 'Compilation is blocked. ' + diagnostics.map(item => `${item.code}: ${item.message}`).join('\n'),
      nextSteps: ['Resolve the listed source/mapping diagnostics, then compile again. Use --draft only for a non-executable review artifact.'],
      locations: diagnostics.map(item => `${required('--source')}#${item.source.a1} ${JSON.stringify(item.source.text)}`) });
  }
  await atomicWrite(output, canonicalSongJson(song), [required('--source'), required('--mapping')]);
}
