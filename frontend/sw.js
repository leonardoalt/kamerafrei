/* kamerafrei service worker: offline-capable app shell + data caches.
 *
 * Cache strategy by asset class:
 *   app shell (html/js/css/icons, leaflet CDN)  install-time precache;
 *                                               "/" is network-first so
 *                                               deploys apply on reload
 *   /web-data/*.bin  cache-first (URLs are versioned, effectively immutable)
 *   /api/cameras     stale-while-revalidate (changes weekly)
 *   map tiles        cache-first with a size cap (offline = seen areas only)
 *   /api/route       network only (server fallback engine)
 *
 * VERSION must move with the ?v= asset version in index.html.
 */

const VERSION = "12"; // keep equal to the ?v= asset version in index.html
const SHELL_CACHE = `kf-shell-${VERSION}`;
const DATA_CACHE = "kf-data-v1";
const TILE_CACHE = "kf-tiles-v1";
const TILE_LIMIT = 600; // ~30 MB of map tiles

const SHELL = [
  "/",
  `/style.css?v=${VERSION}`,
  `/app.js?v=${VERSION}`,
  `/worker.js?v=${VERSION}`,
  `/router.js?v=${VERSION}`,
  "/favicon.svg",
  "/manifest.webmanifest",
  "/icon-192.png",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  const keep = new Set([SHELL_CACHE, DATA_CACHE, TILE_CACHE]);
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(cacheName, request, trimTo) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const resp = await fetch(request);
  if (resp.ok) {
    cache.put(request, resp.clone());
    if (trimTo) trimCache(cache, trimTo);
  }
  return resp;
}

async function networkFirst(cacheName, request) {
  const cache = await caches.open(cacheName);
  try {
    const resp = await fetch(request);
    if (resp.ok) cache.put(request, resp.clone());
    return resp;
  } catch (err) {
    const hit = await cache.match(request, { ignoreSearch: request.url.endsWith("/") });
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const refresh = fetch(request)
    .then((resp) => {
      if (resp.ok) cache.put(request, resp.clone());
      return resp;
    })
    .catch(() => hit);
  return hit || refresh;
}

async function trimCache(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) cache.delete(keys[i]);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/route")) return; // network only
    if (url.pathname.startsWith("/web-data/"))
      return e.respondWith(cacheFirst(DATA_CACHE, req));
    if (url.pathname === "/api/cameras")
      return e.respondWith(staleWhileRevalidate(DATA_CACHE, req));
    if (url.pathname === "/")
      return e.respondWith(networkFirst(SHELL_CACHE, req));
    return e.respondWith(cacheFirst(SHELL_CACHE, req));
  }
  if (url.hostname === "tile.openstreetmap.org")
    return e.respondWith(cacheFirst(TILE_CACHE, req, TILE_LIMIT));
  if (url.hostname === "unpkg.com")
    return e.respondWith(cacheFirst(SHELL_CACHE, req));
  // photon (autocomplete) and anything else: straight to the network
});
