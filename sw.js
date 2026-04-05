const CACHE_NAME = 'controlpark-v2';
const BASE = '/Control-de-Accesos-4';

// Archivos a cachear para uso offline
const STATIC_ASSETS = [
  `${BASE}/`,
  `${BASE}/index.html`,
  `${BASE}/manifest.json`,
  `${BASE}/icons/icon-192.png`,
  `${BASE}/icons/icon-512.png`,
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
];

// ── INSTALACIÓN: cachear todos los assets estáticos ──
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      console.log('[SW] Cacheando assets...');
      return cache.addAll(STATIC_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// ── ACTIVACIÓN: limpiar cachés antiguas ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Eliminando caché antigua:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia Network First para el API, Cache First para el resto ──
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Las llamadas al Apps Script de Google siempre van a la red (no se cachean)
  if (url.hostname === 'script.google.com') {
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ error: 'Sin conexión — los datos no están disponibles offline' }), {
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // Para el resto: Cache First (rápido), con actualización en background
  event.respondWith(
    caches.match(event.request).then(cached => {
      const networkFetch = fetch(event.request).then(response => {
        // Actualizar caché si la respuesta es válida
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => cached); // Si falla la red, devolver lo cacheado

      return cached || networkFetch;
    })
  );
});

// ── MENSAJE: forzar actualización desde la app ──
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
  }
});
