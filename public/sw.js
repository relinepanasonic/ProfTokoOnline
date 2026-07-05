// Minimal service worker — its only job is to satisfy Android Chrome's
// installability criteria (a registered SW WITH a fetch handler is required
// for the "Install app" / WebAPK prompt; without it Chrome only offers a
// plain "Create shortcut"). Network pass-through so it NEVER serves stale
// content — no offline caching, deliberately.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // let the browser handle it normally; the handler just needs to exist
  event.respondWith(fetch(event.request));
});
