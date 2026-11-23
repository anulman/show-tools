import { createHash, randomUUID } from 'node:crypto';
import { constants, lstatSync, mkdirSync } from 'node:fs';
import { open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_CHART_BYTES = 4 * 1024 * 1024;

export interface PublishedChart {
  readonly songId: string;
  readonly musicXml: string;
  readonly chartVersion: string;
}

export type ChartSource = PublishedChart & { readonly overridden: boolean };

export function chartSource(songId: string, musicXml: string, overridden: boolean): ChartSource {
  return { songId, musicXml, overridden, chartVersion: createHash('sha256').update(musicXml).digest('hex') };
}

export class ChartOverrides {
  constructor(private readonly directory: string) {
    mkdirSync(directory, { mode: 0o700, recursive: true });
    const info = lstatSync(directory);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
      throw new Error('Chart directory must be caller-owned and private');
  }

  private path(id: string) {
    return join(this.directory, createHash('sha256').update(id).digest('hex') + '.musicxml');
  }

  async read(id: string): Promise<string | undefined> {
    const file = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error: unknown) => {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (!file) return undefined;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || info.size > MAX_CHART_BYTES)
        throw new Error('Saved chart must be a bounded caller-owned private file');
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length !== info.size) throw new Error('Saved chart changed while reading');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, length));
    } finally { await file.close(); }
  }

  async save(id: string, musicXml: string): Promise<void> {
    if (Buffer.byteLength(musicXml) > MAX_CHART_BYTES) throw new Error('MusicXML exceeds the 4 MiB chart limit');
    const path = join(this.directory, `.upload-${randomUUID()}`);
    const file = await open(path, 'wx', 0o600);
    try {
      try { await file.writeFile(musicXml); await file.sync(); }
      finally { await file.close(); }
      await rename(path, this.path(id));
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }
}
