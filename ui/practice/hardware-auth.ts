type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export class HardwareKeyRejectedError extends Error {
  constructor() { super('The hardware session key was rejected. Enter a new key.'); }
}

function browserStorage(): KeyStorage | undefined {
  try { return localStorage; } catch { return undefined; }
}
function validKey(value: string | null): value is string {
  return value !== null && /^[\x21-\x7e]{1,4096}$/.test(value);
}

export function createHardwareAuth(options: { endpoint: string; storage?: KeyStorage }) {
  const endpoint = new URL(options.endpoint);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
    throw new Error('Hardware authentication requires a plain HTTP(S) endpoint');
  const storageKey = `show-tools-hardware-key:${endpoint.origin}${endpoint.pathname}`;
  const storage = options.storage ?? browserStorage();
  let memoryKey: string | undefined;
  let ignoreStored = false;
  function storedKey() {
    if (ignoreStored) return undefined;
    try {
      const value = storage?.getItem(storageKey) ?? null;
      return validKey(value) ? value : undefined;
    } catch { return undefined; }
  }
  function forget() {
    memoryKey = undefined; ignoreStored = true;
    try { storage?.removeItem(storageKey); return storage !== undefined; }
    catch { return false; }
  }
  return {
    forget,
    hasKey: () => Boolean(memoryKey ?? storedKey()),
    remembered: () => storedKey() !== undefined,
    async connect<T>(connect: (key: string) => Promise<T>, prompt: (reason: 'missing' | 'rejected') => string | null): Promise<T> {
      const cached = memoryKey ?? storedKey();
      if (cached) {
        try { const result = await connect(cached); memoryKey = cached; return result; }
        catch (error) {
          if (!(error instanceof HardwareKeyRejectedError)) throw error;
          forget();
        }
      }
      const entered = prompt(cached ? 'rejected' : 'missing')?.trim() ?? null;
      if (!validKey(entered)) throw new Error('A hardware session key is required to connect.');
      const result = await connect(entered);
      memoryKey = entered;
      try {
        storage?.setItem(storageKey, entered);
        ignoreStored = storage === undefined;
      } catch { ignoreStored = true; }
      return result;
    },
  };
}
