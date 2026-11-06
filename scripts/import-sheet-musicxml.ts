import { stableMusicXmlJson } from '../lib/performance/score-xml.js';
import { mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Schema } from 'effect';
import { decodeSongMapping } from '../lib/performance/compiled-song.js';
import { MusicXmlValidationError } from '../lib/performance/musicxml-song.js';
import { parseSongSource } from '../lib/performance/song-source.js';
import { importSheetMusicXml, renderMusicXmlReview } from '../lib/performance/sheet-musicxml.js';
import { isCliEntrypoint } from './cli-entry.js';
import { chiefHandoff, commandFailureExitCode, formatCommandFailure, parseCommandFailure, productFailure } from './lib/command-diagnostics.js';

function argumentsFailure(message: string) {
  return productFailure({ code: 'CHART_ARGUMENTS', message,
    nextSteps: ['Run show-tools chart musicxml --source SOURCE.json --mapping MAPPING.json --out-dir NEW_DIRECTORY.'], locations: [] });
}
async function inputFile<T>(path: string, decode: (input: unknown) => T): Promise<T> {
  const contents = await readFile(path, 'utf8');
  let value: unknown;
  try { value = JSON.parse(contents); }
  catch {
    throw productFailure({ code: 'CHART_INPUT_JSON', message: 'The chart input is not valid JSON.',
      nextSteps: ['Correct the JSON syntax or export the input again, then rerun the command.'], locations: [path] });
  }
  try { return decode(value); }
  catch (error) {
    if (!Schema.isSchemaError(error)) throw error;
    throw productFailure({ code: 'CHART_INPUT_SCHEMA', message: 'The input does not satisfy the supported worksheet import schema.',
      nextSteps: ['Check the worksheet snapshot and mapping versions, then import again.'], locations: [path] });
  }
}

export async function runSheetsMusicXmlImport(args: readonly string[], report = (message: string) => { process.stdout.write(message); }): Promise<void> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--source', '--mapping', '--out-dir'].includes(key) || options.has(key) || !value || value.startsWith('--')) {
      throw argumentsFailure('Unknown, repeated or incomplete MusicXML import option.');
    }
    options.set(key, value);
  }
  const required = (key: string) => {
    const value = options.get(key);
    if (!value) throw argumentsFailure(`Specify ${key}.`);
    return value;
  };
  const sourcePath = required('--source'), mappingPath = required('--mapping');
  const source = await inputFile(sourcePath, parseSongSource), mapping = await inputFile(mappingPath, decodeSongMapping);
  const directory = resolve(required('--out-dir'));
  let result;
  try { result = await importSheetMusicXml({ source, mapping }); }
  catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid mapped cell ')) throw productFailure({ code: 'CHART_MAPPING_CELL', message: 'The mapping contains an invalid source-cell address.',
      nextSteps: ['Use A1-style cell addresses in the mapping, then import again.'], locations: [mappingPath] });
    if (!(error instanceof MusicXmlValidationError || Schema.isSchemaError(error) || error instanceof Error && /XML 1\.0 cannot represent/.test(error.message))) throw error;
    throw productFailure({ code: 'CHART_IMPORT_MUSICXML', message: Schema.isSchemaError(error) ? 'The input does not satisfy the canonical MusicXML song profile.' : error.message,
      nextSteps: ['Correct the worksheet data and import mapping, then import again.'], locations: [sourcePath, mappingPath] });
  }
  await mkdir(dirname(directory), { recursive: true });
  const staging = await mkdtemp(join(dirname(directory), '.musicxml-'));
  let reserved = false, published = false;
  try {
    await writeFile(join(staging, 'score.musicxml'), result.xml, { flag: 'wx' });
    await writeFile(join(staging, 'report.json'), stableMusicXmlJson(result.report) + '\n', { flag: 'wx' });
    await writeFile(join(staging, 'index.html'), renderMusicXmlReview(result.report, 'score.musicxml'), { flag: 'wx' });
    await mkdir(directory);
    reserved = true;
    await rename(staging, directory);
    published = true;
  } finally {
    await rm(staging, { recursive: true, force: true });
    if (reserved && !published) await rmdir(directory);
  }
  report(`Canonical MusicXML: ${result.report.measureCount} bars, ${result.report.parts.length} parts.\nOpen ${join(directory, 'index.html')}\n`);
}

if (await isCliEntrypoint(import.meta.url)) {
  const args = process.argv.slice(2), json = args.includes('--json');
  try { await runSheetsMusicXmlImport(args.filter(argument => argument !== '--json')); }
  catch (error) {
    let failure;
    try { failure = parseCommandFailure(error); }
    catch {
      failure = error instanceof Error && 'code' in error && typeof error.code === 'string'
        && ['ENOENT', 'EACCES', 'EPERM', 'EISDIR', 'ENOTDIR', 'ENOSPC', 'EROFS', 'EEXIST', 'EINVAL', 'ENAMETOOLONG', 'EIO', 'EDQUOT'].includes(error.code)
        ? productFailure({ code: 'CHART_FILE_ACCESS', message: `Chart file access failed (${error.code}).`,
          nextSteps: ['Check paths, permissions and disk space. Choose an output directory that does not exist.'], locations: [] })
        : chiefHandoff({ code: 'CHART_COMMAND_FAILED', message: 'The MusicXML import encountered an unexpected tooling failure.',
          nextSteps: ['Hand the command and its inputs to Chief to diagnose the failure.'], locations: [] });
    }
    (json ? process.stdout : process.stderr).write(formatCommandFailure(failure, json ? 'json' : 'human'));
    process.exitCode = commandFailureExitCode(failure);
  }
}
