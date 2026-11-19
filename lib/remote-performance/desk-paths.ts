export const HARDWARE_DESK_PATH = '/ui/live/';
export const BROWSER_DESK_PATH = '/ui/browser/';
export const PRACTICE_ASSET_PATH = '/ui/practice/';

export function isDeskEntry(pathname: string, deskPath: string): boolean {
  return pathname === deskPath || pathname === deskPath + 'index.html' || pathname === deskPath.slice(0, -1);
}
