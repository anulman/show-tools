export type AudioMode = 'browser' | 'hardware';

export function audioMode(url: URL, fallback: AudioMode = 'browser'): AudioMode {
  if (url.searchParams.has('remote')) return 'hardware';
  if (url.searchParams.has('browser')) return 'browser';
  return fallback;
}

export async function defaultAudioMode(url: URL): Promise<AudioMode> {
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
  if (mode === 'hardware') next.searchParams.set('remote', '');
  else if (fallback === 'hardware') next.searchParams.set('browser', '');
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
