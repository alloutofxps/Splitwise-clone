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

/** Rates are stored as decimal strings to avoid float drift in the database. */
function toRateString(value: number): string {
  return value.toPrecision(12).replace(/0+$/, "").replace(/\.$/, "");
}

export async function getRate(base: string, quote: string): Promise<RateResult | null> {
  const from = base.toUpperCase();
  const to = quote.toUpperCase();

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
        .filter(([, value]) => Number.isFinite(value) && value > 0)
        .map(([code, value]) =>
          prisma.exchangeRate.upsert({
            where: { base_quote: { base: from, quote: code } },
            create: { base: from, quote: code, rate: toRateString(value), fetchedAt: now },
            update: { rate: toRateString(value), fetchedAt: now },
          }),
        ),
    );

    const value = rates[to];
    if (value) {
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
