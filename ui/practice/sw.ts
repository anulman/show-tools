/// <reference lib="webworker" />
export {};
declare const self: ServiceWorkerGlobalScope;
const CACHE = 'show-tools-practice-v3';
const MODULE_FILES = '__BUILD_MODULE_FILES__';
const FILES = ['./', './index.html', './style.css', './icon.svg', './manifest.webmanifest',
  './wasm/manual-clock.wasm', ...(Array.isArray(MODULE_FILES) ? MODULE_FILES : [])];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('show-tools-practice-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    const match = await caches.match(event.request, { ignoreSearch: true });
    if (match) return match;
    throw new Error('This file is unavailable offline');
  }));
});
