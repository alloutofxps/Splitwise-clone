/**
 * Accounts for the browser checks (keyboard-check, a11y-tree, focus-rings,
 * long-text): API clients that each send their own address, so making many
 * accounts doesn't hit the sign-up limit, and the usual small world of four
 * people, two groups and a direct expense.
 *
 * The same approach as `motion-record.mjs`, shared here so the checks don't
 * each carry a copy.
 */

let ip = 10 + Math.floor(Math.random() * 200);

/** A person talking to the API at `base`, keeping their own cookie. */
export function client(base) {
  let cookie = "";
  const address = `198.19.${Math.floor(Math.random() * 250)}.${ip++ % 250}`;
  return {
    id: "",
    get cookie() {
      return cookie;
    },
    async call(path, body, method) {
      const r = await fetch(base + path, {
        method: method ?? (body ? "POST" : "GET"),
        headers: {
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(cookie ? { Cookie: `divvy_id=${cookie}` } : {}),
          "X-Forwarded-For": address,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const m = /divvy_id=([^;]*)/.exec(r.headers.get("set-cookie") ?? "");
      if (m) cookie = m[1];
      const text = await r.text();
      if (!r.ok) throw new Error(`${path} -> ${r.status} ${text.slice(0, 200)}`);
      return text ? JSON.parse(text) : null;
    },
  };
}

/** An equal split of `total` minor units between `ids`. */
export const eq = (total, ids) =>
  ids.map((personId, i) => ({ personId, amount: String(Math.floor(total / ids.length) + (i < total % ids.length ? 1 : 0)) }));

/** Priya, Ravi, Sam and Ana; Lisbon 2026 and Flat 4B; a concert with Ravi. */
export async function seed(base) {
  const [me, ravi, sam, ana] = [client(base), client(base), client(base), client(base)];
  for (const [c, name, color] of [[me, "Priya Shah", "violet"], [ravi, "Ravi Kumar", "cobalt"], [sam, "Sam Lee", "sand"], [ana, "Ana Costa", "teal"]]) {
    c.id = (await c.call("/api/identity", { displayName: name, avatarColor: color, defaultCurrency: "EUR" })).me.id;
  }
  const trip = (await me.call("/api/groups", { name: "Lisbon 2026", currency: "EUR", emoji: "🌴" })).group;
  const flat = (await me.call("/api/groups", { name: "Flat 4B", currency: "EUR", emoji: "🏠" })).group;
  for (const c of [ravi, sam, ana]) await c.call(`/api/invite/${trip.inviteCode}/join`, {});
  await sam.call(`/api/invite/${flat.inviteCode}/join`, {});
  const all = [me.id, ravi.id, sam.id, ana.id];
  const add = (who, groupId, description, amount, ids) =>
    who.call("/api/expenses", { groupId, description, amount: String(amount), currency: "EUR", splitMode: "EQUAL", payers: [{ personId: who.id, amount: String(amount) }], splits: eq(amount, ids) });
  await add(me, trip.id, "Dinner at Cervejaria", 9600, all);
  await add(ravi, trip.id, "Taxi to the airport", 4200, [me.id, ravi.id]);
  await add(sam, trip.id, "Pastéis de Belém", 1840, all);
  await add(ana, trip.id, "Museum tickets", 6000, all);
  await add(sam, flat.id, "Big shop", 8340, [me.id, sam.id]);
  const meCode = (await me.call("/api/identity")).me.inviteCode;
  await ravi.call(`/api/invite/${meCode}/join`, {});
  await me.call("/api/expenses", { friendId: ravi.id, description: "Concert tickets", amount: "9000", currency: "EUR", splitMode: "EQUAL", payers: [{ personId: me.id, amount: "9000" }], splits: eq(9000, [me.id, ravi.id]) });
  return { me, ravi, sam, ana, trip: trip.id, flat: flat.id };
}

/** Signs a browser context in as `cookie`, with the install prompt out of the way. */
export async function signIn(context, base, cookie) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("divvy-install-dismissed", String(Date.now()));
    } catch {
      // Storage can be blocked; the prompt then simply shows.
    }
  });
  await context.addCookies([{ name: "divvy_id", value: cookie, url: base }]);
}

/** Edge on machines without Playwright's own browser (CHROMIUM_PATH). */
export const launchOptions = () => (process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
