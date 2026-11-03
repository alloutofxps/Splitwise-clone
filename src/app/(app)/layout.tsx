import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppGate } from "@/components/app-gate";
import { serialize } from "@/lib/api";
import { getSession, IDENTITY_COOKIE } from "@/lib/identity";
import { log } from "@/lib/log";
import { dashboardDto, visiblePeople } from "@/server/me";
import type { DashboardPayload } from "@/lib/client/cache-contract";

/**
 * Home's name, "Home · Divvy", once signed in. The welcome keeps the site's
 * name, which is what search and shared links show. Every other screen names
 * itself in its own layout.
 */
export async function generateMetadata(): Promise<Metadata> {
  // The template is passed on again: a plain title here would drop the
  // " · Divvy" ending from every screen below this one.
  return (await cookies()).has(IDENTITY_COOKIE)
    ? { title: { default: "Home", template: "%s · Divvy" } }
    : {};
}

/**
 * What `/api/dashboard` would answer, worked out with the page itself.
 *
 * On a phone's first visit the app's code takes seconds to arrive, and it
 * only asked for the dashboard once it had: the balances appeared at about
 * 5 seconds on a slow connection (PERF-BASELINE 26). Sent with the page, the
 * opening outline draws them at once, and the app starts from them while its
 * own request is still on its way. Null whenever anything is off, and the app
 * waits for its request as before.
 */
async function openingDashboard(): Promise<{ dashboard: DashboardPayload; at: number } | null> {
  try {
    const session = await getSession();
    if (!session) return null;
    const [dashboard, people] = await Promise.all([dashboardDto(session.person), visiblePeople(session.person.id)]);
    // Exactly the route's answer: money as decimal strings, dates as text.
    return { dashboard: JSON.parse(JSON.stringify(serialize({ ...dashboard, people }))) as DashboardPayload, at: Date.now() };
  } catch (error) {
    log.warn("opening dashboard failed", { error });
    return null;
  }
}

/**
 * Whether this device has an identity, known from the first request.
 *
 * The cookie's presence picks which outline the app opens on (Home's, or the
 * welcome's for a newcomer); a stale cookie still ends at the welcome once
 * the dashboard answers 401, as before. With a valid one, the dashboard comes
 * with the page.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).has(IDENTITY_COOKIE);
  const opening = signedIn ? await openingDashboard() : null;
  return (
    <AppGate signedIn={signedIn} opening={opening}>
      {children}
    </AppGate>
  );
}
