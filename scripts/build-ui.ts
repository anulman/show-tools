import { build } from 'esbuild';
import { cp, mkdir, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
const result = await build({
  absWorkingDir: root,
  entryPoints: ['ui/practice/app.ts', 'ui/practice/practice-worklet.ts', 'ui/practice/sw.ts'],
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
    if (['tests', 'evidence', 'wasm'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await copyAssets(path);
    else if (/\.(html|css|svg|webmanifest|md)$/.test(path) || path.endsWith('sheets-extension/manifest.json')) {
      const destination = resolve(output, relative(root, path));
      await mkdir(resolve(destination, '..'), { recursive: true });
      await cp(path, destination);
    }
  }
}
await copyAssets(resolve(root, 'ui/practice'));
await mkdir(resolve(output, 'ui/practice/wasm'), { recursive: true });
await cp(resolve(root, 'ui/practice/wasm/manual-clock.wasm'), resolve(output, 'ui/practice/wasm/manual-clock.wasm'));
const browserFiles = Object.keys(result.metafile.outputs).filter(path => path.endsWith('.js')).map(path => '/' + relative(output, resolve(root, path)).replaceAll('\\', '/'));
const worker = resolve(output, 'ui/practice/sw.js');
await writeFile(worker, (await readFile(worker, 'utf8')).replace('"__BUILD_MODULE_FILES__"', JSON.stringify(browserFiles)));
await writeFile(resolve(output, 'build-meta.json'), JSON.stringify(result.metafile, null, 2));
process.stdout.write('Built the practice desk and deterministic Sheets extension in dist/ui/practice/.\n');
