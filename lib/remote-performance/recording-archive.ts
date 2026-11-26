import { constants } from 'node:fs';
import { lstat, open, opendir, realpath } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { decodeRecordingId, MAX_DEMO_BYTES, RECORDING_ARCHIVE_BATCH, type ArchivedRecording } from './recording-archive-schema.js';
import type { SessionProfile } from './session-profile.js';

function absent(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

async function canonical(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if (!absent(error)) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonical(parent), basename(path));
  }
}

function overlaps(a: string, b: string) {
  return a === sep || b === sep || a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}

export async function validateRecordingArchive(profile: SessionProfile, staticRoot: string) {
  const path = profile.recordingArchiveRoot;
  if (!path) return;
  const archive = await realpath(path);
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077))
    throw new Error('Recording archive must be an existing caller-owned private directory');
  const otherRoots = [
    staticRoot, await canonical(resolve(profile.runtimeRoot)),
    await canonical(resolve(profile.authoringDatabase)), await canonical(resolve(profile.authoringDatabase + '.charts')),
  ];
  if (otherRoots.some(root => overlaps(root, archive)))
    throw new Error('Recording archive must be separate from served files, runtime files, and authoring data');
  return archive;
}

export async function openDemoFile(path: string) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => {
    if (absent(error)) return null;
    throw error;
  });
  if (!file) return null;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077)
      || info.size <= 44 || info.size > MAX_DEMO_BYTES) throw new Error('Invalid demo file');
    return { file, bytes: info.size, completedAt: info.mtimeMs };
  } catch (error) {
    await file.close();
    throw error;
  }
}

type Entry = ArchivedRecording & { completedAt: number };

export class RecordingArchive {
  constructor(private readonly root: string) {}

  async open(id: string) {
    const directory = await this.takeDirectory(id);
    return directory ? openDemoFile(join(directory, 'recording.wav')) : null;
  }

  async acknowledge(id: string) {
    const directory = await this.takeDirectory(id);
    if (!directory) return false;
    const demo = await openDemoFile(join(directory, 'recording.wav'));
    if (!demo) return false;
    await demo.file.close();
    const receipt = await open(join(directory, 'saved'), constants.O_WRONLY | constants.O_CREAT
      | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const info = await receipt.stat();
      if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid?.() || (info.mode & 0o077) || info.size)
        throw new Error('Invalid recording receipt');
      await receipt.sync();
    } finally { await receipt.close(); }
    const directoryHandle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try { await directoryHandle.sync(); }
    finally { await directoryHandle.close(); }
    return true;
  }

  async pending(): Promise<{ pending: ArchivedRecording[] }> {
    const entries: Entry[] = [];
    for await (const entry of this.entries(true)) {
      entries.push(entry);
      entries.sort((a, b) => a.completedAt - b.completedAt || a.id.localeCompare(b.id));
      if (entries.length > RECORDING_ARCHIVE_BATCH) entries.pop();
    }
    return { pending: entries.map(({ id, bytes }) => ({ id, bytes })) };
  }

  async latest() {
    let latest: Entry | undefined;
    for await (const entry of this.entries(false)) {
      if (!latest || entry.completedAt > latest.completedAt || (entry.completedAt === latest.completedAt && entry.id > latest.id))
        latest = entry;
    }
    return latest ? this.open(latest.id) : null;
  }

  private async takeDirectory(input: string) {
    const id = decodeRecordingId(input);
    const take = join(this.root, id);
    const info = await lstat(take).catch(error => {
      if (absent(error)) return null;
      throw error;
    });
    if (!info) return null;
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077))
      throw new Error('Invalid recording directory');
    return take;
  }

  private async *entries(pendingOnly: boolean) {
    const directory = await opendir(this.root);
    for await (const child of directory) {
      if (!child.isDirectory() || !/^take-[A-Za-z0-9]{6}$/.test(child.name)) continue;
      const take = await this.takeDirectory(child.name);
      if (!take) continue;
      if (pendingOnly) {
        const saved = await lstat(join(take, 'saved')).catch(error => {
          if (absent(error)) return null;
          throw error;
        });
        if (saved) {
          if (!saved.isFile() || saved.nlink !== 1 || saved.uid !== process.getuid?.() || (saved.mode & 0o077) || saved.size)
            throw new Error('Invalid recording receipt');
          continue;
        }
      }
      const file = await openDemoFile(join(take, 'recording.wav'));
      if (!file) continue;
      await file.file.close();
      yield { id: child.name, bytes: file.bytes, completedAt: file.completedAt };
    }
  }
}
