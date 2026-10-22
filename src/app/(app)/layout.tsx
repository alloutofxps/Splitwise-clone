import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AppGate } from "@/components/app-gate";
import { IDENTITY_COOKIE } from "@/lib/identity";

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
 * Whether this device has an identity, known from the first request.
 *
 * Only the cookie's presence is read here, not its validity: it picks which
 * outline the app opens on (Home's, or the welcome's for a newcomer). A stale
 * cookie still ends at the welcome once the dashboard answers 401, as before.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const signedIn = (await cookies()).has(IDENTITY_COOKIE);
  return <AppGate signedIn={signedIn}>{children}</AppGate>;
}
