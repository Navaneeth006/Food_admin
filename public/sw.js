/* Kiosk service worker.
   Strategy: NETWORK-FIRST for the app shell (always pick up new deploys),
   falling back to the cached copy only when the server is unreachable.
   Menu images: stale-while-revalidate. Never caches POSTs, /api/, or /admin.
   Bump VERSION whenever you change cached assets to force a refresh. */
const VERSION = 'kiosk-v2';
const SHELL = [
  '/',
  '/kiosk.css',
  '/kiosk.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // never cache dynamic/admin endpoints or the SSE stream
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

  // app shell: NETWORK-first, cache fallback (offline = last known UI)
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy));
        return res;
      })
      .catch(() =>
        caches.match(req).then((hit) => hit || Response.error())
      )
  );
});
