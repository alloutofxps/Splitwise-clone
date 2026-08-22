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
const DB_VERSION = 1;
const STORE = "outbox";

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

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt");
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
 * Sends everything queued, oldest first.
 *
 * Order matters: a comment on an expense must not be sent before the expense
 * itself, so the queue is strictly sequential and stops at the first entry that
 * fails for a network reason. A *rejected* entry (a 4xx) is different - it will
 * never succeed, so it is dropped rather than blocking everything behind it.
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

        if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
          // The server rejected it outright - a stale group, a deleted member,
          // a validation failure. Retrying cannot help, and keeping it would
          // block every later mutation forever.
          console.warn("[divvy] dropping rejected offline mutation", mutation, error);
          await remove(mutation.id);
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
 */
export function startAutoFlush(): () => void {
  if (typeof window === "undefined") return () => {};

  const attempt = () => {
    if (navigator.onLine) void flush();
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
