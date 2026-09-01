/**
 * Currency conversion rates.
 *
 * Live rates are a paid feature in most expense apps. Here they come from a
 * free, key-less public endpoint and are cached in the database - which means
 * the app keeps converting on a plane with no signal, using yesterday's rate
 * and saying so, rather than refusing to record the expense.
 *
 * Three layers, in order:
 *   1. a fresh cached rate (under `FRESH_FOR`);
 *   2. a live fetch, which refreshes the cache;
 *   3. a stale cached rate, flagged as stale.
 *
 * If all three miss, the caller gets nothing and the composer asks the user to
 * type the rate themselves. Every expense stores the rate it was converted at,
 * so a later rate change never retroactively alters a settled balance.
 */

import { prisma } from "@/lib/db";

const FRESH_FOR = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 4000;

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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const response = await fetch(buildUrl(base), {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      clearTimeout(timer);

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
 * exponential notation outside a band it does not announce — anything at or
 * above 1e12, and anything below 1e-7 — and "1.20000000000e-7" is not a
 * decimal string. Nothing downstream reads it: the API schema refuses it and
 * `convert` cannot parse it, so a currency pair with a very small rate would
 * be cached in a form that silently converted at parity forever after.
 *
 * Twelve fraction digits is not an arbitrary cut: it is exactly the precision
 * `convert` reads, so anything finer is discarded downstream anyway.
 */
function toRateString(value: number): string {
  const trimmed = value.toFixed(12).replace(/\.?0+$/, "");
  return trimmed === "" ? "0" : trimmed;
}

/**
 * Rates worth caching.
 *
 * The upper bound keeps `toFixed` out of the range where it, too, goes
 * exponential; the lower one drops rates that would round to a stored "0",
 * which converts every amount to nothing.
 */
function usableRate(value: number): boolean {
  return Number.isFinite(value) && value >= 1e-12 && value < 1e21;
}

export async function getRate(base: string, quote: string): Promise<RateResult | null> {
  const from = base.trim().toUpperCase();
  const to = quote.trim().toUpperCase();

  /*
   * Refused here rather than trusted to the caller, because `from` is
   * interpolated into a provider URL and used as a primary-key column.
   *
   * The path form (`.../latest/${base}`) means anything with a slash or a
   * question mark in it rewrites the request the server makes, and the cache
   * is keyed on whatever came in — so an authenticated caller could fill the
   * rate table with arbitrary rows just by asking for currencies that do not
   * exist. Three letters is the whole of what a currency code can be.
   */
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) return null;

  if (from === to) {
    return { base: from, quote: to, rate: "1", fetchedAt: new Date().toISOString(), stale: false };
  }

  const cached = await prisma.exchangeRate.findUnique({
    where: { base_quote: { base: from, quote: to } },
  });

  const isFresh = cached && Date.now() - cached.fetchedAt.getTime() < FRESH_FOR;
  if (isFresh) {
    return {
      base: from,
      quote: to,
      rate: cached.rate,
      fetchedAt: cached.fetchedAt.toISOString(),
      stale: false,
    };
  }

  const rates = await fetchRates(from);
  if (rates) {
    const now = new Date();
    // Cache the whole response, not just the pair asked for: the next lookup in
    // this group is very likely another currency from the same trip.
    await Promise.all(
      Object.entries(rates)
        .filter(([code, value]) => /^[A-Z]{3}$/.test(code) && usableRate(value))
        .map(([code, value]) =>
          prisma.exchangeRate.upsert({
            where: { base_quote: { base: from, quote: code } },
            create: { base: from, quote: code, rate: toRateString(value), fetchedAt: now },
            update: { rate: toRateString(value), fetchedAt: now },
          }),
        ),
    );

    const value = rates[to];
    if (value !== undefined && usableRate(value)) {
      return {
        base: from,
        quote: to,
        rate: toRateString(value),
        fetchedAt: now.toISOString(),
        stale: false,
      };
    }
  }

  if (cached) {
    return {
      base: from,
      quote: to,
      rate: cached.rate,
      fetchedAt: cached.fetchedAt.toISOString(),
      stale: true,
    };
  }

  return null;
}
