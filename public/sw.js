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

/**
 * The build this worker belongs to.
 *
 * Read from the script's own URL, which the app registers as `/sw.js?v=<build>`.
 * A hard-coded constant would be a bug that only appears on the second deploy:
 * the cache names would never change, so an API response cached against last
 * week's schema would outlive the code that could read it, and no amount of
 * reloading would clear it. Deriving it from the URL also guarantees the
 * browser sees a byte-different script and runs its update check at all.
 */
const VERSION = `divvy-${new URL(self.location.href).searchParams.get("v") || "dev"}`;
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const API_CACHE = `${VERSION}-api`;

/**
 * Where a share from the OS is parked between the POST and the GET that follows
 * it. Deliberately unversioned: a share in flight during an update must survive
 * the activate that drops every other cache. Kept in step with
 * `src/lib/client/share-target.ts`, which reads it.
 */
const SHARE_CACHE = "divvy-share";
const SHARE_INDEX = "/__shared/index.json";
const SHARE_PREFIX = "/__shared/file-";
const MAX_SHARED_FILES = 6;

/** Enough to boot the app offline; everything else fills in as it is visited. */
const SHELL_URLS = ["/", "/offline", "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 during a deploy cannot fail the whole install.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      // Deliberately no skipWaiting() here.
      //
      // Taking over immediately would replace the running app's worker while
      // someone is halfway through entering an expense, and — because the
      // client reloads on controllerchange — would throw that entry away. It
      // also made the "a new version is ready" toast unreachable: a worker that
      // skips waiting never enters the waiting state the toast is bound to. The
      // update is offered instead, and the message handler below performs it
      // when the user accepts.
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => !name.startsWith(VERSION) && name !== SHARE_CACHE)
          .map((name) => caches.delete(name)),
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
  const url = new URL(request.url);

  // The share target is the one POST this worker handles, and it must be
  // checked before the method guard below.
  if (request.method === "POST" && url.pathname === "/share-target") {
    event.respondWith(handleShare(event));
    return;
  }

  // Only GET is cacheable. Writes go through the app's outbox.
  if (request.method !== "GET") return;

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

// ---------------------------------------------------------------------------
// Share target
// ---------------------------------------------------------------------------

/**
 * Receives a receipt shared from the OS.
 *
 * The share arrives as a real POST navigation, whose body the destination page
 * cannot read — so the payload is parked in a cache and the browser is sent on
 * to a plain GET that the app boots from and picks the files up on.
 *
 * The redirect is issued whatever happens. A share that fails to park still has
 * to land somewhere sensible: opening an empty composer is a recoverable
 * annoyance, whereas a browser error page on a POST it cannot retry is not.
 */
async function handleShare(event) {
  try {
    const form = await event.request.formData();
    const cache = await caches.open(SHARE_CACHE);

    // Drop anything left from an earlier share before writing this one, or an
    // abandoned stash would be merged into the next receipt.
    await Promise.all((await cache.keys()).map((request) => cache.delete(request)));

    const shared = form
      .getAll("receipts")
      .filter((value) => typeof value === "object" && value !== null && "size" in value && value.size > 0)
      .slice(0, MAX_SHARED_FILES);

    const files = [];

    for (let index = 0; index < shared.length; index += 1) {
      const file = shared[index];
      const key = `${SHARE_PREFIX}${index}`;
      await cache.put(
        key,
        new Response(file, {
          headers: { "Content-Type": file.type || "application/octet-stream" },
        }),
      );
      files.push({
        key,
        name: file.name || `receipt-${index + 1}`,
        type: file.type || "application/octet-stream",
      });
    }

    await cache.put(
      SHARE_INDEX,
      new Response(
        JSON.stringify({
          files,
          title: String(form.get("title") ?? ""),
          text: String(form.get("text") ?? ""),
          url: String(form.get("url") ?? ""),
          at: Date.now(),
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
    );
  } catch {
    // Quota exhausted, or a payload this browser will not hand over. The
    // composer opens empty rather than the share failing outright.
  }

  return Response.redirect("/?share=1", 303);
}
