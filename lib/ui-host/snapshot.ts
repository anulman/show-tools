import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, readFile, readdir, rename, rm, lstat, writeFile, realpath } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { decode, BuildInfoSchema, ManifestSchema, SnapshotSchema, type Snapshot } from './model.js';

const execute = promisify(execFile);
export async function git(worktree: string, ...args: string[]) {
  const result = await execute('git', ['-C', worktree, ...args], { maxBuffer: 8 * 1024 * 1024 });
  return result.stdout.trim();
}
export async function sourceInfo(worktree: string) {
  return { revision: await git(worktree, 'rev-parse', 'HEAD'), tree: await git(worktree, 'rev-parse', 'HEAD^{tree}'),
    dirty: Boolean(await git(worktree, 'status', '--porcelain', '--untracked-files=normal', '--', '.', ':!node_modules')) };
}
export async function repository(worktree: string) {
  return realpath(resolve(worktree, await git(worktree, 'rev-parse', '--git-common-dir')));
}
async function walk(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Build contains a symbolic link: ${entry.name}`);
    if (entry.isDirectory()) result.push(...await walk(path));
    else if (entry.isFile()) result.push(path);
    else throw new Error('Build contains a non-file entry');
  }
  return result.sort();
}
async function digestTree(directory: string) {
  const hash = createHash('sha256');
  for (const path of await walk(directory)) hash.update(relative(directory, path).split(sep).join('/')).update('\0').update(await readFile(path)).update('\0');
  return hash.digest('hex');
}
export async function verifyBuild(directory: string) {
  const info = decode(BuildInfoSchema, JSON.parse(await readFile(join(directory, 'build-info.json'), 'utf8')));
  const manifest = decode(ManifestSchema, JSON.parse(await readFile(join(directory, 'ui/practice/offline-manifest.json'), 'utf8')));
  if (new Set(manifest.files).size !== manifest.files.length) throw new Error('Build manifest contains duplicate paths');
  const hash = createHash('sha256');
  for (const path of [...manifest.files].sort()) {
    if (!path.startsWith('/ui/practice/') || path.includes('\\') || path.split('/').includes('..')) throw new Error('Build manifest escapes the practice directory');
    const target = resolve(directory, '.' + path);
    if ((await lstat(target)).isSymbolicLink() || !(await realpath(target)).startsWith(await realpath(directory) + sep)) throw new Error('Build asset escapes its snapshot');
    hash.update(path).update('\0').update(await readFile(target)).update('\0');
  }
  if (hash.digest('hex') !== manifest.cacheId) throw new Error('Build manifest does not match its actual assets');
  const worker = await readFile(join(directory, 'ui/practice/sw.js'), 'utf8');
  if (!worker.includes(manifest.cacheId)) throw new Error('Service worker does not match this build');
  return { info, manifest };
}
export async function importBuild(directory: string, stateRoot: string): Promise<Snapshot> {
  const { info, manifest } = await verifyBuild(directory);
  const snapshots = join(stateRoot, 'snapshots');
  await mkdir(snapshots, { recursive: true, mode: 0o700 });
  const staging = join(snapshots, '.staging-' + randomUUID());
  await mkdir(staging, { mode: 0o700 });
  try {
    await cp(directory, join(staging, 'files'), { recursive: true, dereference: false });
    await verifyBuild(join(staging, 'files'));
    const artifactDigest = await digestTree(join(staging, 'files'));
    const id = createHash('sha256').update(JSON.stringify(info.source)).update('\0').update(artifactDigest).digest('hex');
    const snapshot: Snapshot = { version: 1, id, cacheId: manifest.cacheId, source: info.source, artifactDigest };
    await writeFile(join(staging, 'snapshot.json'), JSON.stringify(snapshot));
    try { await rename(staging, join(snapshots, id)); }
    catch (error) {
      if (!(error instanceof Error && 'code' in error && ['EEXIST', 'ENOTEMPTY'].includes(String(error.code)))) throw error;
      await loadSnapshot(stateRoot, id);
    }
    return snapshot;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
export async function loadSnapshot(stateRoot: string, id: string): Promise<Snapshot> {
  const snapshot = decode(SnapshotSchema, JSON.parse(await readFile(join(stateRoot, 'snapshots', id, 'snapshot.json'), 'utf8')));
  if (snapshot.id !== id || await digestTree(join(stateRoot, 'snapshots', id, 'files')) !== snapshot.artifactDigest) throw new Error('Snapshot identity does not match its files');
  await verifyBuild(join(stateRoot, 'snapshots', id, 'files'));
  return snapshot;
}
