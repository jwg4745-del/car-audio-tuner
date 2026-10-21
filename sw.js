/* 汽车音响调音 — 离线静态壳 */
const CACHE = 'car-audio-tuner-v24';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/audio-engine.js',
  './js/app.js',
  './js/role.js',
  './js/cargui.js',
  './js/export-tracks.js',
  './js/channels.js',
  './js/generator.js',
  './js/rta.js',
  './js/phase-test.js',
  './js/polarity.js',
  './js/delay-test.js',
  './js/spl.js',
  './js/xover.js',
  './js/logger.js',
  './js/testtrack.js',
  './js/simple.js',
  './js/carid.js',
  './js/duo.js',
  './js/micpick.js',
  './js/pro1.js',
  './js/pro2.js',
  './js/pro3.js',
  './js/analyzer.js',
  './js/tuneplan.js',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon.svg',
  './assets/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => Promise.all(ASSETS.map((a) => c.add(new Request(a, { cache: 'no-store' })).catch(() => {})))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });

// 网络优先（html/js/css 总拿最新），离线时退回缓存
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req, { cache: 'no-store' }).then((res) => {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
  );
});
