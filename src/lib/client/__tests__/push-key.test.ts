import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * When the server's notification key changes, a phone with notifications on
 * sets itself up again with the new key on its next launch, without asking;
 * a phone with them off, or already on the new key, is left alone.
 */

const b64 = (bytes: number[]) => Buffer.from(bytes).toString("base64url");
const OLD = [4, 1, 1, 1];
const NEW = [4, 2, 2, 2];

let current: { endpoint: string; key: number[] } | null;
let calls: string[];
let permission: NotificationPermission;

function fakeSubscription(endpoint: string, key: number[]) {
  return {
    endpoint,
    options: { applicationServerKey: new Uint8Array(key).buffer },
    toJSON: () => ({ endpoint, keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: () => {
      calls.push(`unsubscribe ${endpoint}`);
      current = null;
      return Promise.resolve(true);
    },
  };
}

beforeEach(() => {
  calls = [];
  permission = "granted";
  current = { endpoint: "https://push.example/old", key: OLD };
  const pushManager = {
    getSubscription: () => Promise.resolve(current ? fakeSubscription(current.endpoint, current.key) : null),
    subscribe: ({ applicationServerKey }: { applicationServerKey: Uint8Array }) => {
      const key = [...applicationServerKey];
      calls.push(`subscribe ${key.join(",")}`);
      current = { endpoint: "https://push.example/new", key };
      return Promise.resolve(fakeSubscription(current.endpoint, key));
    },
  };
  vi.stubGlobal("window", { matchMedia: () => ({ matches: true }), PushManager: {}, Notification: {} });
  vi.stubGlobal("navigator", { serviceWorker: { ready: Promise.resolve({ pushManager }) }, userAgent: "test" });
  vi.stubGlobal("Notification", { get permission() { return permission; } });
  vi.stubGlobal("fetch", (path: string, init?: { method?: string; body?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const body = path === "/api/push" && (init?.method ?? "GET") === "GET" ? { publicKey: b64(NEW) } : { ok: true };
    return Promise.resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }));
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("notifications after the server's key changes", () => {
  it("set up again with the new key, dropping the old one here and on the server", async () => {
    const { refreshPushKey } = await import("../push");
    await refreshPushKey();
    expect(calls).toEqual([
      "GET /api/push",
      "DELETE /api/push",
      "unsubscribe https://push.example/old",
      `subscribe ${NEW.join(",")}`,
      "POST /api/push",
    ]);
  });

  it("are left alone when already on the current key", async () => {
    current = { endpoint: "https://push.example/new", key: NEW };
    const { refreshPushKey } = await import("../push");
    await refreshPushKey();
    expect(calls).toEqual(["GET /api/push"]);
  });

  it("aren't touched, or asked about, when they're off", async () => {
    current = null;
    const { refreshPushKey } = await import("../push");
    await refreshPushKey();
    expect(calls).toEqual([]);
    permission = "default";
    current = { endpoint: "https://push.example/old", key: OLD };
    await refreshPushKey();
    expect(calls).toEqual([]);
  });
});
