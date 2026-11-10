// Service worker: makes the app open instantly and work with no signal.
//
// Strategy: serve app files from the cache right away and refresh them in the
// background, so the next launch has the newest version. Requests to the
// database (Supabase) are never cached or intercepted.
//
// Bump VERSION whenever you deploy changes, so phones pick up the new files.

const VERSION = 'ironlog-v3';

const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/lib/dom.js',
  './js/lib/format.js',
  './js/core/calc.js',
  './js/core/exercises.js',
  './js/core/idb.js',
  './js/core/store.js',
  './js/core/session.js',
  './js/core/sync.js',
  './js/core/auth.js',
  './js/ui/app.js',
  './js/ui/active.js',
  './js/ui/authview.js',
  './js/ui/charts.js',
  './js/ui/editor.js',
  './js/ui/history.js',
  './js/ui/home.js',
  './js/ui/pickers.js',
  './js/ui/profile.js',
  './js/ui/progress.js',
  './js/ui/rest.js',
  './js/ui/workouts.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

// Outside files that are safe to keep for offline use (the sign-in library and fonts).
const CACHEABLE_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return; // e.g. Supabase: always straight to the network

  // config.js decides whether accounts are on, so always try the network first for it.
  if (sameOrigin && url.pathname.endsWith('/config.js')) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req, { cache: 'no-store' });
        if (res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        return (await cache.match(req)) || new Response('', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: sameOrigin && req.mode === 'navigate' });
    const refresh = fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      })
      .catch(() => null);
    if (cached) { event.waitUntil(refresh); return cached; }
    const fresh = await refresh;
    if (fresh) return fresh;
    if (req.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
