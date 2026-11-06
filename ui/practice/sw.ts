/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;
const BUILD = '__BUILD_CACHE_ID__';
const CACHE_SCOPE = 'show-tools-practice-' + self.registration.scope + ':';
const CACHE = CACHE_SCOPE + BUILD;
const MODULE_FILES = '__BUILD_MODULE_FILES__';
const FILES: string[] = Array.isArray(MODULE_FILES) ? MODULE_FILES : [];
const ASSET_URLS = new Set(FILES.map(path => new URL(path.replace(/^\/ui\/practice\//, './'), self.location.href).href));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => Promise.all([...ASSET_URLS].map(async path => {
    const pinned = new URL(path);
    pinned.searchParams.set('__show_tools_build', BUILD);
    const response = await fetch(new Request(pinned, { cache: 'reload' }));
    if (!response.ok) throw new Error('This build could not be cached');
    return { path, response };
  })).then(assets => Promise.all(assets.map(({ path, response }) => cache.put(path, response))))));
});
self.addEventListener('message', event => {
  const data: unknown = event.data;
  if (typeof data !== 'object' || data === null || !('type' in data) || data.type !== 'activate-when-idle') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const practiceClients = clients.filter(client => client.url.startsWith(self.registration.scope));
    if (practiceClients.length === 1 && event.source && 'id' in event.source && event.source.id === practiceClients[0].id) return self.skipWaiting();
  }));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_SCOPE) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  url.search = '';
  if (url.pathname === new URL('./', self.location.href).pathname) url.pathname += 'index.html';
  if (!ASSET_URLS.has(url.href)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const match = await cache.match(url.href);
    if (match) return match;
    throw new Error('This build is unavailable offline');
  }));
});
