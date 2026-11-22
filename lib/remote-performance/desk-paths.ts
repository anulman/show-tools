import { songForRoute } from '../../songs/routes.js';

export const HARDWARE_DESK_PATH = '/ui/live/';
export const BROWSER_DESK_PATH = '/ui/browser/';
export const PRACTICE_ASSET_PATH = '/ui/practice/';
export const TANSTACK_DESK_PATH = '/';
export const TANSTACK_ASSET_PATH = '/desk-assets/';
export const TANSTACK_STATIC_PATH = '/preview/tanstack';

export function isTanstackDeskDocument(path: string): boolean {
  if (path === '/' || path === '/browser' || path === '/browser/') return true;
  const slug = path.replace(/^\/(?:browser\/)?/, '').replace(/\/$/, '');
  return songForRoute(slug) !== undefined;
}

export function practiceAssetBase(pageUrl: string | URL): URL {
  const page = new URL(pageUrl);
  return isTanstackDeskDocument(page.pathname) ? new URL(PRACTICE_ASSET_PATH, page) : page;
}

export function isDeskEntry(pathname: string, deskPath: string): boolean {
  return pathname === deskPath || pathname === deskPath + 'index.html' || pathname === deskPath.slice(0, -1);
}
