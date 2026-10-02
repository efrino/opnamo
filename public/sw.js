// App-shell cache so the scanner opens offline. API calls always go to the network.
const VERSION = 'opnamo-v5';
const SHELL = ['/app.html', '/css/app.css', '/js/app.js', '/js/api.js', '/js/ui.js', '/js/offline.js',
  '/js/views/auth.js', '/js/views/dashboard.js', '/js/views/items.js', '/js/views/print.js', '/js/views/stocktakes.js',
  '/js/views/stocktake.js', '/js/views/scan.js', '/js/views/team.js', '/vendor/jsQR.js', '/vendor/qrcode.js', '/icons/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // /app/* navigations -> app shell (network first, cache fallback).
  if (e.request.mode === 'navigate' && url.pathname.startsWith('/app')) {
    e.respondWith(fetch(e.request).catch(() => caches.match('/app.html')));
    return;
  }
  // Static assets: stale-while-revalidate.
  e.respondWith(caches.open(VERSION).then(async c => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
