import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out-dir' || !args[1]) throw new Error('Usage: node --import tsx scripts/build-voice-effects-check.ts --out-dir NEW_DIRECTORY');
const output = resolve(args[1]);
await mkdir(output);
await build({ absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
  entryPoints: ['ui/practice/tests/voice-effects.browser.ts'], outfile: resolve(output, 'check.js'),
  bundle: true, format: 'esm', target: 'es2022' });
await writeFile(resolve(output, 'index.html'), `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FX rows verification</title><link rel="stylesheet" href="/ui/practice/style.css"><style>body{padding:20px}#test-results{font:12px/1.5 monospace;white-space:pre-wrap}iframe{display:block;width:390px;height:1100px;border:1px solid #aaa;background:white}</style><iframe title="390px Performance Desk" src="/ui/practice/?fx-row-check"></iframe><script type="module" src="./check.js"></script></html>\n`, { flag: 'wx' });
process.stdout.write(`Open the served ${output}/index.html after building the Performance Desk.\n`);
