import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const SESSION_BUNDLES = {
  'server.mjs': 'scripts/serve-hardware-desk.ts', 'session-cli.mjs': 'scripts/session-cli.ts',
  'prepare.mjs': 'scripts/prepare-native.ts', 'peripheral-cli.mjs': 'scripts/peripheral-cli.ts',
};

export async function writeSessionLaunchers(output: string) {
  for (const [command, entry] of Object.entries({ 'show-tools-session': 'session-cli.mjs', 'show-tools-peripheral': 'peripheral-cli.mjs' }))
    await writeFile(join(output, 'bin', command), `#!/bin/sh\nset -eu\nST_RELEASE=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexec "$ST_RELEASE/runtime/node" "$ST_RELEASE/gateway/${entry}" "$@"\n`, { mode: 0o755 });
}

export async function buildSessionBundles(root: string, output: string) {
  const banner = 'import { createRequire as __createRequire } from "node:module"; import { fileURLToPath as __fileURLToPath } from "node:url"; import { dirname as __dirnameOf } from "node:path"; const require = __createRequire(import.meta.url); const __filename = __fileURLToPath(import.meta.url); const __dirname = __dirnameOf(__filename);';
  for (const [name, entry] of Object.entries(SESSION_BUNDLES)) {
    const result = await build({ absWorkingDir: root, entryPoints: [entry], outfile: join(output, 'gateway', name),
      bundle: true, platform: 'node', target: 'node22', format: 'esm', metafile: true, banner: { js: banner } });
    await writeFile(join(output, 'provenance', `${name}.inputs.json`), JSON.stringify(result.metafile.inputs, null, 2));
  }
}
