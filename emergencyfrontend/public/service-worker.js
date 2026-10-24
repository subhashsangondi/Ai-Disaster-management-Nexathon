const CACHE_NAME = "rescuegrid-victim-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const response = await fetch("/");
    if (response.ok) {
      await cache.put("/", response.clone());
      await cache.put("/index.html", response.clone());

      const html = await response.text();
      const assetPaths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/g)]
        .map((match) => match[1]);
      await Promise.all(assetPaths.map(async (assetPath) => {
        const assetUrl = new URL(assetPath, self.location.origin);
        if (assetUrl.origin !== self.location.origin || assetUrl.pathname.startsWith("/api/")) return;
        try {
          const assetResponse = await fetch(assetUrl);
          if (assetResponse.ok) await cache.put(assetUrl, assetResponse);
        } catch {
          // A failed asset fetch should not prevent the worker from installing.
        }
      }));
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith("rescuegrid-victim-shell-") && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const requestUrl = new URL(request.url);
  if (request.method !== "GET" || requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put("/", response.clone());
          await cache.put("/index.html", response.clone());
        }
        return response;
      } catch {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(request) || await cache.match("/") || await cache.match("/index.html");
      }
    })());
    return;
  }

  if (!requestUrl.pathname.startsWith("/assets/")
    && !["script", "style", "font", "image"].includes(request.destination)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request.url);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  })());
});