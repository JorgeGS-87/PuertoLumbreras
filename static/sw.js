/**
 * GeoRuta Service Worker
 * Estrategia: Network-first para la API, Cache-first para assets estáticos.
 * El modo offline que ya existe en PC funciona igual en móvil gracias a este SW.
 */

const CACHE_NAME = 'georuta-v1';

// Assets que se cachean en la instalación (shell de la app)
const PRECACHE_URLS = [
  '/mobile',
  '/static/css/leaflet.css',
  '/static/css/styles.css',
  '/static/css/layers.css',
  '/static/css/legend.css',
  '/static/css/routing.css',
  '/static/css/ui.css',
  '/static/css/tables.css',
  '/static/css/modals.css',
  '/static/css/widgets.css',
  '/static/css/obstacles.css',
  '/static/css/temporal.css',
  '/static/css/mobile.css',
  '/static/js/map/map-config.js',
  '/static/js/map/projection-utils.js',
  '/static/js/layers/layer-manager.js',
  '/static/js/layers/symbology.js',
  '/static/js/layers/lane-management.js',
  '/static/js/routing/route-manager.js',
  '/static/js/routing/event-manager.js',
  '/static/js/temporal/time.js',
  '/static/js/temporal/calendar-manager.js',
  '/static/js/temporal/realtime.js',
  '/static/js/ui/auth.js',
  '/static/js/ui/search.js',
  '/static/js/ui/map-widgets.js',
  '/static/js/ui/table-manager.js',
  '/static/js/ui/history-manager.js',
  '/static/js/ui/tutorial.js',
  '/static/manifest.json',
];

// URLs de la API que NUNCA se cachean (siempre red)
const API_PATTERNS = [
  '/api/calcular-ruta',
  '/api/auth/',
  '/api/historial',
  '/api/obstaculos-compartidos',
];

// ── Instalación: precachear shell ─────────────────────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Cachear de forma silenciosa — si algún asset falla no bloquear
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(() => console.warn('[SW] No precacheado:', url))
        )
      );
    })
  );
});

// ── Activación: limpiar cachés antiguas ───────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: estrategia híbrida ─────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method === 'POST') {
    return;
}

  const url = new URL(event.request.url);

  // 1. Peticiones a otros orígenes (Leaflet CDN, etc.) → red directa
  if (url.origin !== self.location.origin) {
    return;
  }

  // 2. API crítica → siempre red, sin caché
  const isApi = API_PATTERNS.some(p => url.pathname.startsWith(p));
  if (isApi) {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. GeoJSON de datos (Vías, POIs, portales) → Network-first con fallback a caché
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('.geojson')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // 4. Assets estáticos (CSS, JS, imágenes) → Cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});
