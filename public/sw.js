/**
 * Divvy service worker.
 *
 * Written by hand rather than generated, because the caching policy is a
 * product decision and a generated one gets it wrong in a way that is very hard
 * to debug on someone else's phone.
 *
 * Three rules, one per kind of request:
 *
 *   **Navigations — network first, cache as fallback.** A stale app shell is
 *   the classic PWA failure: the user updates, sees the old version, and no
 *   amount of refreshing fixes it. So the network gets first refusal and the
 *   cached shell only appears when offline.
 *
 *   **Static assets — cache first.** Hashed filenames from the build are
 *   immutable by construction; re-fetching them is pure waste.
 *
 *   **API GETs — network first, cache as fallback.** Balances have to be
 *   current when there is a connection, but showing yesterday's balances
 *   offline is far better than showing an error. Cached responses are tagged so
 *   the client can tell the user what it is looking at.
 *
 * API writes are never cached or replayed here — that is the app's own
 * IndexedDB outbox, which can carry the client-generated ids that make a replay
 * idempotent. A service worker retrying a POST blindly would file the same
 * dinner twice.
 */

const VERSION = "divvy-v1";
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const API_CACHE = `${VERSION}-api`;

/** Enough to boot the app offline; everything else fills in as it is visited. */
const SHELL_URLS = ["/", "/offline", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 during a deploy cannot fail the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      // Take over immediately rather than waiting for every tab to close.
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => !name.startsWith(VERSION)).map((name) => caches.delete(name)),
      );
      // Enable navigation preload where supported: it starts the network
      // request in parallel with worker startup instead of after it.
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Only GET is cacheable. Writes go through the app's outbox.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never touch cross-origin requests, or the exchange-rate lookup ends up
  // served from a stale cache days later.
  if (url.origin !== self.location.origin) return;

  // Receipt images are large, private, and already immutable-cached by the HTTP
  // layer. Keeping them out of the SW cache stops one photo-heavy group from
  // filling the origin's storage quota and evicting the app shell with it.
  if (url.pathname.startsWith("/api/attachments/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(event));
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(request, API_CACHE));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
  }
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  );
}

async function handleNavigation(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) {
      void cachePut(SHELL_CACHE, event.request, preloaded.clone());
      return preloaded;
    }

    const response = await fetch(event.request);
    void cachePut(SHELL_CACHE, event.request, response.clone());
    return response;
  } catch {
    // Offline. Prefer this exact page, then the app root, then the offline
    // page - the root is usually enough because the client renders from its
    // own cached data once it boots.
    const cached =
      (await caches.match(event.request)) ??
      (await caches.match("/")) ??
      (await caches.match("/offline"));

    return (
      cached ??
      new Response(
        "<!doctype html><meta charset=utf-8><title>Offline</title><p>You are offline.",
        { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } },
      )
    );
  }
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) void cachePut(cacheName, request, response.clone());
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) {
      // Tag it so the client can say "showing data from earlier" rather than
      // presenting a stale balance as current.
      const headers = new Headers(cached.headers);
      headers.set("X-Divvy-From-Cache", "1");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }

    return new Response(
      JSON.stringify({
        error: "You're offline. This will load when you're back.",
        code: "offline",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) void cachePut(cacheName, request, response.clone());
    return response;
  } catch {
    return new Response("", { status: 504 });
  }
}

async function cachePut(cacheName, request, response) {
  try {
    // A partial response cannot be stored, and storing an opaque one silently
    // eats quota in ~7MB units.
    if (response.status !== 200 || response.type === "opaque") return;
    const cache = await caches.open(cacheName);
    await cache.put(request, response);
  } catch {
    // Quota exceeded, or the response was already consumed. Not fatal - the
    // request already succeeded; only the caching of it failed.
  }
}
