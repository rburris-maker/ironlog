// Service worker: makes the app open instantly and work with no signal.
//
// Strategy: fetch app files from the network when there is signal (so phones run
// the newest build) and fall back to the saved copy when there is not. Requests
// to the database (Supabase) are never cached or intercepted.
//
// Bump VERSION (and js/version.js) whenever you deploy changes.

const VERSION = 'ironlog-v8';

const SHELL = [
  './',
  './index.html',
  './config.js',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/version.js',
  './js/lib/dom.js',
  './js/lib/format.js',
  './js/core/calc.js',
  './js/core/exercises.js',
  './js/core/idb.js',
  './js/core/store.js',
  './js/core/session.js',
  './js/core/sync.js',
  './js/core/auth.js',
  './js/core/body.js',
  './js/core/groups.js',
  './js/ui/app.js',
  './js/ui/active.js',
  './js/ui/authview.js',
  './js/ui/body.js',
  './js/ui/groups.js',
  './js/ui/groupstate.js',
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

// Ask the network first (so a phone always runs the newest build when it has signal),
// but give up after a few seconds and use the saved copy — which is also what makes
// the app open with no signal at all.
const NETWORK_WAIT_MS = 3000;

function fromNetwork(req, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    fetch(req).then((res) => { clearTimeout(timer); resolve(res); }, (err) => { clearTimeout(timer); reject(err); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CACHEABLE_HOSTS.includes(url.hostname)) return; // e.g. Supabase: always straight to the network

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = () => cache.match(req, { ignoreSearch: sameOrigin && req.mode === 'navigate' });

    // Fonts and the sign-in library never change for a given address: saved copy first.
    if (!sameOrigin) {
      const hit = await cached();
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch { return new Response('Offline', { status: 503, statusText: 'Offline' }); }
    }

    // The app's own files: network first.
    try {
      const res = await fromNetwork(req, NETWORK_WAIT_MS);
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      if (res && (res.ok || res.status < 500)) return res;
      throw new Error(`HTTP ${res ? res.status : 0}`);
    } catch {
      const hit = await cached();
      if (hit) return hit;
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
