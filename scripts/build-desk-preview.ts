import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { TANSTACK_ASSET_PATH, TANSTACK_DESK_PATH, TANSTACK_STATIC_PATH } from '../lib/remote-performance/desk-paths.js';
import { SET_SONGS, songRoute } from '../songs/routes.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = join(root, 'ui/desk-start');
const preview = join(root, 'dist', TANSTACK_STATIC_PATH);
const legacyManifest = JSON.parse(await readFile(join(root, 'dist/ui/practice/offline-manifest.json'), 'utf8'));
if (!/^[a-f0-9]{64}$/.test(legacyManifest.cacheId) || !Array.isArray(legacyManifest.files)) {
  throw new Error('Build the existing Desk assets before building the TanStack preview.');
}

execFileSync(process.execPath, [join(workspace, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: workspace, stdio: 'inherit' });
await rm(preview, { recursive: true, force: true });
await cp(join(workspace, 'dist/client'), preview, { recursive: true });

const browserPath = TANSTACK_DESK_PATH + 'browser/';
const browserManifest = browserPath + 'manifest.webmanifest';
const manifestFile = join(preview, 'browser/manifest.webmanifest');
await mkdir(join(preview, 'browser'), { recursive: true });
const manifest = await readFile(join(root, 'ui/practice/manifest.webmanifest'), 'utf8');
await writeFile(manifestFile, manifest.replace('./icon.svg', '/ui/practice/icon.svg'));

const shellFile = join(preview, '_shell.html');
const shell = await readFile(shellFile, 'utf8');
const rootUpdate = /(i:"__root__#",u:)\d+(,s:"success")/g;
if ([...shell.matchAll(rootUpdate)].length !== 1) throw new Error('Review the TanStack prerendered root before publishing.');
// The static root has no loader data. Normalize its generated freshness timestamp.
await writeFile(shellFile, shell.replace(rootUpdate, (_, prefix, suffix) => prefix + '0' + suffix));

const workerSource = join(workspace, 'src/browser-sw.ts');
const hash = createHash('sha256').update(legacyManifest.cacheId).update(await readFile(workerSource));
const copy = await readdir(preview, { recursive: true, withFileTypes: true });
const builtPaths: string[] = [];
for (const entry of copy.filter(entry => entry.isFile()).sort((left, right) => join(left.parentPath, left.name).localeCompare(join(right.parentPath, right.name)))) {
  const file = join(entry.parentPath, entry.name);
  const path = relative(preview, file);
  hash.update(path).update('\0').update(await readFile(file)).update('\0');
  if (path.startsWith(TANSTACK_ASSET_PATH.slice(1))) builtPaths.push(TANSTACK_DESK_PATH + path);
}

const cacheId = hash.digest('hex');
const paths = [browserPath, browserManifest, ...builtPaths];
await writeFile(join(preview, 'offline-manifest.json'), JSON.stringify({ cacheId, files: paths }) + '\n');
const browserRoutes = [browserPath.slice(0, -1), ...SET_SONGS.map(song => browserPath + songRoute(song.id))];
await build({
  entryPoints: [workerSource],
  outfile: join(preview, 'browser/sw.js'),
  format: 'esm',
  target: 'es2022',
  define: {
    DESK_PREVIEW_BUILD: JSON.stringify(cacheId),
    DESK_PREVIEW_ASSETS: JSON.stringify([
      ...paths.map(path => [path, cacheId]),
      ...legacyManifest.files.filter((path: string) => path !== '/ui/practice/index.html').map((path: string) => [path, legacyManifest.cacheId]),
    ]),
    DESK_PREVIEW_SONG_PATHS: JSON.stringify(browserRoutes),
  },
});
process.stdout.write(`Built TanStack Desk at ${TANSTACK_DESK_PATH}\n`);
