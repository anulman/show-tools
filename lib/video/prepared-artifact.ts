import { lstat, mkdtemp, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export async function publishPreparedArtifact({ output, inputs, artifact }: {
  output: string; inputs: readonly string[]; artifact: unknown;
}): Promise<void> {
  const target = resolve(output);
  const parent = await realpath(dirname(target));
  const canonicalTarget = join(parent, basename(target));
  const existing = await lstat(target).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
  const resolvedTarget = existing ? await realpath(target) : canonicalTarget;
  const targetStat = existing ? await stat(target) : null;
  for (const input of inputs) {
    const [resolvedInput, inputStat] = await Promise.all([realpath(input), stat(input)]);
    if (resolvedInput === resolvedTarget || (targetStat && inputStat.dev === targetStat.dev && inputStat.ino === targetStat.ino)) {
      throw new Error(`Prepared output aliases an input: ${input}`);
    }
  }
  if (existing && !existing.isFile()) throw new Error('Prepared output must be a regular file');
  const contents = `${JSON.stringify(artifact, null, 2)}\n`;
  const staging = await mkdtemp(join(parent, '.prepared-scene-'));
  try {
    const staged = join(staging, 'scene.json');
    await writeFile(staged, contents, { mode: 0o600, flag: 'wx' });
    await rename(staged, canonicalTarget);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
