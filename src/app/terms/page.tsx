import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms" };

// Read on each request, like the privacy page, so the contact set on the host
// appears without a rebuild.
export const dynamic = "force-dynamic";

/**
 * The terms of using Divvy, in plain words (findings item 15).
 *
 * Only what is true of this app: it is free, it keeps a record and never moves
 * money, and it comes without promises. Whoever runs a deployment should have
 * it reviewed for their jurisdiction before charging anyone, as with the
 * privacy page.
 */
export default function TermsPage() {
  const contact = process.env.DIVVY_CONTACT || process.env["NEXT_PUBLIC_DIVVY_CONTACT"];

  return (
    <main className="mx-auto w-full max-w-[640px] px-6 pb-12 pt-[max(3rem,env(safe-area-inset-top))] text-body-lg leading-relaxed text-text">
      <h1 className="text-display-sm font-semibold tracking-[-0.03em]">Terms</h1>
      <p className="mt-3 text-muted">By using Divvy you agree to these terms. They&rsquo;re short.</p>

      <h2 className="mt-8 text-title-lg font-semibold">What Divvy is</h2>
      <p className="mt-3 text-muted">
        A free way to keep track of shared costs and who owes whom. It keeps a record. It
        doesn&rsquo;t hold, send or receive money: paying each other happens outside Divvy, and
        marking a payment in Divvy only records it.
      </p>

      <h2 className="mt-8 text-title-lg font-semibold">The numbers are yours to check</h2>
      <p className="mt-3 text-muted">
        Balances come from what you and the people in your groups enter, and exchange rates
        from a public website. Check the amounts with each other before anyone pays. A balance
        in Divvy isn&rsquo;t a bill or a legal debt.
      </p>

      <h2 className="mt-8 text-title-lg font-semibold">Using it fairly</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
        <li>Add only things you&rsquo;re happy for everyone in that group to see.</li>
        <li>Don&rsquo;t use Divvy to harass anyone or for anything against the law.</li>
        <li>Don&rsquo;t try to get at other people&rsquo;s groups, slow Divvy down or break it.</li>
      </ul>
      <p className="mt-3 text-muted">An account that does these things can be removed.</p>

      <h2 className="mt-8 text-title-lg font-semibold">What you add</h2>
      <p className="mt-3 text-muted">
        It stays yours. Divvy keeps it only to show it to you and the people you share it with.
        The Privacy page, linked below, says what&rsquo;s kept, for how long, and how to download or delete it.
      </p>

      <h2 className="mt-8 text-title-lg font-semibold">No promises</h2>
      <p className="mt-3 text-muted">
        Divvy is provided as it is. It can have mistakes, and it can be unavailable at times.
        Keep your own copy of anything important with <strong>You → Download a backup</strong>.
        As far as the law allows, whoever runs Divvy isn&rsquo;t responsible for losses from
        using it. Divvy may change, and it may stop.
      </p>

      {contact ? (
        <>
          <h2 className="mt-8 text-title-lg font-semibold">Contact</h2>
          <p className="mt-3 text-muted">{contact}</p>
        </>
      ) : null}

      <p className="mt-8 flex flex-wrap gap-x-6">
        <Link href="/" className="inline-flex min-h-11 min-w-11 items-center font-semibold text-brand">
          Back to Divvy
        </Link>
        <Link href="/privacy" className="inline-flex min-h-11 min-w-11 items-center font-semibold text-brand">
          Privacy
        </Link>
      </p>
    </main>
  );
}
