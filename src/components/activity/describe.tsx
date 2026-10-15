import * as React from "react";
import {
  ArrowLeftRight,
  BellRing,
  MessageSquare,
  Pencil,
  Receipt,
  Repeat,
  Trash2,
  Undo2,
  UserPlus,
  Users,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import type { ActivityDto, PersonDto } from "@/lib/types";

/**
 * Activity entries as words, shared by the Activity screen and Home's "Needs
 * you", so the same event never reads two different ways.
 */

/**
 * What an entry did to the viewer's balance, for the right-hand side of a row:
 * "you owe €21" or "you lent €72". Null when it didn't touch them.
 */
export function activityEffect(activity: ActivityDto): { text: string; owed: boolean } | null {
  const net = activity.data.yourNet;
  const currency = activity.data.currency;
  if (!net || !currency || !activity.type.startsWith("expense.")) return null;
  const value = BigInt(net);
  if (value === 0n) return null;
  if (activity.type === "expense.deleted") return null;
  return value > 0n
    ? { text: `you lent ${formatMoney(value, currency)}`, owed: true }
    : { text: `you owe ${formatMoney(-value, currency)}`, owed: false };
}

/**
 * Turns an event into a sentence.
 *
 * Amounts come from the stored snapshot rather than the live record, which is
 * the whole reason a deleted expense still says how much it was for.
 */
export function describeActivity(
  activity: ActivityDto,
  actorName: string,
  meId: string,
  people: Map<string, PersonDto>,
): {
  icon: React.ReactNode;
  tone: "positive" | "negative" | "neutral" | "brand" | "warning";
  sentence: React.ReactNode;
} {
  const data = activity.data;
  const amount =
    data.amount && data.currency
      ? formatMoney(BigInt(data.amount), data.currency)
      : null;

  const strong = (text: string) => <strong className="font-medium text-text">{text}</strong>;

  switch (activity.type) {
    case "expense.created":
      return {
        icon: <Receipt className="size-[17px]" />,
        tone: "brand",
        sentence: (
          <>
            {strong(actorName)} added {strong(String(data.description ?? "an expense"))}
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "expense.updated": {
      const changes = Array.isArray(data.changes) ? (data.changes) : [];
      return {
        icon: <Pencil className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)}{" "}
            {changes.length > 0 ? changes.join(" and ") : "edited"} on{" "}
            {strong(String(data.description ?? "an expense"))}
          </>
        ),
      };
    }

    case "expense.deleted":
      return {
        icon: <Trash2 className="size-[16px]" />,
        tone: "negative",
        sentence: (
          <>
            {strong(actorName)} deleted {strong(String(data.description ?? "an expense"))}
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "expense.restored":
      return {
        icon: <Undo2 className="size-[16px]" />,
        tone: "brand",
        sentence: (
          <>
            {strong(actorName)} restored {strong(String(data.description ?? "an expense"))}
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "settlement.restored":
      return {
        icon: <Undo2 className="size-[16px]" />,
        tone: "brand",
        sentence: (
          <>
            {strong(actorName)} restored a payment
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "group.updated": {
      // The route stores what changed; without this the entry fell through to
      // "made a change", which is true of every entry in the feed.
      const changes = Array.isArray(data.changes) ? data.changes : [];
      return {
        icon: <Pencil className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)}{" "}
            {changes.length > 0 ? changes.join(" and ") : "changed the settings"} in{" "}
            {strong(String(data.groupName ?? "the group"))}
          </>
        ),
      };
    }

    case "settlement.created": {
      const from = data.fromPersonId as string | undefined;
      const to = data.toPersonId as string | undefined;
      const fromName = from === meId ? "You" : (people.get(from ?? "")?.displayName ?? "Someone");
      const toName = to === meId ? "you" : (people.get(to ?? "")?.displayName ?? "someone");
      return {
        icon: <ArrowLeftRight className="size-[16px]" />,
        tone: "positive",
        sentence: (
          <>
            {strong(fromName)} paid {strong(toName)}
            {amount ? <> <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };
    }

    case "settlement.deleted":
      return {
        icon: <ArrowLeftRight className="size-[16px]" />,
        tone: "negative",
        sentence: <>{strong(actorName)} removed a payment{amount ? <> of <span className="tabular">{amount}</span></> : null}</>,
      };

    case "comment.created":
      return {
        icon: <MessageSquare className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)} commented on {strong(String(data.description ?? "an expense"))}
            {/*
              `ActivityData` is an open bag of `unknown`, so this is checked
              rather than coerced: a payload shape that changed under us should
              drop the quote line, not render "[object Object]" inside quotes.
            */}
            {typeof data.preview === "string" && data.preview ? (
              <span className="mt-0.5 block truncate text-body text-muted">
                &ldquo;{data.preview}&rdquo;
              </span>
            ) : null}
          </>
        ),
      };

    case "member.joined":
      return {
        icon: <UserPlus className="size-[16px]" />,
        tone: "brand",
        sentence: <>{strong(actorName)} joined {strong(String(data.groupName ?? "the group"))}</>,
      };

    case "member.added": {
      const other = people.get((data.otherPersonId as string) ?? "");
      return {
        icon: <UserPlus className="size-[16px]" />,
        tone: "neutral",
        sentence: (
          <>
            {strong(actorName)} added {strong(other?.displayName ?? "someone")}
          </>
        ),
      };
    }

    case "member.merged": {
      const target = people.get(typeof data.personId === "string" ? data.personId : "");
      const was = typeof data.ghostName === "string" ? data.ghostName : null;
      // The name is stored on the entry as well as looked up, because the
      // placeholder half of it no longer exists to be looked up at all.
      const now =
        target?.displayName ?? (typeof data.name === "string" ? data.name : "someone");
      return {
        icon: <UserPlus className="size-[16px]" />,
        tone: "neutral",
        // Both names, when they differ, because a merge between two spellings
        // of one person is exactly the case somebody scrolls back to check.
        sentence:
          was && was !== now ? (
            <>
              {strong(actorName)} moved {strong(was)}&rsquo;s expenses to {strong(now)}
            </>
          ) : (
            <>
              {strong(actorName)} moved an added name&rsquo;s expenses to {strong(now)}
            </>
          ),
      };
    }

    case "member.left":
    case "member.removed": {
      const other = people.get((data.otherPersonId as string) ?? "");
      return {
        icon: <Users className="size-[16px]" />,
        tone: "neutral",
        sentence:
          activity.type === "member.left" ? (
            <>{strong(actorName)} left the group</>
          ) : (
            <>{strong(actorName)} removed {strong(other?.displayName ?? "someone")}</>
          ),
      };
    }

    case "recurrence.fired":
      return {
        icon: <Repeat className="size-[16px]" />,
        tone: "brand",
        sentence: (
          <>
            {strong(String(data.description ?? "A repeating expense"))} posted automatically
            {amount ? <> · <span className="tabular">{amount}</span></> : null}
          </>
        ),
      };

    case "recurrence.paused":
      return {
        icon: <Repeat className="size-[16px]" />,
        tone: "warning",
        sentence: (
          <>
            {strong(String(data.description ?? "A repeating expense"))} was paused
            {typeof data.reason === "string" && data.reason ? <> · {data.reason}</> : null}
          </>
        ),
      };

    case "nudge.sent": {
      const target = people.get(activity.targetPersonId ?? "");
      // Reads differently depending on which end you are: "you reminded Ravi"
      // is a record, "Ravi reminded you" is a prompt.
      return {
        icon: <BellRing className="size-[16px]" />,
        tone: "warning",
        sentence:
          activity.targetPersonId === meId ? (
            <>
              {strong(actorName)} reminded you about
              {amount ? <> <span className="tabular">{amount}</span></> : <> a balance</>}
            </>
          ) : (
            <>
              You reminded {strong(target?.displayName ?? "someone")}
              {amount ? <> about <span className="tabular">{amount}</span></> : null}
            </>
          ),
      };
    }

    case "group.created":
      return {
        icon: <Users className="size-[16px]" />,
        tone: "brand",
        sentence: <>{strong(actorName)} created {strong(String(data.groupName ?? "a group"))}</>,
      };

    default:
      return {
        icon: <Receipt className="size-[16px]" />,
        tone: "neutral",
        sentence: <>{strong(actorName)} made a change</>,
      };
  }
}

/**
 * Relative time.
 *
 * Stops at a week: "23 days ago" is harder to place than a date, and by then
 * the exact day matters more than the elapsed span.
 */
export function timeAgo(iso: string): string {
  const then = new Date(iso);
  const seconds = Math.floor((Date.now() - then.getTime()) / 1000);

  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;

  return then.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(then.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }),
  });
}
