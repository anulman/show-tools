import { constants } from 'node:fs';
import { lstat, open, realpath, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export class PeripheralMaintenanceBusy extends Error {}

export async function peripheralConfigurationDirectory(path: string) {
  if (resolve(path) !== path) throw new Error('Peripheral profile path must be canonical and absolute.');
  const parent = dirname(path);
  if (await realpath(parent) !== parent) throw new Error('Peripheral configuration directory must be canonical.');
  const info = await lstat(parent);
  if (!info.isDirectory() || (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid()))
    throw new Error('Peripheral configuration directory must be caller-owned and not writable by other users.');
  return parent;
}

export async function withPeripheralMaintenance<T>(path: string, operation: () => Promise<T>): Promise<T> {
  await peripheralConfigurationDirectory(path);
  const name = path + '.commissioning.lock';
  let lock: Awaited<ReturnType<typeof open>>;
  try { lock = await open(name, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new PeripheralMaintenanceBusy(`Commissioning is already active or left a lock at ${name}. Close the other setup terminal; inspect a leftover lock before removing it.`);
    throw error;
  }
  const identity = await lock.stat();
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid }) + '\n');
    return await operation();
  } finally {
    await lock.close();
    const current = await lstat(name);
    if (current.dev !== identity.dev || current.ino !== identity.ino) throw new Error('Commissioning lock changed; refusing to remove it.');
    await unlink(name);
  }
}
