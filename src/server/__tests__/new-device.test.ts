import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Divvy was opened on a new device" goes to the person's other devices with
 * notifications on, never to the new one, and a device that has gone is
 * dropped (OWASP ASVS 2.2.3).
 */

const sent: { endpoint: string; message: { title: string; body: string; url: string; tag: string } }[] = [];
const deleted: string[] = [];
let lastWhere: unknown;
const subscriptions = [
  { id: "s-laptop", personId: "ana", sessionId: "laptop", endpoint: "https://push.example/laptop", p256dh: "k", auth: "a" },
  { id: "s-old", personId: "ana", sessionId: "old-phone", endpoint: "https://push.example/gone", p256dh: "k", auth: "a" },
  { id: "s-new", personId: "ana", sessionId: "new-phone", endpoint: "https://push.example/new", p256dh: "k", auth: "a" },
];

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: () => {},
    sendNotification: (sub: { endpoint: string }, payload: string) => {
      if (sub.endpoint.endsWith("/gone")) return Promise.reject(Object.assign(new Error("gone"), { statusCode: 410 }));
      sent.push({ endpoint: sub.endpoint, message: JSON.parse(payload) as (typeof sent)[number]["message"] });
      return Promise.resolve();
    },
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    pushSubscription: {
      findMany: ({ where }: { where: { personId: string; sessionId: { not: string } } }) => {
        lastWhere = where;
        return Promise.resolve(subscriptions.filter((s) => s.personId === where.personId && s.sessionId !== where.sessionId.not));
      },
      delete: ({ where }: { where: { id: string } }) => {
        deleted.push(where.id);
        return Promise.resolve();
      },
    },
  },
}));

beforeEach(() => {
  sent.length = 0;
  deleted.length = 0;
  vi.resetModules();
});

describe("telling a person's other devices about a new one", () => {
  it("does nothing when the server has no notification keys", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const { notifyNewDevice } = await import("../push");
    expect(await notifyNewDevice("ana", "new-phone", "Safari on iPhone")).toBe(0);
    expect(sent).toEqual([]);
  });

  it("goes to the other devices, not the new one, and drops one that's gone", async () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "public");
    vi.stubEnv("VAPID_PRIVATE_KEY", "private");
    const { notifyNewDevice } = await import("../push");
    expect(await notifyNewDevice("ana", "new-phone", "Safari on iPhone")).toBe(1);
    expect(lastWhere).toEqual({ personId: "ana", sessionId: { not: "new-phone" } });
    expect(sent.map((s) => s.endpoint)).toEqual(["https://push.example/laptop"]);
    expect(sent[0].message).toEqual({
      title: "Divvy was opened on a new device",
      body: "Safari on iPhone. If that wasn't you, remove it under You, then Your devices.",
      url: "/account",
      tag: "new-device-new-phone",
    });
    expect(deleted).toEqual(["s-old"]);
  });
});
