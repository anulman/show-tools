import type { ArchivedRecording } from '../../lib/remote-performance/recording-archive-schema.js';
import type { RemoteDesk } from './remote-session.js';

type Folder = { handle: FileSystemDirectoryHandle; id: string };
type FolderWindow = Window & { showDirectoryPicker(options: { mode: 'readwrite' }): Promise<FileSystemDirectoryHandle> };
const marker = '.show-tools-take-folder';
const readWrite = { mode: 'readwrite' };
const missing = (error: unknown) => error instanceof DOMException && error.name === 'NotFoundError';

function supportsPicker(window: Window): window is FolderWindow {
  return 'showDirectoryPicker' in window && typeof window.showDirectoryPicker === 'function';
}

function isFolder(value: unknown): value is Folder {
  return typeof value === 'object' && value !== null && 'handle' in value
    && value.handle instanceof FileSystemDirectoryHandle && 'id' in value && typeof value.id === 'string';
}

function openPreferences() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('show-tools-take-archive', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('preferences');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function preference<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction('preferences', mode);
    const request = action(transaction.objectStore('preferences'));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getFile(folder: FileSystemDirectoryHandle, name: string) {
  try { return await folder.getFileHandle(name); }
  catch (error) {
    if (!missing(error)) throw error;
    return null;
  }
}

async function folderMarker(file: FileSystemFileHandle) {
  const content = await file.getFile();
  return content.size === 36 ? content.text() : '';
}

async function writeFile(file: FileSystemFileHandle, data: Blob | string) {
  const writable = await file.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

async function sameBytes(left: Blob, right: Blob) {
  if (left.size !== right.size) return false;
  const chunk = 256 * 1024;
  for (let offset = 0; offset < left.size; offset += chunk) {
    const [a, b] = await Promise.all([
      left.slice(offset, offset + chunk).arrayBuffer(), right.slice(offset, offset + chunk).arrayBuffer(),
    ]);
    const bytes = new Uint8Array(b);
    if (new Uint8Array(a).some((value, index) => value !== bytes[index])) return false;
  }
  return true;
}

class ArchiveProblem extends Error {}
class TakeProblem extends Error {}

async function checkFolder(folder: Folder) {
  const file = await getFile(folder.handle, marker);
  if (!file || await folderMarker(file) !== folder.id)
    throw new ArchiveProblem('Waiting for the selected drive.');
}

function filename(id: string) {
  // Encoding the native ID preserves its case on case-insensitive Mac volumes.
  const stable = Array.from(id.slice(5), char => char.charCodeAt(0).toString(16)).join('');
  return 'practice-take-' + stable + '.wav';
}

async function saveRecording(db: IDBDatabase, folder: Folder, desk: RemoteDesk, recording: ArchivedRecording) {
  const wav = await desk.readRecording(recording);
  await checkFolder(folder);
  const name = filename(recording.id);
  const claim = 'writing:' + folder.id + ':' + name;
  let handle = await getFile(folder.handle, name);
  const previous = await handle?.getFile();
  const wasCreatedByArchive = await preference(db, 'readonly', store => store.getKey(claim)) !== undefined;
  if (previous && await sameBytes(previous, wav)) {
    await desk.acknowledgeRecording(recording);
    await preference(db, 'readwrite', store => store.delete(claim));
    return name;
  }
  if (previous && (previous.size !== 0 || !wasCreatedByArchive))
    throw new TakeProblem('A different file already exists: ' + name + '.');
  await preference(db, 'readwrite', store => store.put(true, claim));
  if (!handle) {
    handle = await folder.handle.getFileHandle(name, { create: true });
    if ((await handle.getFile()).size !== 0) throw new TakeProblem('A different file already exists: ' + name + '.');
  }
  await writeFile(handle, wav);
  await checkFolder(folder);
  if (!await sameBytes(await handle.getFile(), wav)) throw new TakeProblem('Could not verify ' + name + '.');
  await desk.acknowledgeRecording(recording);
  await preference(db, 'readwrite', store => store.delete(claim));
  return name;
}

async function permission(handle: FileSystemDirectoryHandle, action: 'queryPermission' | 'requestPermission') {
  if (action in handle) {
    const method: unknown = Reflect.get(handle, action);
    if (typeof method === 'function') {
      const result: unknown = await Reflect.apply(method, handle, [readWrite]);
      if (result === 'granted' || result === 'prompt') return result;
    }
  }
  return 'denied';
}

export function enableTakeArchive(options: {
  choose: HTMLButtonElement; access: HTMLButtonElement; disable: HTMLButtonElement;
  status: HTMLElement; progress: HTMLElement; signal: AbortSignal;
  desk: () => RemoteDesk | undefined;
}) {
  const { choose, access, disable, status, progress, signal, desk } = options;
  if (!supportsPicker(window) || !navigator.locks || typeof FileSystemDirectoryHandle === 'undefined') {
    choose.disabled = true;
    status.textContent = 'Automatic saving requires a browser with writable folder access.';
    return;
  }
  const picker = window;
  const preferences = openPreferences();
  let folder: Folder | undefined;
  let busy = false;
  let lastSaved = '';
  let cursor: string | undefined;
  let issueThisPass = '';
  let issueLastPass = '';
  let lastDesk: RemoteDesk | undefined;
  function resetScan() {
    cursor = undefined;
    issueThisPass = issueLastPass = '';
  }
  function show(text: string, permissionNeeded = false) {
    if (signal.aborted) return;
    if (status.textContent !== text) status.textContent = text;
    if (progress.textContent !== text) progress.textContent = text;
    progress.hidden = !folder;
    choose.disabled = busy;
    disable.disabled = !folder || busy;
    access.hidden = !permissionNeeded;
    access.disabled = busy;
  }

  function report(error: unknown) {
    show(error instanceof ArchiveProblem ? error.message : missing(error)
      ? 'Waiting for the selected drive.'
      : 'Automatic save pending. Check the drive and connection.');
  }

  async function refresh() {
    if (signal.aborted || busy) return;
    busy = true;
    let message = '';
    let permissionNeeded = false;
    try {
      await navigator.locks.request('show-tools-take-archive', { signal }, async () => {
        const db = await preferences;
        const value = await preference<unknown>(db, 'readonly', store => store.get('folder'));
        const selected = isFolder(value) ? value : undefined;
        if (folder?.id !== selected?.id) {
          lastSaved = '';
          resetScan();
        }
        folder = selected;
        if (!selected) {
          message = 'Automatic saving is off.';
          return;
        }
        const remote = desk();
        if (lastDesk !== remote) {
          lastDesk = remote;
          resetScan();
        }
        if (!remote || remote.connection.kind !== 'connected') {
          message = 'Waiting for the hardware desk.';
          return;
        }
        if (await permission(selected.handle, 'queryPermission') !== 'granted') {
          permissionNeeded = true;
          message = 'Folder access needed for ' + selected.handle.name + '.';
          return;
        }
        await checkFolder(selected);
        const page = await remote.pendingRecordings(cursor);
        if (!page) {
          message = 'Automatic saving is not configured on the EliteDesk.';
          return;
        }
        for (const recording of page.pending) {
          signal.throwIfAborted();
          if (!('bytes' in recording)) {
            issueThisPass ||= 'Could not read ' + filename(recording.id) + ' on the EliteDesk. Take remains queued.';
            continue;
          }
          show('Saving takes to ' + selected.handle.name + '…');
          try { lastSaved = await saveRecording(db, selected, remote, recording); }
          catch (error) {
            signal.throwIfAborted();
            if (error instanceof ArchiveProblem || remote.connection.kind !== 'connected') throw error;
            if (await permission(selected.handle, 'queryPermission') !== 'granted') {
              permissionNeeded = true;
              message = 'Folder access needed for ' + selected.handle.name + '.';
              return;
            }
            await checkFolder(selected);
            const failure = error instanceof TakeProblem ? error.message : 'Could not save ' + filename(recording.id) + '.';
            issueThisPass ||= failure + ' Take remains queued.';
          }
        }
        cursor = page.next;
        if (!cursor) {
          issueLastPass = issueThisPass;
          issueThisPass = '';
        }
        const issue = issueThisPass || issueLastPass;
        const saved = lastSaved ? 'Saved to ' + selected.handle.name + ': ' + lastSaved : '';
        message = [issue, saved].filter(Boolean).join(' ') || 'Ready to save to ' + selected.handle.name + '.';
      });
    } catch (error) {
      busy = false;
      report(error);
      return;
    }
    busy = false;
    show(message, permissionNeeded);
  }

  async function changeFolder() {
    if (busy) return;
    busy = true;
    try {
      const handle = await picker.showDirectoryPicker({ mode: 'readwrite' });
      const selected = await navigator.locks.request('show-tools-take-archive', { signal }, async () => {
        const known = await getFile(handle, marker);
        const id = known ? await folderMarker(known) : crypto.randomUUID();
        if (!/^[a-f0-9-]{36}$/.test(id)) throw new ArchiveProblem('The folder contains an invalid recording destination marker.');
        if (!known) await writeFile(await handle.getFileHandle(marker, { create: true }), id);
        const value = { handle, id };
        await preference(await preferences, 'readwrite', store => store.put(value, 'folder'));
        return value;
      });
      folder = selected;
      lastSaved = '';
      resetScan();
    } catch (error) {
      busy = false;
      if (error instanceof DOMException && error.name === 'AbortError') return;
      report(error);
      return;
    }
    busy = false;
    await refresh();
  }

  choose.addEventListener('click', () => { void changeFolder(); }, { signal });
  access.addEventListener('click', () => {
    if (busy || !folder) return;
    void permission(folder.handle, 'requestPermission').then(refresh, report);
  }, { signal });
  disable.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    void navigator.locks.request('show-tools-take-archive', { signal }, async () => {
      await preference(await preferences, 'readwrite', store => store.delete('folder'));
    }).then(() => {
      busy = false;
      folder = undefined;
      lastSaved = '';
      resetScan();
      show('Automatic saving is off.');
    }, error => { busy = false; report(error); });
  }, { signal });
  void refresh();
  const timer = window.setInterval(() => { void refresh(); }, 3000);
  window.addEventListener('online', () => { void refresh(); }, { signal });
  signal.addEventListener('abort', () => {
    window.clearInterval(timer);
    void preferences.then(db => db.close(), () => {});
  }, { once: true });
}
