import webpush from "web-push";
import { prisma } from "@/lib/db";
import { log } from "@/lib/log";
import { formatMoney } from "@/lib/money";
import type { ActivityData } from "@/lib/types";

/**
 * Phone notifications.
 *
 * Every write in the app already records an Activity row, in about twenty
 * places, several inside transactions. Rather than send from each of them,
 * a background job (see jobs.ts) picks up new rows every few seconds and
 * sends from here. Nothing on the save path waits on a push service, and no
 * kind of change can be forgotten.
 *
 * Off unless VAPID keys are set: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, and
 * optionally VAPID_SUBJECT (a mailto: or https: address the push services can
 * contact). Generate a pair with `npx web-push generate-vapid-keys`.
 */

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT || process.env.DIVVY_ORIGIN || "mailto:divvy@localhost";

/** Older than this and an entry is marked done without sending: a server that was down for an hour should not wake everyone with an hour of old news. */
const FRESH_FOR_MS = 10 * 60_000;
const BATCH = 100;

/**
 * The browsers' own push services. A subscription is just a URL the server
 * will later POST to, so accepting any https address would let anyone make
 * this server call hosts of their choosing - including ones on its private
 * network. Only the real services are accepted.
 */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge on Android, most Chromium browsers
  /^android\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /^web\.push\.apple\.com$/, // Safari and home-screen apps on iPhone
  /\.push\.apple\.com$/,
  /\.notify\.windows\.com$/, // Edge on Windows
];

export function isPushServiceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

let configured = false;

export function pushConfigured(): boolean {
  return PUBLIC_KEY.length > 0 && PRIVATE_KEY.length > 0;
}

export function pushPublicKey(): string | null {
  return pushConfigured() ? PUBLIC_KEY : null;
}

function ensureConfigured(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
    configured = true;
  }
  return true;
}

interface PendingActivity {
  id: string;
  type: string;
  groupId: string | null;
  actorPersonId: string;
  targetPersonId: string | null;
  data: string;
  actor: { displayName: string };
  group: { name: string; emoji: string } | null;
  expense: {
    currency: string;
    payers: { personId: string; amount: bigint }[];
    splits: { personId: string; amount: bigint }[];
  } | null;
  settlement: { fromPersonId: string; toPersonId: string; amount: bigint; currency: string } | null;
}

export interface PushMessage {
  title: string;
  body: string;
  url: string;
  /** Collapses repeats about the same thing into one notification. */
  tag: string;
}

/** Who should hear about an entry: the people it concerns, never the person who did it. */
export function recipientsFor(activity: PendingActivity, groupMemberIds: string[]): string[] {
  const ids = new Set<string>();
  switch (activity.type) {
    case "expense.created":
    case "expense.updated":
    case "expense.deleted":
    case "comment.created":
    case "recurrence.fired":
      if (activity.expense) {
        for (const p of activity.expense.payers) ids.add(p.personId);
        for (const s of activity.expense.splits) if (s.amount !== 0n) ids.add(s.personId);
      }
      break;
    case "settlement.created":
    case "settlement.deleted":
      if (activity.settlement) {
        ids.add(activity.settlement.fromPersonId);
        ids.add(activity.settlement.toPersonId);
      }
      break;
    case "nudge.sent":
      if (activity.targetPersonId) ids.add(activity.targetPersonId);
      break;
    case "member.joined":
      for (const id of groupMemberIds) ids.add(id);
      break;
    default:
      break;
  }
  // A repeating expense has no person behind it, so its creator still hears.
  if (activity.type !== "recurrence.fired") ids.delete(activity.actorPersonId);
  return [...ids];
}

/** The words on the notification, from this recipient's point of view. */
export function messageFor(activity: PendingActivity, recipientId: string): PushMessage | null {
  let data: ActivityData = {};
  try {
    data = JSON.parse(activity.data) as ActivityData;
  } catch {
    // An unreadable summary still gets a generic notification below.
  }
  const who = activity.actor.displayName;
  const what = typeof data.description === "string" ? `“${data.description}”` : "an expense";
  const title = activity.group ? `${activity.group.emoji} ${activity.group.name}` : "Divvy";
  const url = activity.groupId ? `/groups/${activity.groupId}` : "/activity";
  const tag = `${activity.type}:${activity.id}`;

  const money = (minor: bigint | string | undefined, currency: string | undefined) =>
    minor !== undefined && currency ? formatMoney(BigInt(minor), currency) : null;

  // What this expense means for the person reading it.
  const stake = (() => {
    if (!activity.expense) return "";
    const paid = activity.expense.payers
      .filter((p) => p.personId === recipientId)
      .reduce((t, p) => t + p.amount, 0n);
    const owed = activity.expense.splits
      .filter((s) => s.personId === recipientId)
      .reduce((t, s) => t + s.amount, 0n);
    const net = paid - owed;
    if (net === 0n) return "";
    const amount = formatMoney(net < 0n ? -net : net, activity.expense.currency);
    return net < 0n ? ` Your share is ${amount}.` : ` You get back ${amount}.`;
  })();

  switch (activity.type) {
    case "expense.created": {
      const total = money(data.amount, data.currency);
      return { title, url, tag, body: `${who} added ${what}${total ? ` (${total})` : ""}.${stake}` };
    }
    case "expense.updated":
      return { title, url, tag, body: `${who} changed ${what}.${stake}` };
    case "expense.deleted":
      return { title, url, tag, body: `${who} deleted ${what}.` };
    case "recurrence.fired": {
      const total = money(data.amount, data.currency);
      return { title, url, tag, body: `${what} was added automatically${total ? ` (${total})` : ""}.${stake}` };
    }
    case "comment.created": {
      const preview = typeof data.preview === "string" ? `: ${data.preview}` : ".";
      return { title, url, tag, body: `${who} commented on ${what}${preview}` };
    }
    case "settlement.created": {
      const s = activity.settlement;
      if (!s) return null;
      const amount = formatMoney(s.amount, s.currency);
      if (s.toPersonId === recipientId) {
        return { title, url, tag, body: s.fromPersonId === activity.actorPersonId ? `${who} paid you ${amount}.` : `${who} saved a payment of ${amount} to you.` };
      }
      return { title, url, tag, body: `${who} saved a payment of ${amount} from you.` };
    }
    case "settlement.deleted":
      return { title, url, tag, body: `${who} removed a payment.` };
    case "nudge.sent": {
      const amount = money(data.amount, data.currency);
      return { title, url, tag, body: `${who} reminded you that you owe ${amount ?? "them money"}.` };
    }
    case "member.joined":
      return { title, url, tag, body: `${who} joined the group.` };
    default:
      return null;
  }
}

/**
 * Sends notifications for new activity. Run by the push job; returns how many
 * were delivered to a push service.
 */
export async function sendPendingNotifications(now = new Date()): Promise<number> {
  const freshSince = new Date(now.getTime() - FRESH_FOR_MS);

  if (!ensureConfigured()) {
    // Nothing can be sent, so keep the backlog from growing.
    await prisma.activity.updateMany({ where: { notifiedAt: null }, data: { notifiedAt: now } });
    return 0;
  }

  await prisma.activity.updateMany({
    where: { notifiedAt: null, createdAt: { lt: freshSince } },
    data: { notifiedAt: now },
  });

  const pending: PendingActivity[] = await prisma.activity.findMany({
    where: { notifiedAt: null },
    orderBy: { createdAt: "asc" },
    take: BATCH,
    select: {
      id: true,
      type: true,
      groupId: true,
      actorPersonId: true,
      targetPersonId: true,
      data: true,
      actor: { select: { displayName: true } },
      group: { select: { name: true, emoji: true } },
      expense: {
        select: {
          currency: true,
          payers: { select: { personId: true, amount: true } },
          splits: { select: { personId: true, amount: true } },
        },
      },
      settlement: { select: { fromPersonId: true, toPersonId: true, amount: true, currency: true } },
    },
  });
  if (pending.length === 0) return 0;

  // Claimed before sending: a notification missed is better than one sent
  // twice by a job that ran again after a slow push service.
  await prisma.activity.updateMany({
    where: { id: { in: pending.map((a) => a.id) } },
    data: { notifiedAt: now },
  });

  let delivered = 0;
  for (const activity of pending) {
    const members =
      activity.type === "member.joined" && activity.groupId
        ? (
            await prisma.membership.findMany({
              where: { groupId: activity.groupId, leftAt: null },
              select: { personId: true },
            })
          ).map((m) => m.personId)
        : [];
    const recipients = recipientsFor(activity, members);
    if (recipients.length === 0) continue;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { personId: { in: recipients } },
    });
    for (const sub of subscriptions) {
      const message = messageFor(activity, sub.personId);
      if (!message) continue;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(message),
          { TTL: 60 * 60, urgency: "normal" },
        );
        delivered++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The phone turned notifications off or the app was removed.
          await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
        } else {
          log.warn("push failed", { status, type: activity.type });
        }
      }
    }
  }
  return delivered;
}
