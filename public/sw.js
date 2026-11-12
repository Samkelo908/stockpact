self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Business records always come from the authenticated server.
self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    "<!doctype html><meta name=viewport content='width=device-width, initial-scale=1'><title>StockPact is offline</title><body style='margin:2rem;font:1rem system-ui;color:#101d2c'><h1>You're offline</h1><p>Reconnect to open your StockPact workspace.</p><a href='/'>Try again</a></body>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
  )));
});
