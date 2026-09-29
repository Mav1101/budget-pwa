// Service worker: caches the app shell (stale-while-revalidate).
// API calls (script.google.com) and Google sign-in are NEVER cached here;
// offline data lives in IndexedDB instead (js/offline.js).
//
// BUILD is replaced with the commit SHA by the GitHub Pages workflow, so each
// deploy gets a fresh cache. Locally it stays "__BUILD__".
const BUILD = '__BUILD__';
const SHELL_CACHE = `budget-shell-${BUILD}`;
const RUNTIME_CACHE = 'budget-runtime-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/config.js',
  './js/app.js',
  './js/api.js',
  './js/auth.js',
  './js/offline.js',
  './js/store.js',
  './js/ui.js',
  './js/theme.js',
  './js/charts.js',
  './js/detail.js',
  './js/pages/signin.js',
  './js/pages/dashboard.js',
  './js/pages/add.js',
  './js/pages/transactions.js',
  './js/pages/review.js',
  './js/pages/reports.js',
  './js/pages/settings.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
];

// Third-party static assets that are safe to cache (fonts, Chart.js).
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
// Never touched by the service worker.
const BYPASS_HOSTS = ['script.google.com', 'script.googleusercontent.com', 'accounts.google.com', 'oauth2.googleapis.com', 'www.googleapis.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('budget-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (BYPASS_HOSTS.includes(url.hostname)) return;

  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin && req.mode === 'navigate') {
    event.respondWith(staleWhileRevalidate(event, req, SHELL_CACHE, './index.html'));
    return;
  }
  if (sameOrigin) {
    // Skip anything outside our scope (e.g. /.well-known/ on the domain root).
    if (!url.href.startsWith(self.registration.scope)) return;
    event.respondWith(staleWhileRevalidate(event, req, SHELL_CACHE));
    return;
  }
  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event, req, RUNTIME_CACHE));
  }
});

async function staleWhileRevalidate(event, req, cacheName, cacheKey) {
  const cache = await caches.open(cacheName);
  const key = cacheKey || req;
  const cached = await cache.match(key, { ignoreSearch: true });
  const network = fetch(req)
    .then((res) => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(key, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  if (res) return res;
  if (req.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell) return shell;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
}
