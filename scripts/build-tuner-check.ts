import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(new URL('../dist/tuner-check/', import.meta.url), { recursive: true });
await build({ absWorkingDir: root, entryPoints: ['ui/practice/tests/tuner.browser.ts'], outfile: 'dist/tuner-check/check.js', bundle: true, format: 'esm', target: 'es2022' });
const html = await readFile(new URL('../dist/ui/practice/index.html', import.meta.url), 'utf8');
await writeFile(new URL('../dist/tuner-check/index.html', import.meta.url), html
  .replace('<head>', '<head><base href="../ui/practice/"><script type="module" src="../../tuner-check/check.js"></script>'));
process.stdout.write('Open /tuner-check/index.html?test=1 and run the checks. The fixture supplies synthetic microphone input.\n');
