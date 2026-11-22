/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;
declare const DESK_PREVIEW_BUILD: string;
declare const DESK_PREVIEW_ASSETS: readonly [path: string, build: string][];
declare const DESK_PREVIEW_SONG_PATHS: readonly string[];

const scope = self.registration.scope;
const prefix = 'show-tools-practice-' + scope + ':';
const cacheName = prefix + DESK_PREVIEW_BUILD;
const shell = new URL(scope).pathname;
const songs = new Set(DESK_PREVIEW_SONG_PATHS);
const assets = new Map(DESK_PREVIEW_ASSETS);

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const existing = await caches.has(cacheName);
    const cache = await caches.open(cacheName);
    try {
      for (const [path, build] of assets) {
        const url = new URL(path, scope);
        url.searchParams.set('__show_tools_build', build);
        const response = await fetch(url, { cache: 'reload' });
        if (!response.ok) throw new Error('The preview build could not be cached.');
        await cache.put(path, response);
      }
    } catch (error) {
      if (!existing) await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'activate-when-idle') return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
    const scoped = clients.filter(client => client.url.startsWith(scope));
    if (scoped.length === 1 && event.source && 'id' in event.source && event.source.id === scoped[0].id) return self.skipWaiting();
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const route = url.pathname.replace(/\/$/, '');
  const key = event.request.mode === 'navigate' && songs.has(route) ? shell : url.pathname;
  if (!assets.has(key)) return;
  event.respondWith(caches.open(cacheName).then(async cache => {
    const cached = await cache.match(key);
    if (!cached) throw new Error('This preview build is unavailable offline.');
    return cached;
  }));
});
