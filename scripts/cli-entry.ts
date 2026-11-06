import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function isCliEntrypoint(moduleUrl: string): Promise<boolean> {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const executable = await realpath(entry).catch((error: unknown) => {
    if (error instanceof Error && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  });
  return executable !== null && executable === await realpath(fileURLToPath(moduleUrl));
}
