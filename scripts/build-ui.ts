import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
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
await mkdir(resolve(output, 'ui/practice/wasm'), { recursive: true });
await cp(resolve(root, 'ui/practice/wasm/manual-clock.wasm'), resolve(output, 'ui/practice/wasm/manual-clock.wasm'));
await cp(resolve(root, 'node_modules/sql.js/dist/sql-wasm.wasm'), resolve(root, 'ui/practice/wasm/sql-wasm.wasm'));
await cp(resolve(root, 'ui/practice/wasm/sql-wasm.wasm'), resolve(output, 'ui/practice/wasm/sql-wasm.wasm'));
const characters = JSON.parse(await readFile(resolve(root, 'assets/video/characters.json'), 'utf8'));
const avatarFiles: string[] = [];
for (const character of characters.characters) {
  if (!character.publishedAvatarPath) continue;
  const path = character.publishedAvatarPath;
  if (!/^assets\/video\/poses\/[a-z0-9-]+\.png$/.test(path)) throw new Error('Invalid character avatar path');
  const destination = resolve(output, 'ui/practice', path);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await cp(resolve(root, path), destination);
  avatarFiles.push('/ui/practice/' + path);
}
const browserFiles = Object.keys(result.metafile.outputs).filter(path => path.endsWith('.js') && !path.endsWith('/sw.js')).map(path => '/' + relative(output, resolve(root, path)).replaceAll('\\', '/'));
const worker = resolve(output, 'ui/practice/sw.js');
const offlineFiles = [...browserFiles, '/ui/practice/index.html', '/ui/practice/style.css', '/ui/practice/icon.svg',
  '/ui/practice/manifest.webmanifest', '/ui/practice/voice-library.css', '/ui/practice/wasm/sql-wasm.wasm', ...avatarFiles, '/ui/practice/wasm/manual-clock.wasm'].sort();
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
process.stdout.write('Built the practice desk and deterministic Sheets extension in dist/ui/practice/.\n');
