import { readFile } from 'node:fs/promises';
import { transformSync } from 'esbuild';

export async function sourceForVM(url: URL): Promise<string> {
  const source = await readFile(url, 'utf8');
  return url.pathname.endsWith('.ts') ? transformSync(source, { loader: 'ts', target: 'es2022' }).code : source;
}
