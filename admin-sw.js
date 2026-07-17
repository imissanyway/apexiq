const CACHE_NAME = "apexiq-admin-shell-v130";
const ADMIN_HTML = "./admin.html?v=130";
const SHELL = [
  ADMIN_HTML,
  "./admin-manifest.webmanifest?v=130",
  "./admin-icon-192.png",
  "./admin-icon-512.png"
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.includes("/api/")) return;

  if (request.mode === "navigate" || url.pathname.endsWith("/admin.html")) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(response => {
          if (response && response.ok) {
            caches.open(CACHE_NAME).then(cache => cache.put(ADMIN_HTML, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(ADMIN_HTML))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(hit =>
      hit || fetch(request).then(response => {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        }
        return response;
      })
    )
  );
});
