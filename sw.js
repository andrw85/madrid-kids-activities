/* Service worker for Actividades infantiles — Madrid.
 * Strategy:
 *  - App shell ("/" and index) : stale-while-revalidate (instant load, updates in bg)
 *  - Leaflet CDN assets        : cache-first (rarely change)
 *  - Map tiles                 : cache a limited set, network-first fallback to cache
 *  - /api/search               : never cached (always live data)
 */
const SHELL = "mk-shell-v3";
const CDN   = "mk-cdn-v1";
const TILES = "mk-tiles-v1";
const IMAGES = "mk-img-v1";    // category pool WebP + Pexels CDN, cache-on-first-view

// Shell URL = the scope this SW is registered under (works at "/" or "/subpath/").
const SHELL_URL = new URL("./", self.registration ? self.registration.scope : self.location).pathname;

// All local files the app needs to boot. Pre-caching these means that after one
// successful load the app runs even if the host (e.g. GitHub Pages) goes away.
const SHELL_ASSETS = [
  SHELL_URL,
  SHELL_URL + "index.html",
  SHELL_URL + "engine.js",
  SHELL_URL + "api-shim.js",
  SHELL_URL + "manifest.webmanifest",
  SHELL_URL + "icon-192.png",
  SHELL_URL + "icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Cache each asset independently so one failure does not abort the whole install.
  e.waitUntil(caches.open(SHELL).then(c =>
    Promise.all(SHELL_ASSETS.map(u =>
      c.add(new Request(u, { cache: "reload" })).catch(() => {})
    ))
  ));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, CDN, TILES, IMAGES]);
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
  if (url.pathname.indexOf("/api/") !== -1) return;

  // App shell: serve the cached shell first (offline-first), refresh in the
  // background. Treat navigations (and the shell/index paths) the same so the
  // app always boots even when the host (GitHub Pages) 404s or is offline.
  const isNavigation = req.mode === "navigate";
  const isShellPath = url.origin === self.location.origin &&
      (url.pathname === SHELL_URL || url.pathname === SHELL_URL + "index" ||
       url.pathname === SHELL_URL + "index.html");
  if (isNavigation || isShellPath) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(SHELL_URL);
      // Background refresh — but ONLY overwrite the cached shell with a real,
      // OK (200) response. A 404/offline from GitHub must never poison it.
      const fetchP = fetch(req).then(r => {
        if (r && r.ok && r.type !== "opaqueredirect") cache.put(SHELL_URL, r.clone());
        return r;
      }).catch(() => null);
      // Prefer the cached shell. Fall back to the network only if nothing is
      // cached yet, and only use a network response that is actually OK.
      if (cached) { fetchP; return cached; }
      const net = await fetchP;
      if (net && net.ok) return net;
      return new Response("offline", { status: 503 });
    })());
    return;
  }

  // Other local app files (engine.js, api-shim.js, manifest): cache-first,
  // so the app keeps working even if the host is taken offline later.
  if (url.origin === self.location.origin && SHELL_ASSETS.indexOf(url.pathname) !== -1) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const r = await fetch(req);
        if (r.ok) cache.put(req, r.clone());
        return r;
      } catch (_) {
        return cached || new Response("offline", { status: 503 });
      }
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

  // Category pool images (local img/*.webp) and Pexels CDN photos: cache-first,
  // populated ON FIRST VIEW (no bulk precache -> install stays fast, first paint
  // of the app is never blocked by images). A given image is fetched once, then
  // served from cache forever (offline-safe for the committed local pool).
  const isLocalPoolImg = url.origin === self.location.origin &&
      /\/img\/.+\.webp$/i.test(url.pathname);
  const isPexelsImg = url.hostname === "images.pexels.com";
  if (isLocalPoolImg || isPexelsImg) {
    e.respondWith((async () => {
      const cache = await caches.open(IMAGES);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const r = await fetch(req);
        if (r && (r.ok || r.type === "opaque")) cache.put(req, r.clone());
        return r;
      } catch (_) {
        return cached || new Response("offline", { status: 503 });
      }
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
