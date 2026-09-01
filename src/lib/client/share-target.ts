"use client";

/**
 * Receiving a receipt from the OS share sheet.
 *
 * A share target cannot hand its payload to the page directly: the OS performs
 * a real `POST` navigation, and a page cannot read the body of the navigation
 * that created it. The standard shape is therefore a relay — the service worker
 * intercepts the POST, parks the files somewhere both sides can see, and
 * redirects to a normal GET the app can boot from.
 *
 * The Cache API is that somewhere. IndexedDB would also work, but the worker
 * already owns a cache and a `Response` holds a `Blob` without copying it
 * through a structured clone, which matters when the payload is a 6 MB photo.
 *
 * The handshake is deliberately one-shot. `take` reads and deletes in the same
 * call, so a refresh cannot attach the same receipt twice, and a stash the user
 * abandoned expires rather than surfacing on a launch tomorrow with no context.
 *
 * Keep the three constants below in step with `public/sw.js`, which is plain
 * JavaScript served as a static file and so cannot import them.
 */

const SHARE_CACHE = "divvy-share";
const SHARE_INDEX = "/__shared/index.json";
/** Long enough to survive a slow boot, short enough that a forgotten share dies. */
const MAX_AGE_MS = 10 * 60 * 1000;

/** The query flag the worker redirects with. */
export const SHARE_FLAG = "share";

interface SharedIndexEntry {
  key: string;
  name: string;
  type: string;
}

interface SharedIndex {
  files: SharedIndexEntry[];
  title: string;
  text: string;
  url: string;
  at: number;
}

export interface SharedPayload {
  files: File[];
  /** Whatever text came with the share, usable as a description. */
  note: string;
}

function supported(): boolean {
  return typeof caches !== "undefined";
}

/**
 * Reads the parked share and clears it.
 *
 * Returns null for every non-case — no worker, nothing parked, a stash too old,
 * a cache that will not open — because the caller's only sensible response to
 * all of them is the same: open an empty composer.
 */
export async function takeSharedPayload(): Promise<SharedPayload | null> {
  if (!supported()) return null;

  let cache: Cache;
  try {
    cache = await caches.open(SHARE_CACHE);
  } catch {
    return null;
  }

  try {
    const indexResponse = await cache.match(SHARE_INDEX);
    if (!indexResponse) return null;

    const index = (await indexResponse.json()) as SharedIndex;

    // An expired stash is dropped whole, note included. Returning just the text
    // would pre-fill a composer days later with the description of a share the
    // user abandoned - which is worse than nothing, because it looks deliberate.
    if (Date.now() - index.at > MAX_AGE_MS) {
      await clearShared();
      return null;
    }

    const files: File[] = [];
    for (const entry of index.files ?? []) {
      const response = await cache.match(entry.key);
      // A file named in the index but absent from the cache: the write was
      // interrupted, or the entry was evicted. Salvage the rest rather than
      // failing the whole share.
      if (!response) continue;
      const blob = await response.blob();
      files.push(new File([blob], entry.name, { type: entry.type || blob.type }));
    }

    // Read before clearing, cleared unconditionally: a stash that failed to
    // parse must still go, or it is retried identically on every launch.
    await clearShared();

    // A share with text and no file is a real share - "Dinner at Luigi's" out
    // of a notes app - and becomes the description.
    const note = (index.title || index.text || "").trim().slice(0, 120);
    if (files.length === 0 && !note) return null;
    return { files, note };
  } catch {
    // A truncated or corrupt stash. Drop it rather than leaving it to fail
    // identically on the next launch.
    await clearShared();
    return null;
  }
}

export async function clearShared(): Promise<void> {
  if (!supported()) return;
  try {
    await caches.delete(SHARE_CACHE);
  } catch {
    // Nothing to do: the worst case is that the stash expires on its own.
  }
}
