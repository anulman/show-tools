import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options:{ 'out-dir':{ type:'string', default:'dist' } } });
const output = resolve(values['out-dir']);
const manifestPath = resolve(root, 'assets/video/tuner/manifest.json');
const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
if (typeof manifest !== 'object' || manifest === null || !('sha256' in manifest)
  || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)
  || !('width' in manifest) || manifest.width !== 70 || !('height' in manifest) || manifest.height !== 70) {
  throw new Error('Expected the approved 70×70 native disco-ball contract');
}
const ballPath = resolve(root, 'assets/video/tuner/disco-ball.png');
const bytes = await readFile(ballPath);
if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new Error('Approved ball hash changed');
const metadata = await sharp(bytes).metadata();
if (metadata.width !== manifest.width || metadata.height !== manifest.height) throw new Error('Approved ball native dimensions changed');
const pixels = await sharp(bytes).ensureAlpha().raw().toBuffer();
for (const [x, y] of [[0,0],[69,0],[0,69],[69,69]]) {
  if (pixels[(y * 70 + x) * 4 + 3] !== 0) throw new Error('Ball export must preserve transparent corners, without a frame fill');
}
await mkdir(resolve(output, 'tuner-scene'), { recursive:true });
await mkdir(resolve(output, 'ui/tuner/assets'), { recursive:true });
await build({ absWorkingDir:root, entryPoints:['ui/tuner/review/fixture.ts'], outfile:resolve(output,'tuner-scene/fixture.js'), bundle:true, format:'esm', target:'es2022' });
await copyFile(resolve(root,'ui/tuner/review/index.html'),resolve(output,'tuner-scene/index.html'));
await copyFile(ballPath,resolve(output,'ui/tuner/assets/disco-ball.png'));
await writeFile(resolve(output,'ui/tuner/assets/manifest.json'),JSON.stringify(manifest,null,2)+'\n');
process.stdout.write(`Built synthetic presentation fixture in ${output}/tuner-scene/. No audio startup.\n`);
