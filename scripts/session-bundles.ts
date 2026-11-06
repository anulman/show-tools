import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function buildSessionBundles(root: string, output: string) {
  const banner = 'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __dirnameOf } from "node:path"; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirnameOf(__filename);';
  for (const [entry, name] of [['scripts/serve-hardware-desk.ts', 'server.mjs'], ['scripts/session-cli.ts', 'session-cli.mjs'], ['scripts/prepare-native.ts', 'prepare.mjs']]) {
    const result = await build({ absWorkingDir: root, entryPoints: [entry], outfile: join(output, 'gateway', name),
      bundle: true, platform: 'node', target: 'node22', format: 'esm', metafile: true, banner: { js: banner } });
    await writeFile(join(output, 'provenance', `${name}.inputs.json`), JSON.stringify(result.metafile.inputs, null, 2));
  }
}
