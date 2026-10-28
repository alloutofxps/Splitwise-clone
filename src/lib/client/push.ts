import { api } from "./api";

/**
 * Turning phone notifications on and off for this browser.
 *
 * On iPhone, web notifications only exist once Divvy is added to the home
 * screen (iOS 16.4 and later); in a Safari tab `PushManager` is missing, which
 * is what `pushSupport` reports as "install".
 */

export type PushSupport = "ready" | "install" | "unsupported" | "blocked";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "unsupported";
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (!("PushManager" in window) || !("Notification" in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    return ios && !standalone ? "install" : "unsupported";
  }
  if (Notification.permission === "denied") return "blocked";
  return "ready";
}

async function registration(): Promise<ServiceWorkerRegistration> {
  return navigator.serviceWorker.ready;
}

/** Whether this browser is currently set up to receive Divvy notifications. */
export async function pushEnabled(): Promise<boolean> {
  if (pushSupport() !== "ready" || Notification.permission !== "granted") return false;
  const sub = await (await registration()).pushManager.getSubscription();
  return Boolean(sub);
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Whether a subscription was made with the server's current key.
 *
 * The key can change (it was replaced after Railway's October security
 * incident). A subscription made with the old one keeps looking fine on the
 * phone, while every notification sent to it is refused, so the phone shows
 * notifications as on and never gets any.
 */
function madeWith(sub: PushSubscription, publicKey: string): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return true;
  const a = new Uint8Array(current);
  const b = keyBytes(publicKey);
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

/** Asks permission and registers this phone. Resolves to whether it worked. */
export async function enablePush(): Promise<"on" | "denied" | "unavailable"> {
  if (pushSupport() !== "ready") return "unavailable";
  const { publicKey } = await api.get<{ publicKey: string | null }>("/api/push");
  if (!publicKey) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  await subscribeWith(publicKey);
  return "on";
}

/** Subscribes with `publicKey`, replacing one made with another key. */
async function subscribeWith(publicKey: string): Promise<void> {
  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !madeWith(sub, publicKey)) {
    await api.del("/api/push", { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  await api.post("/api/push", sub.toJSON());
}

/**
 * On opening the app: if notifications are on but were set up with an old
 * key, set them up again with the current one. Permission is already given,
 * so nothing is asked; with notifications off, nothing happens.
 */
export async function refreshPushKey(): Promise<void> {
  if (pushSupport() !== "ready" || Notification.permission !== "granted") return;
  const existing = await (await registration()).pushManager.getSubscription();
  if (!existing) return;
  const { publicKey } = await api.get<{ publicKey: string | null }>("/api/push");
  if (!publicKey || madeWith(existing, publicKey)) return;
  await subscribeWith(publicKey);
}

/** Stops notifications on this phone, here and on the server. */
export async function disablePush(): Promise<void> {
  if (pushSupport() === "unsupported") return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.del("/api/push", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}
