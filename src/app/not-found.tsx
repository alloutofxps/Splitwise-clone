import Link from "next/link";
import { Compass } from "lucide-react";

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
 * A server component on purpose: nothing here needs the client bundle, and this
 * is the one screen that must render even when something else is badly wrong.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-[440px] flex-col items-center justify-center px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-[--radius-lg] bg-surface-2 text-muted">
        <Compass className="size-7" />
      </span>

      <h1 className="mt-6 text-[22px] font-black tracking-[-0.03em] text-text">
        There is nothing here
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        This link may be out of date, or whatever it pointed at has been
        deleted. Your groups and expenses are unaffected.
      </p>

      <Link
        href="/"
        className="mt-7 flex h-11 items-center justify-center rounded-[--radius-md] bg-brand px-6 text-[15px] font-semibold text-white transition active:scale-[0.98]"
      >
        Back to Divvy
      </Link>
    </main>
  );
}
