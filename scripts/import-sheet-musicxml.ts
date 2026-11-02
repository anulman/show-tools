import { stableMusicXmlJson } from '../lib/performance/score-xml.js';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { importSheetMusicXml, renderMusicXmlReview } from '../lib/performance/sheet-musicxml.js';

export async function runSheetsMusicXmlImport(args: readonly string[]): Promise<void> {
  const options = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--source', '--mapping', '--out-dir'].includes(key) || options.has(key) || !value || value.startsWith('--')) {
      throw new Error('Usage: show-tools chart musicxml --source SOURCE.json --mapping MAPPING.json --out-dir NEW_DIRECTORY');
    }
    options.set(key, value);
  }
  const required = (key: string) => {
    const value = options.get(key);
    if (!value) throw new Error(`Specify ${key}.`);
    return value;
  };
  const source: unknown = JSON.parse(await readFile(required('--source'), 'utf8'));
  const mapping: unknown = JSON.parse(await readFile(required('--mapping'), 'utf8'));
  const directory = resolve(required('--out-dir'));
  const result = await importSheetMusicXml({ source, mapping });
  await mkdir(directory);
  await writeFile(join(directory, 'score.musicxml'), result.xml, { flag: 'wx' });
  await writeFile(join(directory, 'report.json'), stableMusicXmlJson(result.report) + '\n', { flag: 'wx' });
  await writeFile(join(directory, 'index.html'), renderMusicXmlReview(result.report, 'score.musicxml'), { flag: 'wx' });
  process.stdout.write(`Canonical MusicXML: ${result.report.measureCount} bars, ${result.report.parts.length} parts.\nOpen ${join(directory, 'index.html')}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await runSheetsMusicXmlImport(process.argv.slice(2));
}
