export type AudioMode = 'browser' | 'hardware';

export function audioMode(url: URL): AudioMode {
  return url.searchParams.has('remote') ? 'hardware' : 'browser';
}

export function audioModeURL(url: URL, mode: AudioMode): URL {
  const next = new URL(url);
  if (mode === 'hardware') next.searchParams.set('remote', '');
  else next.searchParams.delete('remote');
  return next;
}

export function canChangeAudioMode(mode: AudioMode, browserBusy: boolean): boolean {
  return mode === 'hardware' || !browserBusy;
}

export async function changeAudioMode(options: {
  current: AudioMode;
  next: AudioMode;
  browserBusy: boolean;
  url: URL;
  dispose: () => Promise<void>;
  navigate: (url: URL) => void;
}): Promise<boolean> {
  if (options.current === options.next || !canChangeAudioMode(options.current, options.browserBusy)) return false;
  await options.dispose();
  options.navigate(audioModeURL(options.url, options.next));
  return true;
}
