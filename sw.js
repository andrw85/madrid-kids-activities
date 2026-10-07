/* Service worker for Actividades infantiles — Madrid.
 * Strategy:
 *  - App shell ("/" and index) : stale-while-revalidate (instant load, updates in bg)
 *  - Leaflet CDN assets        : cache-first (rarely change)
 *  - Map tiles                 : cache a limited set, network-first fallback to cache
 *  - /api/search               : never cached (always live data)
 */
const SHELL = "mk-shell-v1";
const CDN   = "mk-cdn-v1";
const TILES = "mk-tiles-v1";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(["/"])));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, CDN, TILES]);
    const names = await caches.keys();
    await Promise.all(names.filter(n => !keep.has(n)).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // never touch POST /api/search

  const url = new URL(req.url);

  // Never cache the API.
  if (url.pathname.startsWith("/api/")) return;

  // App shell: stale-while-revalidate.
  if (url.origin === self.location.origin &&
      (url.pathname === "/" || url.pathname === "/index")) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match("/");
      const fetchP = fetch(req).then(r => { cache.put("/", r.clone()); return r; }).catch(()=>null);
      return cached || (await fetchP) || new Response("offline", {status:503});
    })());
    return;
  }

  // Leaflet CDN (unpkg): cache-first.
  if (url.hostname === "unpkg.com") {
    e.respondWith((async () => {
      const cache = await caches.open(CDN);
      const cached = await cache.match(req);
      if (cached) return cached;
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    })());
    return;
  }

  // OSM map tiles: network-first, fall back to cache (cap size loosely).
  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    e.respondWith((async () => {
      const cache = await caches.open(TILES);
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch (_) {
        const cached = await cache.match(req);
        return cached || Response.error();
      }
    })());
    return;
  }
});
