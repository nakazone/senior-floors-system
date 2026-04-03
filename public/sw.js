/**
 * Senior Floors — service worker mínimo (assets estáticos).
 */
const CACHE = 'sf-static-v2';
const PRECACHE = [
  '/dashboard.html',
  '/styles.css',
  '/design-system.css',
  '/mobile-design-system.css',
  '/manifest.json',
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE).catch(() => {}))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        if (res.ok && /\.(css|js|png|jpg|svg|woff2?)$/i.test(url.pathname)) {
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((r) => r || Promise.reject()))
  );
});
