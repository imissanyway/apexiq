const CACHE_NAME = "apexiq-admin-shell-v134";
const ADMIN_HTML = "./admin.html?v=134";
const SHELL = [
  ADMIN_HTML,
  "./admin-manifest.webmanifest?v=134",
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


self.addEventListener("push", event => {
  const title = "New ApexIQ beta request";
  const options = {
    body: "A new access request is waiting in ApexIQ Admin.",
    icon: "./admin-icon-192.png",
    badge: "./admin-icon-192.png",
    tag: "apexiq-beta-request",
    renotify: true,
    data: { url: "./admin.html?v=134#access-requests" }
  };
  event.waitUntil((async () => {
    try {
      if (self.navigator && typeof self.navigator.setAppBadge === "function") {
        await self.navigator.setAppBadge(1);
      }
    } catch (_) {}
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = new URL(
    event.notification && event.notification.data && event.notification.data.url
      ? event.notification.data.url
      : "./admin.html?v=134#access-requests",
    self.location.origin + self.location.pathname
  ).href;

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of windows) {
      if ("focus" in client) {
        if ("navigate" in client) await client.navigate(target);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
