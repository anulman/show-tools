import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'dist/ui/video');
await mkdir(output, { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['ui/video/app.ts'], outdir: output, bundle: true, format: 'esm', target: 'es2022', sourcemap: true });
for (const name of ['index.html', 'style.css']) await cp(resolve(root, 'ui/video', name), resolve(output, name));
await cp(resolve(root, 'ui/video/licenses'), resolve(output, 'licenses'), { recursive: true });
await cp(resolve(root, 'ui/video/wasm'), resolve(output, 'wasm'), { recursive: true });
await mkdir(resolve(root, 'dist/assets'), { recursive: true });
await cp(resolve(root, 'assets/video'), resolve(root, 'dist/assets/video'), { recursive: true });
process.stdout.write('Built the eight-model studio in dist/ui/video/.\n');
