const CACHE = "wortladen-v2";
const APP_SHELL = [
  "./",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./assets/shop-interior.png",
  "./assets/customer-sprites.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const rootUrl = new URL("./", self.registration.scope);
    const rootResponse = await fetch(rootUrl, { cache: "no-store" });
    const html = await rootResponse.clone().text();
    const bundleUrls = Array.from(html.matchAll(/(?:src|href)="([^"]+)"/g), (match) => match[1])
      .map((path) => new URL(path, rootUrl))
      .filter((url) => url.origin === self.location.origin && url.pathname.includes("/_next/"))
      .map((url) => url.href);

    await cache.put(rootUrl, rootResponse);
    await cache.addAll([...APP_SHELL.slice(1), ...new Set(bundleUrls)]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    const staleCacheNames = cacheNames.filter((name) => name.startsWith("wortladen-") && name !== CACHE);
    await Promise.all(staleCacheNames.map((name) => caches.delete(name)));
    await self.clients.claim();

    // Do not await these navigations: an activating worker cannot finish a
    // navigation that it is still waiting on. Once activation completes, the
    // newly controlled page reloads from the current GitHub Pages release.
    if (staleCacheNames.length > 0) {
      const windowClients = await self.clients.matchAll({ type: "window" });
      windowClients.forEach((client) => { void client.navigate(client.url).catch(() => undefined); });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) || (await caches.match("./"));
      }
    })());
    return;
  }

  const network = fetch(request).then(async (response) => {
    if (response.ok && new URL(request.url).origin === self.location.origin) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.then(() => undefined).catch(() => undefined));
  event.respondWith(caches.match(request).then((cached) => cached || network));
});

