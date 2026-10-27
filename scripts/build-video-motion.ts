import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, 'ui/video/wasm/video-pose.wasm');
await mkdir(resolve(output, '..'), { recursive: true });
const compiler = spawnSync('em++', [
  resolve(root, 'lib/video/src/video_pose.cpp'),
  '-I', resolve(root, 'lib/video/include'),
  '-std=c++17', '-O2', '--no-entry',
  '-sSTANDALONE_WASM=1', '-sFILESYSTEM=0', '-sALLOW_MEMORY_GROWTH=0',
  '-sINITIAL_MEMORY=131072', '-sSTACK_SIZE=65536',
  '-sEXPORTED_FUNCTIONS=["_vp_pose","_vp_sway","_vp_breath"]',
  '-Wl,--strip-all', '-o', output,
], { stdio: 'inherit' });
if (compiler.error) throw compiler.error;
if (compiler.status !== 0) throw new Error(`Video pose compiler exited ${compiler.status}`);
process.stdout.write('Built ui/video/wasm/video-pose.wasm\n');
