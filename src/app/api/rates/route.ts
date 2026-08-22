import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { getRate } from "@/server/rates";

/**
 * Looks up one conversion rate. Returns 200 with `rate: null` when no rate is
 * available at all, so the composer can fall back to a manual entry field
 * rather than treating an offline lookup as an error.
 */
export const GET = route(async (request: Request) => {
  await requireSession();

  const url = new URL(request.url);
  const base = url.searchParams.get("base");
  const quote = url.searchParams.get("quote");

  if (!base || !quote) {
    return json({ rate: null, error: "Pass base and quote currency codes." }, { status: 400 });
  }

  return json({ rate: await getRate(base, quote) });
});
