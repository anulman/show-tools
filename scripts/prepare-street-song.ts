import { readFile, writeFile } from 'node:fs/promises';
import { prepareStreetSong } from '../lib/video/song-score.js';

const [catalogPath, sourcePath, mappingPath, assetsPath, output] = process.argv.slice(2);
if (!catalogPath || !sourcePath || !mappingPath || !assetsPath || !output) throw new Error('Usage: prepare-street-song.ts catalog.json source.json mapping.json assets-scene.json output.json (private inputs/output)');
const [catalog, source, mapping, assets]: unknown[] = await Promise.all([catalogPath, sourcePath, mappingPath, assetsPath].map(async path => JSON.parse(await readFile(path, 'utf8'))));
const result = await prepareStreetSong({ catalog, source, mapping, assets });
if (result.kind === 'blocked') {
  process.stderr.write(`${JSON.stringify(result.diagnostics, null, 2)}\n`);
  process.exitCode = 1;
} else {
  await writeFile(output, `${JSON.stringify(result.scene, null, 2)}\n`);
  await writeFile(`${output}.receipt.json`, `${JSON.stringify(result.receipt, null, 2)}\n`);
  process.stdout.write(`Prepared ${result.scene.actors.length} actors, ${result.scene.durationCounts} counts, ${(result.scene.durationCounts / result.scene.previewCountsPerSecond).toFixed(6)} seconds.\n`);
}
