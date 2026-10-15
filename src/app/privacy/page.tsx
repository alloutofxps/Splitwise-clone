import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

// Read on each request rather than at build time. A `NEXT_PUBLIC_` variable is
// baked in by `next build`, and the Docker build never sees the host's
// variables, so a contact set in the dashboard silently never appeared.
export const dynamic = "force-dynamic";

/**
 * What Divvy stores, why, and how to remove it.
 *
 * Written to be true of this codebase rather than borrowed boilerplate. Whoever
 * runs a deployment should add who they are and how to reach them (set
 * `DIVVY_CONTACT`), and have it reviewed for their jurisdiction before
 * charging anyone.
 */
export default function PrivacyPage() {
  // The old name is still honoured for deployments that already set it.
  const contact = process.env.DIVVY_CONTACT || process.env["NEXT_PUBLIC_DIVVY_CONTACT"];

  return (
    <main className="mx-auto w-full max-w-[640px] px-6 py-12 text-body-lg leading-relaxed text-text">
      <h1 className="text-display-sm font-black tracking-[-0.03em]">Privacy</h1>

      <h2 className="mt-8 text-title-lg font-bold">What we keep</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
        <li>The name, colour and emoji you pick. We don&rsquo;t ask for your email, phone number or a password.</li>
        <li>Your groups, and the expenses, payments, comments and receipt photos that you and the people in them add.</li>
        <li>Any payment details you choose to add, like a UPI ID or bank account. Only people you share a group with, or have added as a friend, can see them.</li>
        <li>Your budgets, which only you can see.</li>
        <li>What we need to sign you in: a scrambled copy of your recovery key that can&rsquo;t be turned back into the key, the public part of any passkey, and a list of the devices you&rsquo;re signed in on (browser and phone type only).</li>
      </ul>

      <h2 className="mt-8 text-title-lg font-bold">What we don&rsquo;t do</h2>
      <p className="mt-3 text-muted">
        No ads, no tracking, and we never sell or share your data. To convert currencies,
        Divvy looks up exchange rates from a public website. Nothing about you is sent.
      </p>

      <h2 className="mt-8 text-title-lg font-bold">Who can see it</h2>
      <p className="mt-3 text-muted">
        Everyone in a group can see everything in that group. An expense between two friends
        can only be seen by those two. Whoever runs Divvy can see the stored data.
      </p>

      <h2 className="mt-8 text-title-lg font-bold">Getting a copy or deleting it</h2>
      <p className="mt-3 text-muted">
        Get a copy of everything you can see from <strong>Account → Download a backup</strong>.
        Once you&rsquo;re settled up, you can delete your account from{" "}
        <strong>Account → Delete my account</strong>. That removes your name, payment details,
        budgets, comments and sign-in details. Other people still see the expenses you shared
        with them, under the name &ldquo;Deleted user&rdquo;, because they&rsquo;re part of their
        records too. If a device isn&rsquo;t used for six months, it gets signed out.
      </p>

      {contact ? (
        <>
          <h2 className="mt-8 text-title-lg font-bold">Contact</h2>
          <p className="mt-3 text-muted">{contact}</p>
        </>
      ) : null}

      <p className="mt-10">
        <Link href="/" className="font-semibold text-brand">
          Back to Divvy
        </Link>
      </p>
    </main>
  );
}
