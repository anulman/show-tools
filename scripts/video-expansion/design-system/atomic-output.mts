import { link, lstat, mkdtemp, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

export class OutputConflict extends Error {
  constructor(readonly outputPath: string, readonly reason: 'busy' | 'different' | 'unsafe-name') {
    super(reason === 'busy' ? 'Another publication holds the output lock' : reason === 'different' ? 'The destination already contains different output' : 'Output names must be plain file names');
  }
}

async function existing(path: string) {
  return lstat(path).catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  });
}

async function identicalFile(path: string, contents: string) {
  const info = await existing(path);
  return !!info?.isFile() && !info.isSymbolicLink() && (await readFile(path)).equals(Buffer.from(contents));
}

async function targetPath(path: string) {
  const absolute = resolve(path);
  return join(await realpath(dirname(absolute)), basename(absolute));
}

export async function publishDirectory(path: string, files: ReadonlyMap<string, string>) {
  const target = await targetPath(path);
  for (const name of files.keys()) if (basename(name) !== name || name === '.' || name === '..') throw new OutputConflict(target, 'unsafe-name');
  const lockPath = join(dirname(target), `.${basename(target)}.figma-publish.lock`);
  const lock = await open(lockPath, 'wx').catch(error => {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') throw new OutputConflict(target, 'busy');
    throw error;
  });
  let staging: string | undefined;
  try {
    const prior = await existing(target);
    if (prior) {
      const names = prior.isDirectory() && !prior.isSymbolicLink() ? await readdir(target) : [];
      if (names.length !== files.size || names.some(name => !files.has(name))) throw new OutputConflict(target, 'different');
      for (const [name, contents] of files) if (!await identicalFile(join(target, name), contents)) throw new OutputConflict(target, 'different');
      return;
    }
    staging = await mkdtemp(join(dirname(target), '.figma-read-stage-'));
    const ordered = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    for (const [name, contents] of ordered) await writeFile(join(staging, name), contents, { flag: 'wx' });
    if (await existing(target)) throw new OutputConflict(target, 'different');
    await rename(staging, target);
    staging = undefined;
  } finally {
    try { if (staging) await rm(staging, { recursive: true, force: true }); }
    finally { await lock.close(); await unlink(lockPath); }
  }
}

export async function publishReport(path: string, contents: string) {
  const target = await targetPath(path);
  if (await existing(target)) {
    if (await identicalFile(target, contents)) return;
    throw new OutputConflict(target, 'different');
  }
  const staging = await mkdtemp(join(dirname(target), '.figma-report-stage-'));
  try {
    const stagedFile = join(staging, 'report.json');
    await writeFile(stagedFile, contents, { flag: 'wx' });
    await link(stagedFile, target).catch(async error => {
      if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
        if (await identicalFile(target, contents)) return;
        throw new OutputConflict(target, 'different');
      }
      throw error;
    });
  } finally { await rm(staging, { recursive: true, force: true }); }
}
