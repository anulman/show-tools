import assert from 'node:assert/strict';
import characters from '../assets/video/characters.json';
import { createHash } from 'node:crypto';
import { Schema } from 'effect';
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
const output = resolve(root, 'dist');
const manifest = Schema.decodeUnknownSync(Schema.Struct({
  cacheId: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)), files: Schema.Array(Schema.String),
}))(JSON.parse(await readFile(resolve(output, 'ui/practice/offline-manifest.json'), 'utf8')));
assert(manifest.files.includes('/ui/practice/wasm/manual-clock.wasm'), 'Offline build includes its WASM');
assert(manifest.files.includes('/ui/practice/app.js') && manifest.files.includes('/ui/practice/practice-worklet.js'), 'Offline build includes its matching JavaScript');
for (const character of characters.characters) {
  const path = '/ui/practice/' + character.publishedAvatarPath;
  assert(manifest.files.includes(path), `${character.id}: avatar is available offline`);
  assert.deepEqual(await readFile(resolve(output, '.' + path)), await readFile(resolve(root, character.publishedAvatarPath)), `${character.id}: the build preserves the published avatar bytes`);
}
const offlineHash = createHash('sha256');
for (const reference of manifest.files) {
  const path = resolve(output, '.' + reference);
  assert(reference.startsWith('/ui/practice/') && !relative(output, path).startsWith('..'), 'Offline assets stay inside the build');
  try { offlineHash.update(reference).update('\0').update(await readFile(path)).update('\0'); }
  catch { failures.push(`Offline cache references missing ${reference}`); }
}
assert.equal(offlineHash.digest('hex'), manifest.cacheId, 'Offline cache identity matches the actual JavaScript, WASM, and entry assets');
assert((await readFile(resolve(output, 'ui/practice/sw.js'), 'utf8')).includes(manifest.cacheId), 'Service worker uses this complete build identity');
assert.equal(failures.length, 0, failures.join('\n'));
console.log('UI pages live under ui/. Relative module, asset, and offline cache references resolve.');
