/**
 * Currency conversion rates.
 *
 * Live rates are a paid feature in most expense apps. Here they come from a
 * free, key-less public endpoint and are cached in the database - which means
 * the app keeps converting on a plane with no signal, using yesterday's rate
 * and saying so, rather than refusing to record the expense.
 *
 * Lookups never wait on the provider when anything is cached: a stale rate is
 * returned at once and refreshed in the background. Only a pair seen for the
 * first time waits for the network, and then for at most a few seconds. The
 * scheduler (`server/jobs.ts`) also refreshes every base in use every few
 * hours, so most lookups are fresh hits.
 *
 * Every expense stores the rate it was converted at, so a later rate change
 * never retroactively alters a settled balance.
 */

import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { log } from "@/lib/log";

const FRESH_FOR = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 3000;

export interface RateResult {
  base: string;
  quote: string;
  rate: string;
  fetchedAt: string;
  stale: boolean;
}

/** Free, no API key, ECB-derived with a wide currency list. */
const PROVIDERS = [
  (base: string) => `https://open.er-api.com/v6/latest/${base}`,
  (base: string) => `https://api.frankfurter.app/latest?from=${base}`,
];

interface ProviderPayload {
  rates?: Record<string, number>;
}

async function fetchRates(base: string): Promise<Record<string, number> | null> {
  for (const buildUrl of PROVIDERS) {
    try {
      const response = await fetch(buildUrl(base), {
        signal: AbortSignal.timeout(FETCH_TIMEOUT),
        headers: { accept: "application/json" },
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as ProviderPayload;
      if (payload.rates && Object.keys(payload.rates).length > 0) return payload.rates;
    } catch {
      // Offline, blocked, or the provider is down. Try the next one, then fall
      // back to whatever is cached.
      continue;
    }
  }
  return null;
}

/**
 * Rates are stored as decimal strings to avoid float drift in the database.
 *
 * `toFixed` rather than `toPrecision`, because `toPrecision(12)` switches to
 * exponential notation outside a band it does not announce, and
 * "1.20000000000e-7" is not a decimal string. Twelve fraction digits is exactly
 * the precision `convert` reads.
 */
function toRateString(value: number): string {
  const trimmed = value.toFixed(12).replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

/** Rates worth caching: finite, and inside the range `toFixed` stays decimal. */
function usableRate(value: number): boolean {
  return Number.isFinite(value) && value >= 1e-12 && value < 1e21;
}

const refreshing = new Set<string>();

/**
 * Fetches every rate for `base` and stores them in one transaction.
 *
 * One write transaction rather than ~160 parallel upserts, which on SQLite
 * meant 160 turns at the only write lock for a single lookup.
 */
export async function refreshBase(base: string): Promise<Record<string, number> | null> {
  if (refreshing.has(base)) return null;
  refreshing.add(base);
  try {
    const rates = await fetchRates(base);
    if (!rates) return null;
    const now = new Date();
    const rows = Object.entries(rates).filter(
      ([code, value]) => /^[A-Z]{3}$/.test(code) && usableRate(value),
    );
    await prisma.$transaction(
      rows.map(([code, value]) =>
        prisma.exchangeRate.upsert({
          where: { base_quote: { base, quote: code } },
          create: { base, quote: code, rate: toRateString(value), fetchedAt: now },
          update: { rate: toRateString(value), fetchedAt: now },
        }),
      ),
    );
    return rates;
  } catch (error) {
    log.warn("exchange rate refresh failed", { base, error });
    return null;
  } finally {
    refreshing.delete(base);
  }
}

/** Refreshes every base currency somebody has looked up. Run by the scheduler. */
export async function refreshAllBases(): Promise<void> {
  const bases = await prisma.exchangeRate.findMany({
    distinct: ["base"],
    select: { base: true },
  });
  for (const { base } of bases) await refreshBase(base);
}

export async function getRate(base: string, quote: string): Promise<RateResult | null> {
  const from = base.trim().toUpperCase();
  const to = quote.trim().toUpperCase();

  // `from` is interpolated into a provider URL and used as a key column, so
  // anything other than three letters is refused before it can rewrite either.
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;

  if (from === to) {
    return { base: from, quote: to, rate: "1", fetchedAt: new Date().toISOString(), stale: false };
  }

  const cached = await prisma.exchangeRate.findUnique({
    where: { base_quote: { base: from, quote: to } },
  });

  if (cached) {
    const fresh = Date.now() - cached.fetchedAt.getTime() < FRESH_FOR;
    // Stale-while-revalidate: answer now, refresh behind the response.
    if (!fresh) void refreshBase(from);
    return {
      base: from,
      quote: to,
      rate: cached.rate,
      fetchedAt: cached.fetchedAt.toISOString(),
      stale: !fresh,
    };
  }

  const rates = await refreshBase(from);
  const value = rates?.[to];
  if (value !== undefined && usableRate(value)) {
    return {
      base: from,
      quote: to,
      rate: toRateString(value),
      fetchedAt: new Date().toISOString(),
      stale: false,
    };
  }
  return null;
}

/**
 * How far a typed rate may stray from the reference before it is refused.
 *
 * Wide on purpose. Card and cash rates really do differ from the mid-market
 * one, and some currencies trade well away from their official rate, so this
 * is not a policy about which rate is right. It catches the mistakes that are
 * unmistakable: the rate typed upside down (83 instead of 0.012), an extra
 * zero, a rate meant for a different currency - each of which turns a dinner
 * into a debt of thousands.
 */
const PLAUSIBLE_FACTOR = 3;

/**
 * Refuses an exchange rate wildly out of line with the cached reference.
 *
 * Only cached rates are consulted, so this never waits on the network; with no
 * reference available the rate is accepted as typed.
 */
export async function checkRateIsPlausible(from: string, to: string, rate: string): Promise<void> {
  if (from === to) return;
  const reference = await prisma.exchangeRate.findUnique({
    where: { base_quote: { base: from, quote: to } },
  });
  if (!reference) return;

  const typed = Number(rate);
  const expected = Number(reference.rate);
  if (!(typed > 0) || !(expected > 0)) return;

  const ratio = typed / expected;
  if (ratio > PLAUSIBLE_FACTOR || ratio < 1 / PLAUSIBLE_FACTOR) {
    throw new ValidationError(
      `That exchange rate (${rate}) is very different from today's ${from}→${to} rate of about ${Number(reference.rate).toPrecision(4)}. Check you haven't typed it the wrong way round.`,
    );
  }
}
