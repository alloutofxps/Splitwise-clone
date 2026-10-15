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

/** Asks permission and registers this phone. Resolves to whether it worked. */
export async function enablePush(): Promise<"on" | "denied" | "unavailable"> {
  if (pushSupport() !== "ready") return "unavailable";
  const { publicKey } = await api.get<{ publicKey: string | null }>("/api/push");
  if (!publicKey) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const reg = await registration();
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api.post("/api/push", sub.toJSON());
  return "on";
}

/** Stops notifications on this phone, here and on the server. */
export async function disablePush(): Promise<void> {
  if (pushSupport() === "unsupported") return;
  const sub = await (await registration()).pushManager.getSubscription();
  if (!sub) return;
  await api.del("/api/push", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => false);
}
