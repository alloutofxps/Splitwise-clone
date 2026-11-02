import Link from "next/link";
import { cookies } from "next/headers";
import { AppGate } from "@/components/app-gate";
import { FlowDoodle } from "@/components/ui/doodle";
import { IDENTITY_COOKIE } from "@/lib/identity";

/**
 * A URL that does not resolve.
 *
 * Worth writing rather than leaving to the framework's default, because in an
 * installed PWA this is not a stray click on a link - there is no address bar
 * to retype. It is a shared invite whose group was deleted, a deep link into an
 * expense somebody has since removed, or a stale home-screen shortcut from
 * before an update. In every one of those the person is inside the app and
 * needs a way back to it, which Next's bare "404 | This page could not be
 * found" does not give them.
 *
 * Signed in, it sits inside the app, with the tab bar or sidebar there to go
 * anywhere else. Signed out it stands alone: inside the app it would be
 * replaced by the welcome, and the message would never be seen.
 */
export default async function NotFound() {
  if ((await cookies()).has(IDENTITY_COOKIE)) {
    return (
      <AppGate signedIn>
        <div className="flex min-h-[60dvh] flex-col items-center justify-center px-8 text-center">
          <NothingHere />
        </div>
      </AppGate>
    );
  }
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center justify-center px-6 text-center">
      <NothingHere />
    </main>
  );
}

function NothingHere() {
  return (
    <>
      {/* Drawn as the other "couldn't load" screens are (LoadFailed). */}
      <FlowDoodle className="mb-5" />

      <h1 className="text-title font-semibold text-text">Nothing here</h1>
      <p className="mt-1.5 max-w-[34ch] text-body-lg leading-relaxed text-muted">
        This link may be old, or what it pointed to was deleted. Your groups
        and expenses are fine.
      </p>

      <Link
        href="/"
        className="mt-5 flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-brand px-4 text-subhead font-semibold text-inverse transition active:opacity-70"
      >
        Back to Divvy
      </Link>
    </>
  );
}
