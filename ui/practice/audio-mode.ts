import { BROWSER_DESK_PATH, HARDWARE_DESK_PATH, isDeskEntry } from '../../lib/remote-performance/desk-paths.js';

export type AudioMode = 'browser' | 'hardware';

export function audioMode(url: URL, fallback: AudioMode = 'browser'): AudioMode {
  if (url.searchParams.has('remote')) return 'hardware';
  if (url.searchParams.has('browser') || isDeskEntry(url.pathname, BROWSER_DESK_PATH)) return 'browser';
  return fallback;
}

export async function defaultAudioMode(url: URL): Promise<AudioMode> {
  if (isDeskEntry(url.pathname, HARDWARE_DESK_PATH) || isDeskEntry(url.pathname, BROWSER_DESK_PATH)) return 'hardware';
  try {
    const response = await fetch(new URL('/api/desk-mode', url), { cache: 'no-store', signal: AbortSignal.timeout(1800) });
    if (response.ok && await response.text() === 'hardware') return 'hardware';
  } catch { /* Static and offline hosts use local audio. */ }
  return 'browser';
}

export function audioModeURL(url: URL, mode: AudioMode, fallback: AudioMode = 'browser'): URL {
  const next = new URL(url);
  next.searchParams.delete('remote');
  next.searchParams.delete('browser');
  if (fallback === 'hardware') {
    next.pathname = mode === 'hardware' ? HARDWARE_DESK_PATH : BROWSER_DESK_PATH;
  } else if (mode === 'hardware') next.searchParams.set('remote', '');
  return next;
}

export function canChangeAudioMode(mode: AudioMode, browserBusy: boolean): boolean {
  return mode === 'hardware' || !browserBusy;
}

export async function changeAudioMode(options: {
  current: AudioMode;
  next: AudioMode;
  browserBusy: boolean;
  fallback?: AudioMode;
  url: URL;
  dispose: () => Promise<void>;
  navigate: (url: URL) => void;
}): Promise<boolean> {
  if (options.current === options.next || !canChangeAudioMode(options.current, options.browserBusy)) return false;
  await options.dispose();
  options.navigate(audioModeURL(options.url, options.next, options.fallback));
  return true;
}
