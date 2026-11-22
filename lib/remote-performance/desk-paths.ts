export const HARDWARE_DESK_PATH = '/ui/live/';
export const BROWSER_DESK_PATH = '/ui/browser/';
export const PRACTICE_ASSET_PATH = '/ui/practice/';
export const TANSTACK_DESK_PATH = '/preview/tanstack/';

export function practiceAssetBase(pageUrl: string | URL): URL {
  const page = new URL(pageUrl);
  return page.pathname === TANSTACK_DESK_PATH.slice(0, -1) || page.pathname.startsWith(TANSTACK_DESK_PATH)
    ? new URL(PRACTICE_ASSET_PATH, page)
    : page;
}

export function isDeskEntry(pathname: string, deskPath: string): boolean {
  return pathname === deskPath || pathname === deskPath + 'index.html' || pathname === deskPath.slice(0, -1);
}
