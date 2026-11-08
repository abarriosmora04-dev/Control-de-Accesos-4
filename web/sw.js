// Service worker de ControlPark.
// - HTML y JS: primero la red (las actualizaciones llegan al momento) y, sin conexión, la copia guardada.
// - Librerías, iconos y fuentes: primero la copia guardada.
// - Las llamadas al servidor (Apps Script) nunca se guardan.
// Rutas relativas: funciona igual en GitHub Pages que en controlpark.es.
const VERSION = 'controlpark-v3.0.0';
const CORE = [
  './', 'index.html', 'manifest.json', 'css/app.css',
  'js/app.js', 'js/api.js', 'js/config.js', 'js/util.js', 'js/ui.js', 'js/qr.js', 'js/pdf.js',
  'js/camera.js', 'js/offline.js', 'js/feedback.js',
  'js/views/register.js', 'js/views/pass.js', 'js/views/recover.js', 'js/views/login.js',
  'js/views/scanner.js', 'js/views/admin.js',
  'vendor/qrcode.mjs', 'vendor/jsQR.js', 'vendor/jspdf.umd.min.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/logo.jpg',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION && k.startsWith('controlpark')).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('script.google.com') || url.hostname.endsWith('googleusercontent.com')) return;

  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  const staticAsset = isFont || /\/(vendor|icons)\//.test(url.pathname);
  event.respondWith(staticAsset ? cacheFirst(req) : networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    return Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
