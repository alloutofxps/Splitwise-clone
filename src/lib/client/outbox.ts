"use client";

/**
 * The offline outbox.
 *
 * You add an expense in a restaurant basement with no signal. It has to appear
 * instantly, survive the app being closed, and file itself when the phone finds
 * a network - without ever filing twice.
 *
 * The design that makes this tractable is upstream of here: every mutation
 * carries a client-generated row id, so replaying one is safe by construction.
 * The server recognises the duplicate key and returns the existing row. That
 * turns "exactly once" - which is hard - into "at least once plus idempotency",
 * which is easy.
 *
 * Queue lives in IndexedDB rather than localStorage because it survives more
 * aggressive eviction and does not block the main thread on write.
 */

import { openDB, type IDBPDatabase } from "idb";
import { ApiError, request } from "./api";

const DB_NAME = "divvy";
const DB_VERSION = 2;
const STORE = "outbox";
/**
 * Where a mutation goes when the server refuses it outright.
 *
 * It cannot stay in the outbox - retrying a 422 forever blocks every mutation
 * queued behind it - but it must not simply disappear either. Somebody typed
 * that expense; if it is not going to exist, they have to be told, because the
 * alternative is discovering it from a balance that does not match the receipt.
 */
const REJECTED_STORE = "rejected";

export interface QueuedMutation {
  id: string;
  path: string;
  method: "POST" | "PATCH" | "PUT" | "DELETE";
  body: unknown;
  /** What the UI should say while this is pending. */
  label: string;
  createdAt: number;
  attempts: number;
  lastError?: string;
}

export interface RejectedMutation extends QueuedMutation {
  /** The server's own words, which are written to be shown to a user. */
  reason: string;
  status: number;
  rejectedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
        }
        // Added in v2. Existing installs run this branch alone.
        if (!database.objectStoreNames.contains(REJECTED_STORE)) {
          const store = database.createObjectStore(REJECTED_STORE, { keyPath: "id" });
          store.createIndex("rejectedAt", "rejectedAt");
        }
      },
    });
  }
  return dbPromise;
}

/** IndexedDB is unavailable in private-mode Safari and some embedded webviews. */
function supported(): boolean {
  return typeof indexedDB !== "undefined";
}

export async function enqueue(mutation: Omit<QueuedMutation, "attempts" | "createdAt">) {
  if (!supported()) return;
  const database = await db();
  await database.put(STORE, {
    ...mutation,
    createdAt: Date.now(),
    attempts: 0,
  } satisfies QueuedMutation);
  notify();
}

export async function pending(): Promise<QueuedMutation[]> {
  if (!supported()) return [];
  const database = await db();
  const all = (await database.getAll(STORE)) as QueuedMutation[];
  return all.sort((a, b) => a.createdAt - b.createdAt);
}

export async function remove(id: string) {
  if (!supported()) return;
  const database = await db();
  await database.delete(STORE, id);
  notify();
}

export async function clear() {
  if (!supported()) return;
  const database = await db();
  await database.clear(STORE);
  notify();
}

// ---------------------------------------------------------------------------
// The dead-letter store
// ---------------------------------------------------------------------------

export async function rejected(): Promise<RejectedMutation[]> {
  if (!supported()) return [];
  const database = await db();
  const all = (await database.getAll(REJECTED_STORE)) as RejectedMutation[];
  return all.sort((a, b) => a.rejectedAt - b.rejectedAt);
}

/** Acknowledges a rejection: the user has read it and accepts the loss. */
export async function discardRejected(id: string) {
  if (!supported()) return;
  const database = await db();
  await database.delete(REJECTED_STORE, id);
  notify();
}

export async function discardAllRejected() {
  if (!supported()) return;
  const database = await db();
  await database.clear(REJECTED_STORE);
  notify();
}

/**
 * Puts a rejected mutation back in the queue.
 *
 * Worth offering because a rejection is not always permanent in the way the
 * status code implies: a 403 on an expense filed while you were being removed
 * from a group starts working again once somebody adds you back. The attempt
 * counter resets, since the reason it failed has changed.
 */
export async function retryRejected(id: string) {
  if (!supported()) return;
  const database = await db();
  const entry = (await database.get(REJECTED_STORE, id)) as RejectedMutation | undefined;
  if (!entry) return;

  const { reason: _reason, status: _status, rejectedAt: _rejectedAt, ...mutation } = entry;
  await database.put(STORE, { ...mutation, attempts: 0 } satisfies QueuedMutation);
  await database.delete(REJECTED_STORE, id);
  notify();
  void flush();
}

// ---------------------------------------------------------------------------
// Flushing
// ---------------------------------------------------------------------------

/** Give up after this many tries; the entry is kept so the user can retry. */
const MAX_ATTEMPTS = 6;

let flushing = false;

export interface FlushResult {
  sent: number;
  failed: number;
  remaining: number;
}

/**
 * A 4xx the server will answer differently later.
 *
 * 429 is the one that matters: it is a 4xx, but the whole meaning of it is
 * "ask again shortly". Dead-lettering a rate-limited mutation would throw away
 * an expense because the phone reconnected and flushed too eagerly.
 */
function isRetryable(status: number): boolean {
  return status === 408 || status === 425 || status === 429;
}

/**
 * Sends everything queued, oldest first.
 *
 * Order matters: a comment on an expense must not be sent before the expense
 * itself, so the queue is strictly sequential and stops at the first entry that
 * fails for a network reason.
 *
 * A *rejected* entry (a 4xx that will not change) is different: it can never
 * succeed, so it must not stay in the queue blocking everything behind it. It
 * moves to the dead-letter store instead of being dropped, and the banner shows
 * it with the server's own explanation. Silently discarding it - which is what
 * this used to do, with a console.warn nobody was going to read - means the
 * user finds out from a balance that no longer matches the receipt in their
 * hand.
 */
export async function flush(): Promise<FlushResult> {
  if (flushing || !supported()) return { sent: 0, failed: 0, remaining: 0 };
  flushing = true;

  let sent = 0;
  let failed = 0;

  try {
    const queue = await pending();

    for (const mutation of queue) {
      try {
        await request(mutation.path, {
          method: mutation.method,
          body: mutation.body,
        });
        await remove(mutation.id);
        sent++;
      } catch (error) {
        if (error instanceof ApiError && error.isOffline) {
          // Still no network. Stop; the rest stay queued in order.
          break;
        }

        if (
          error instanceof ApiError &&
          error.status >= 400 &&
          error.status < 500 &&
          !isRetryable(error.status)
        ) {
          // The server rejected it outright - a stale group, a deleted member,
          // a validation failure. Retrying cannot help, so it is set aside for
          // the user to see rather than left to block the queue.
          const database = await db();
          await database.put(REJECTED_STORE, {
            ...mutation,
            attempts: mutation.attempts + 1,
            reason: error.message,
            status: error.status,
            rejectedAt: Date.now(),
          } satisfies RejectedMutation);
          await database.delete(STORE, mutation.id);
          failed++;
          continue;
        }

        const attempts = mutation.attempts + 1;
        const database = await db();
        if (attempts >= MAX_ATTEMPTS) {
          await database.put(STORE, {
            ...mutation,
            attempts,
            lastError: error instanceof Error ? error.message : "Unknown error",
          });
          failed++;
          break;
        }
        await database.put(STORE, { ...mutation, attempts });
        break;
      }
    }
  } finally {
    flushing = false;
    notify();
  }

  return { sent, failed, remaining: (await pending()).length };
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

/**
 * Starts flushing whenever the network comes back or the app is foregrounded.
 *
 * `visibilitychange` matters as much as `online`: a phone that slept through
 * the reconnection never fires an online event, and the user is standing there
 * looking at a spinner.
 *
 * `onSettled` fires after a flush that changed anything - delivered or refused -
 * so the caller can bring the cache back in line with the server.
 */
export function startAutoFlush(onSettled?: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const attempt = () => {
    if (!navigator.onLine) return;
    void flush().then((result) => {
      // Fires for a rejection as much as for a delivery, and both need it. A
      // delivered mutation was until now only on screen as an optimistic row;
      // a rejected one is on screen as a row for something that will never
      // exist, with a balance to match. Either way the cache is out of step
      // with the server, and nothing else would notice - the flush goes
      // straight to `request`, bypassing the query cache entirely.
      if (result.sent > 0 || result.failed > 0) onSettled?.();
    });
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") attempt();
  };

  window.addEventListener("online", attempt);
  document.addEventListener("visibilitychange", onVisible);

  // A periodic sweep catches the case where the browser reports online but the
  // connection is a captive portal that only starts working a minute later.
  const timer = window.setInterval(attempt, 30_000);
  attempt();

  return () => {
    window.removeEventListener("online", attempt);
    document.removeEventListener("visibilitychange", onVisible);
    window.clearInterval(timer);
  };
}
