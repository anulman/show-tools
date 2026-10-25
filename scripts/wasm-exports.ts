import { readFile } from 'node:fs/promises';

const headers = process.argv.slice(2);
if (!headers.length) throw new Error('Pass the C API headers to export.');
const names = new Set(['_malloc', '_free']);
for (const header of headers) {
  const source = (await readFile(header, 'utf8')).replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
  const declarations = [...source.matchAll(/\b((?:bt|st|sq|pf)_[a-z][a-z0-9_]*)\s*\([^;{}]*\)\s*;/g)];
  if (!declarations.length) throw new Error(`No C API declarations found in ${header}`);
  for (const declaration of declarations) names.add(`_${declaration[1]}`);
}
process.stdout.write(JSON.stringify([...names]));
