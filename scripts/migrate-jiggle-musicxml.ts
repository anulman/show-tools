import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { migrateMusicXmlSongV2 } from '../lib/performance/musicxml-song.js';

export async function migrateJiggleMusicXml(input: string, output: string): Promise<void> {
  const result = await migrateMusicXmlSongV2(await readFile(input, 'utf8'));
  await writeFile(output, result, { flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[1] !== '--out') throw new Error('Usage: node --import tsx scripts/migrate-jiggle-musicxml.ts INPUT.musicxml --out NEW.musicxml');
  await migrateJiggleMusicXml(args[0], args[2]);
}
