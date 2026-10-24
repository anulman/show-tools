import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function files(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name.startsWith('build') || ['deps', 'dist', 'wasm', 'evidence', 'node_modules'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else result.push(path);
  }
  return result;
}

const sources = [...await files(resolve(root, 'ui')), ...await files(resolve(root, 'lib'))];
const failures = [];
for (const path of sources) {
  if (path.endsWith('.html') && relative(root, path).startsWith('lib/')) failures.push(`${relative(root, path)} is a UI page under lib/`);
  if (!/\.(?:m?js|ts|html)$/.test(path) || path.endsWith('.d.ts')) continue;
  const content = await readFile(path, 'utf8');
  const references = path.endsWith('.html')
    ? [...content.matchAll(/(?:src|href)=["'](\.\.?\/[^"']+)["']/g)].map(match => match[1])
    : [...content.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|new URL\(\s*)["'](\.\.?\/[^"']+)["']/g)].map(match => match[1]);
  for (const reference of references) {
    const target = resolve(dirname(path), reference.split(/[?#]/)[0]);
    try { await access(target); }
    catch {
      try { await access(target.replace(/\.js$/, '.ts')); }
      catch { failures.push(`${relative(root, path)} references missing ${reference}`); }
    }
  }
}
const workerPath = resolve(root, 'ui/practice/sw.ts');
const worker = await readFile(workerPath, 'utf8');
const cacheBlock = worker.match(/const FILES = \[([\s\S]*?)\];/)?.[1];
assert(cacheBlock, 'Offline cache declares its static files');
for (const [, reference] of cacheBlock.matchAll(/'([^']+)'/g)) {
  try { await access(resolve(dirname(workerPath), reference)); }
  catch { failures.push(`Offline cache references missing ${reference}`); }
}
assert.equal(failures.length, 0, failures.join('\n'));
console.log('UI pages live under ui/. Relative module, asset, and offline cache references resolve.');
