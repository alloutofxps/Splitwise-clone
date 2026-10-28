/**
 * Structured server logging.
 *
 * One JSON object per line on stdout/stderr, which every log collector (Railway,
 * Fly, Docker, Loki, Datadog) parses without configuration - so an error can
 * be searched for by its request id or its message instead of being scrolled
 * for. `console.error` with a bare object was the previous state of things, and
 * a stack trace split across forty lines is not something an alert can match.
 *
 * Errors are serialised by hand because `JSON.stringify(new Error())` is `{}`.
 *
 * If `DIVVY_ALERT_WEBHOOK` is set, every `error` is also POSTed there (Slack,
 * Discord and most incident tools accept a `{ text }` body), throttled so an
 * outage produces a handful of messages rather than thousands.
 */

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function serialise(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack?.split("\n").slice(0, 12).join("\n"),
      ...("code" in value ? { code: (value as { code: unknown }).code } : {}),
    };
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}

function write(level: Level, message: string, fields: Fields = {}): void {
  const entry: Record<string, unknown> = {
    level,
    time: new Date().toISOString(),
    msg: message,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) entry[key] = serialise(value);
  }

  let line: string;
  try {
    line = JSON.stringify(entry);
  } catch {
    line = JSON.stringify({ level, time: entry.time, msg: message, note: "fields not serialisable" });
  }

  if (level === "error") {
    console.error(line);
    noteError(Date.now());
    alert(message, entry);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

// ---------------------------------------------------------------------------

/*
 * When recent errors happened, for the health check (server/health.ts), which
 * fails when there are too many so the uptime monitor emails someone. Kept on
 * globalThis because Next.js bundles route handlers and the start-up code
 * separately, and each bundle would otherwise count only its own errors.
 */
const shared = globalThis as unknown as { __divvyErrorTimes?: number[] };
const KEEP_ERROR_TIMES = 200;

function noteError(at: number): void {
  const times = (shared.__divvyErrorTimes ??= []);
  times.push(at);
  if (times.length > KEEP_ERROR_TIMES) times.splice(0, times.length - KEEP_ERROR_TIMES);
}

/** How many errors were logged at or after `since` (milliseconds). */
export function errorsSince(since: number): number {
  return (shared.__divvyErrorTimes ?? []).filter((at) => at >= since).length;
}

// ---------------------------------------------------------------------------

const ALERT_INTERVAL_MS = 60_000;
let lastAlertAt = 0;
let suppressed = 0;

function alert(message: string, entry: Record<string, unknown>): void {
  const url = process.env.DIVVY_ALERT_WEBHOOK;
  if (!url || typeof fetch !== "function") return;

  const now = Date.now();
  if (now - lastAlertAt < ALERT_INTERVAL_MS) {
    suppressed++;
    return;
  }
  lastAlertAt = now;
  const extra = suppressed > 0 ? ` (+${suppressed} more since the last alert)` : "";
  suppressed = 0;

  const error = entry.error as { message?: string } | undefined;
  const text = `Divvy error: ${message}${error?.message ? ` - ${error.message}` : ""}${extra}`;
  void fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

export const log = {
  info: (message: string, fields?: Fields) => write("info", message, fields),
  warn: (message: string, fields?: Fields) => write("warn", message, fields),
  error: (message: string, fields?: Fields) => write("error", message, fields),
};
