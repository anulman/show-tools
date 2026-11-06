import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'ui/video/wasm/video-scene.wasm');
await mkdir(resolve(output, '..'), { recursive: true });
const compiler = spawnSync('em++', [
  resolve(root, 'lib/video/src/video_scene.cpp'),
  '-I', resolve(root, 'lib/video/include'), '-std=c++17', '-O2', '--no-entry',
  '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=0',
  '-sINITIAL_MEMORY=2097152', '-sSTACK_SIZE=65536',
  '-sEXPORTED_FUNCTIONS=["_vs_validate","_vs_sample","_malloc","_free"]',
  '-Wl,--strip-all', '-o', output,
], { stdio: 'inherit' });
if (compiler.error) throw compiler.error;
if (compiler.status !== 0) throw new Error(`Street sampler compiler exited ${compiler.status}`);
process.stdout.write('Built ui/video/wasm/video-scene.wasm\n');
