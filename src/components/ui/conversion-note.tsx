"use client";

import * as React from "react";
import { convert, toDecimalString } from "@/lib/money";

/**
 * Today's exchange rate between two currencies, fetched when it appears and
 * editable, with what the amount comes to. Used wherever money is entered in
 * one currency and counted in another: a dollar expense in a euro group, or
 * paying a euro debt in dollars.
 */
export function ConversionNote({
  amount,
  from,
  to,
  rate,
  onRateChange,
}: {
  amount: bigint;
  from: string;
  to: string;
  rate: string;
  onRateChange: (rate: string) => void;
}) {
  // Which currency pair's lookup has finished. "Getting the rate" is simply
  // the current pair not having finished yet - nothing to switch on and off.
  const pair = `${from}>${to}`;
  const [settled, setSettled] = React.useState<string | null>(null);
  const fetching = settled !== pair;

  // Fetch a live rate on first appearance, falling back to manual entry.
  React.useEffect(() => {
    let cancelled = false;
    fetch(`/api/rates?base=${from}&quote=${to}`)
      .then((response) => response.json())
      .then((payload: { rate?: { rate: string } | null }) => {
        if (!cancelled && payload.rate?.rate) onRateChange(tidyRate(payload.rate.rate));
      })
      .catch(() => {
        // Offline: the manual field below is the fallback.
      })
      .finally(() => {
        if (!cancelled) setSettled(`${from}>${to}`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const converted =
    amount > 0n && rate ? convertPreview(amount, from, to, rate) : null;

  return (
    <div className="mt-3 w-full rounded-[var(--radius-md)] bg-surface px-3 py-2.5">
      <div className="flex items-center justify-between gap-2 text-caption">
        <span className="font-semibold text-muted">
          Group uses {to}
        </span>
        {fetching ? (
          <span className="text-subtle">getting the rate…</span>
        ) : (
          <span className="tabular text-subtle">
            1 {from} ={" "}
            <input
              value={rate}
              onChange={(event) => onRateChange(event.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              className="w-[88px] bg-transparent text-right text-input font-semibold text-text outline-none"
              aria-label={`Exchange rate from ${from} to ${to}`}
            />{" "}
            {to}
          </span>
        )}
      </div>
      {converted ? (
        <p className="tabular mt-1 text-body font-bold text-text">≈ {converted} {to}</p>
      ) : null}
    </div>
  );
}

/**
 * Reuses the same integer conversion the server will apply, so the preview is
 * the number that actually gets stored rather than an approximation of it.
 */
function convertPreview(amount: bigint, from: string, to: string, rate: string): string | null {
  if (!/^\d+(\.\d+)?$/.test(rate)) return null;
  return toDecimalString(convert(amount, from, to, rate), to);
}

/**
 * Today's rate to six significant digits, which is all anyone can check
 * against a bank statement and all that fits the field. Very small rates are
 * left as they are so they never turn into scientific notation.
 */
function tidyRate(rate: string): string {
  const value = Number(rate);
  if (!Number.isFinite(value) || value <= 0 || value < 0.001) return rate;
  return String(Number(value.toPrecision(6)));
}
