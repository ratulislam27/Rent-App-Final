const CACHE_PREFIX = "rento-shell-";
const CACHE = `${CACHE_PREFIX}v4`;
const SHELL = ["/", "/manifest.webmanifest", "/favicon-v3.svg", "/icon-192-v3.png", "/icon-512-v3.png", "/apple-touch-icon-v3.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put("/", response.clone());
      }
      return response;
    }).catch(() => caches.match("/")));
    return;
  }

  if (["style", "script", "worker"].includes(event.request.destination)) {
    event.respondWith(fetch(event.request).then(async (response) => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    }).catch(() => caches.match(event.request)));
    return;
  }

  if (["font", "image"].includes(event.request.destination)) {
    event.respondWith(caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(event.request, response.clone());
        }
        return response;
      });
      if (!cached) return fresh;
      event.waitUntil(fresh.catch(() => undefined));
      return cached;
    }));
  }
});
