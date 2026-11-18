import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { Schema } from 'effect';
import sharp from 'sharp';
import { sourceInfo } from '../lib/ui-host/snapshot.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
const source = await sourceInfo(root);
await rm(output, { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['ui/practice/app.ts', 'ui/practice/practice-worklet.ts', 'ui/practice/mp3-worker.ts', 'ui/practice/catalog-worker.ts', 'ui/practice/sw.ts'],
  outdir: output, outbase: '.', bundle: true, splitting: true, format: 'esm', target: 'es2022',
  chunkNames: 'ui/practice/chunks/[name]-[hash]', metafile: true, sourcemap: true,
});
function checkAudioDependencies(path: string, visited = new Set<string>()): void {
  if (visited.has(path)) return;
  visited.add(path);
  const metadata = result.metafile.outputs[path];
  if (!metadata) throw new Error(`Missing audio module ${path}`);
  if (Object.keys(metadata.inputs).some(input => input.includes('node_modules/'))) {
    throw new Error('The audio worklet must not contain Effect or another package runtime');
  }
  for (const dependency of metadata.imports) if (!dependency.external) checkAudioDependencies(dependency.path, visited);
}
for (const path of Object.keys(result.metafile.outputs)) if (path.endsWith('/practice-worklet.js')) checkAudioDependencies(path);
await build({ absWorkingDir: root,
  entryPoints: ['ui/practice/sheets-extension/background.ts', 'ui/practice/sheets-extension/follow.ts', 'ui/practice/sheets-extension/practice-bridge.ts'],
  outdir: resolve(output, 'ui/practice/sheets-extension'), outbase: 'ui/practice/sheets-extension',
  bundle: true, format: 'iife', target: 'es2022', sourcemap: true,
});
async function copyAssets(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (['tests', 'evidence', 'studies', 'wasm'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await copyAssets(path);
    else if (/\.(html|css|svg|webmanifest|md)$/.test(path) || path.includes('/licenses/') || path.endsWith('sheets-extension/manifest.json')) {
      const destination = resolve(output, relative(root, path));
      await mkdir(resolve(destination, '..'), { recursive: true });
      await cp(path, destination);
    }
  }
}
await copyAssets(resolve(root, 'ui/practice'));
await cp(resolve(root, 'ui/tuner/panel.css'), resolve(output, 'ui/practice/tuner.css'));
const index = resolve(output, 'ui/practice/index.html');
await writeFile(index, (await readFile(index, 'utf8')).replace('href="../tuner/panel.css"', 'href="./tuner.css"'));
const tunerAsset = Schema.decodeUnknownSync(Schema.Struct({
  schemaVersion: Schema.Literal(1), file: Schema.Literal('disco-ball.png'),
  sha256: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  width: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 96 })),
  height: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 96 })), scale: Schema.Literal(1),
}))(JSON.parse(await readFile(resolve(root, 'assets/video/tuner/manifest.json'), 'utf8')));
const tunerBall = await readFile(resolve(root, 'assets/video/tuner', tunerAsset.file));
assert.equal(createHash('sha256').update(tunerBall).digest('hex'), tunerAsset.sha256, 'Tuner artwork matches its approved source hash');
const pixels = await sharp(tunerBall).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert.equal(pixels.info.width, tunerAsset.width, 'Tuner artwork preserves native width');
assert.equal(pixels.info.height, tunerAsset.height, 'Tuner artwork preserves native height');
assert.equal(pixels.info.channels, 4);
for (const index of [0, tunerAsset.width - 1, tunerAsset.width * (tunerAsset.height - 1), tunerAsset.width * tunerAsset.height - 1])
  assert.equal(pixels.data[index * 4 + 3], 0, 'Tuner artwork has transparent corners');
assert(pixels.data.some((value, index) => index % 4 === 3 && value > 0), 'Tuner artwork is nonempty');
await mkdir(resolve(output, 'ui/practice/assets/tuner'), { recursive: true });
for (const name of [tunerAsset.file, 'manifest.json'])
  await cp(resolve(root, 'assets/video/tuner', name), resolve(output, 'ui/practice/assets/tuner', name));
const tunerFiles = ['/ui/practice/assets/tuner/disco-ball.png', '/ui/practice/assets/tuner/manifest.json'];
await mkdir(resolve(output, 'ui/practice/wasm'), { recursive: true });
await cp(resolve(root, 'ui/practice/wasm/manual-clock.wasm'), resolve(output, 'ui/practice/wasm/manual-clock.wasm'));
await cp(resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), resolve(root, 'ui/practice/wasm/sql-wasm.wasm'));
await cp(resolve(root, 'ui/practice/wasm/sql-wasm.wasm'), resolve(output, 'ui/practice/wasm/sql-wasm.wasm'));
const characters = JSON.parse(await readFile(resolve(root, 'assets/video/characters.json'), 'utf8'));
const avatarFiles: string[] = [];
for (const character of characters.characters) {
  const path = character.publishedAvatarPath;
  if (!/^[A-Z][0-9]{2}$/.test(character.id) || path !== `assets/video/avatars/${character.id}.png`) throw new Error('Invalid character avatar path');
  const destination = resolve(output, 'ui/practice', path);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await cp(resolve(root, path), destination);
  avatarFiles.push('/ui/practice/' + path);
}
const songFiles: string[] = [];
await mkdir(resolve(output, 'ui/practice/songs'), { recursive: true });
for (const name of (await readdir(resolve(root, 'songs'))).filter(name => name.endsWith('.musicxml')).sort()) {
  await cp(resolve(root, 'songs', name), resolve(output, 'ui/practice/songs', name));
  songFiles.push('/ui/practice/songs/' + name);
}
const browserFiles = Object.keys(result.metafile.outputs).filter(path => path.endsWith('.js') && !path.endsWith('/sw.js')).map(path => '/' + relative(output, resolve(root, path)).replaceAll('\\', '/'));
const worker = resolve(output, 'ui/practice/sw.js');
const offlineFiles = [...browserFiles, ...songFiles, '/ui/practice/index.html', '/ui/practice/style.css', '/ui/practice/icon.svg',
  '/ui/practice/manifest.webmanifest', '/ui/practice/voice-library.css', '/ui/practice/tuner.css', ...tunerFiles, '/ui/practice/wasm/sql-wasm.wasm', ...avatarFiles, '/ui/practice/wasm/manual-clock.wasm'].sort();
const offlineHash = createHash('sha256');
for (const path of offlineFiles) {
  offlineHash.update(path).update('\0').update(await readFile(resolve(output, '.' + path))).update('\0');
}
const cacheId = offlineHash.digest('hex');
await writeFile(worker, (await readFile(worker, 'utf8'))
  .replace('__BUILD_CACHE_ID__', cacheId)
  .replace('"__BUILD_MODULE_FILES__"', JSON.stringify(offlineFiles)));
await writeFile(resolve(output, 'ui/practice/offline-manifest.json'), JSON.stringify({ cacheId, files: offlineFiles }, null, 2));
await writeFile(resolve(output, 'build-meta.json'), JSON.stringify(result.metafile, null, 2));
const finalSource = await sourceInfo(root);
if (source.revision !== finalSource.revision || source.tree !== finalSource.tree || source.dirty !== finalSource.dirty) throw new Error('Source identity changed during the UI build. Rebuild before publishing.');
await writeFile(resolve(output, 'build-info.json'), JSON.stringify({ version: 1, source }, null, 2));
process.stdout.write('Built the Performance Desk and deterministic Sheets extension in dist/ui/practice/.\n');
