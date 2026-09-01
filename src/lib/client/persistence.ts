"use client";

/**
 * Persistent storage.
 *
 * The outbox is not a cache. A queued expense exists in exactly one place —
 * IndexedDB on this phone — until the network comes back, so an eviction under
 * storage pressure is silent data loss of something the user typed and watched
 * appear on screen. `navigator.storage.persist()` is the only lever the
 * platform gives us against that, and it costs one call.
 *
 * The browsers differ in how they answer, and all three behaviours are fine:
 *
 *   Chrome/Edge grant it silently once the app clears an engagement bar —
 *   being installed is usually enough, which is why this is asked again after
 *   installation rather than only on first run.
 *   Firefox shows a permission prompt.
 *   Safari grants it on add-to-home-screen and refuses otherwise; it never
 *   prompts, so a `false` there is a normal answer and not an error.
 *
 * Nothing is gated on the result. A refusal makes eviction possible, not
 * imminent, and an app that nagged about it would be worse than one that
 * quietly asked once and got on with it.
 */

export interface StorageStatus {
  /** Whether the origin's storage is exempt from eviction. */
  persisted: boolean;
  /** Whether the browser implements the Storage API at all. */
  supported: boolean;
  /** Bytes currently used by this origin, when the browser will say. */
  usage: number | null;
  /** Bytes this origin may use, when the browser will say. */
  quota: number | null;
}

const UNSUPPORTED: StorageStatus = {
  persisted: false,
  supported: false,
  usage: null,
  quota: null,
};

function api(): StorageManager | null {
  if (typeof navigator === "undefined") return null;
  const storage = navigator.storage as StorageManager | undefined;
  // `persist` is absent in Safari before 15.2 and in every WebView that has
  // partitioned storage; `estimate` can be present without it.
  if (!storage || typeof storage.persisted !== "function") return null;
  return storage;
}

/**
 * Asks for persistence if it has not already been granted.
 *
 * Idempotent and cheap: when the answer is already yes, this is one call and no
 * prompt. Safe to invoke on every launch.
 */
export async function requestPersistence(): Promise<StorageStatus> {
  const storage = api();
  if (!storage) return UNSUPPORTED;

  try {
    let persisted = await storage.persisted();

    if (!persisted && typeof storage.persist === "function") {
      persisted = await storage.persist();
    }

    return { ...(await measure(storage)), persisted, supported: true };
  } catch {
    // A prompt dismissed, a permissions policy that forbids it, or a WebView
    // that throws on the call. None of these are worth a message: the app
    // works identically, it is only less protected from eviction.
    return UNSUPPORTED;
  }
}

/** Reads the current status without ever triggering a prompt. */
export async function storageStatus(): Promise<StorageStatus> {
  const storage = api();
  if (!storage) return UNSUPPORTED;

  try {
    return { ...(await measure(storage)), persisted: await storage.persisted(), supported: true };
  } catch {
    return UNSUPPORTED;
  }
}

async function measure(storage: StorageManager): Promise<{ usage: number | null; quota: number | null }> {
  if (typeof storage.estimate !== "function") return { usage: null, quota: null };
  try {
    const { usage, quota } = await storage.estimate();
    return { usage: usage ?? null, quota: quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}
