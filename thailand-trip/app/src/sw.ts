/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

// A fix deployed mid-trip takes over right away instead of waiting for every tab to close.
self.skipWaiting();
clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Map tiles you have looked at stay available offline (mountain roads have little signal).
registerRoute(
  ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/tiles/"),
  new CacheFirst({ cacheName: "map-tiles-v2", plugins: [
    // The Thai fallback tiles (no CARTO key on the server yet) are marked no-store; keep them out.
    { cacheWillUpdate: async ({ response }) => (response.ok && !/no-store/.test(response.headers.get("Cache-Control") ?? "") ? response : null) },
    new ExpirationPlugin({ maxEntries: 3000, maxAgeSeconds: 60 * 24 * 3600, purgeOnQuotaError: true }),
  ] }),
);

// Old tile caches: OpenStreetMap, then CARTO tiles fetched without a key (stamped "API KEY REQUIRED").
self.addEventListener("activate", (event) => {
  event.waitUntil(Promise.all(["osm-tiles", "map-tiles"].map((name) => caches.delete(name))));
});

self.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string; tag?: string };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "צפון תאילנד", {
      body: data.body,
      tag: data.tag,
      dir: "rtl",
      lang: "he",
      // A chedi, like Doi Suthep's. The badge is white on transparent: Android draws only its outline.
      icon: "/notification-icon.png",
      badge: "/badge.png",
      data: { url: data.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins[0];
      if (!win) return self.clients.openWindow(url);
      // navigate() rejects on a window this worker does not control yet (first install).
      return win
        .navigate(url)
        .then((w) => (w ?? win).focus())
        .catch(() => self.clients.openWindow(url));
    }),
  );
});
