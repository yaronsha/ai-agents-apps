/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkFirst } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";

declare const self: ServiceWorkerGlobalScope;

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// Map tiles you have looked at stay available offline (mountain roads have little signal).
registerRoute(
  ({ url }) => url.hostname.endsWith("tile.openstreetmap.org"),
  new CacheFirst({ cacheName: "osm-tiles", plugins: [new ExpirationPlugin({ maxEntries: 3000, maxAgeSeconds: 60 * 24 * 3600 })] }),
);

registerRoute(({ url }) => url.pathname === "/api/state", new NetworkFirst({ cacheName: "trip-state", networkTimeoutSeconds: 6 }));

self.addEventListener("push", (event) => {
  const data = (event.data?.json() ?? {}) as { title?: string; body?: string; url?: string; tag?: string };
  event.waitUntil(
    self.registration.showNotification(data.title ?? "צפון תאילנד", {
      body: data.body,
      tag: data.tag,
      dir: "rtl",
      lang: "he",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
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
      if (win) return win.navigate(url).then((w) => w?.focus());
      return self.clients.openWindow(url);
    }),
  );
});
