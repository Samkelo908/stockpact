const mediaCachePrefix = "stockpact-built-in-media-";
const mediaCacheName = `${mediaCachePrefix}v1`;
const mediaPaths = new Set([
  "/cape-town-shop-delivery.webp",
  "/listing-coffee.webp",
  "/listing-oil.webp",
  "/listing-packaging.webp",
  "/listing-tomatoes.webp",
  "/listing-water.webp",
]);

function builtInMediaKey(url) {
  return new URL(url.pathname, self.location.origin).href;
}

function isBuiltInImage(response, expectedUrl) {
  return response.status === 200 && !response.redirected && response.url === expectedUrl &&
    response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === "image/webp";
}

async function cacheBuiltInImage(cache, key, response, expectedUrl) {
  if (!cache || !isBuiltInImage(response, expectedUrl)) return;
  await cache.put(key, response.clone()).catch(() => {});
}

async function warmBuiltInMedia() {
  const cache = await caches.open(mediaCacheName).catch(() => null);
  if (!cache) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    await Promise.allSettled(Array.from(mediaPaths, async (path) => {
      const key = new URL(path, self.location.origin).href;
      const response = await fetch(key, { credentials: "same-origin", redirect: "error", cache: "no-cache", signal: controller.signal });
      await cacheBuiltInImage(cache, key, response, key);
    }));
  } finally {
    clearTimeout(timer);
  }
}

async function builtInImage(request, url) {
  const cache = await caches.open(mediaCacheName).catch(() => null);
  const key = builtInMediaKey(url);
  const saved = await cache?.match(key, { ignoreVary: true }).catch(() => undefined);
  if (saved) return saved;
  const response = await fetch(request, { redirect: "error", cache: "no-cache" });
  await cacheBuiltInImage(cache, key, response, url.href);
  return response;
}

self.addEventListener("install", (event) => event.waitUntil(warmBuiltInMedia().finally(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil((async () => {
  const keys = await caches.keys().catch(() => []);
  await Promise.allSettled(keys.filter((key) => key.startsWith(mediaCachePrefix) && key !== mediaCacheName).map((key) => caches.delete(key)));
  await self.clients.claim();
})()));

// Business records always come from the authenticated server.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.destination === "image" && request.method === "GET" && !request.headers.has("range")) {
    const url = new URL(request.url);
    if (url.origin === self.location.origin && mediaPaths.has(url.pathname) && (!url.search || url.search === "?stockpact-image-retry=1")) {
      event.respondWith(builtInImage(request, url));
      return;
    }
  }
  if (request.mode !== "navigate") return;
  event.respondWith(fetch(request).catch(() => new Response(
    "<!doctype html><meta name=viewport content='width=device-width, initial-scale=1'><title>StockPact is offline</title><body style='margin:2rem;font:1rem system-ui;color:#211b17;background:#f8f4eb'><h1>You're offline</h1><p>Reconnect to open your StockPact workspace.</p><a href='/' style='display:inline-block;padding:.65rem 1rem;color:#211b17;background:#ffd33d;border-radius:.4rem'>Try again</a></body>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )));
});
