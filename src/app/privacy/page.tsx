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

      <h2 className="mt-8 text-title-lg font-bold">What is stored</h2>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">
        <li>The name, colour and emoji you pick. No email address, phone number or password.</li>
        <li>The groups you are in, and the expenses, payments, comments and receipt photos you or the people in them add.</li>
        <li>Any payment handles you choose to save (a UPI id, IBAN or similar), shown only to people you share a group or a direct connection with.</li>
        <li>Your budgets, which only you can see.</li>
        <li>For signing in: a one-way hash of your recovery key, the public half of any passkey, and a list of signed-in devices described by browser and operating system.</li>
      </ul>

      <h2 className="mt-8 text-title-lg font-bold">What is not</h2>
      <p className="mt-3 text-muted">
        No analytics, no advertising, no tracking, and nothing is sold or shared. Exchange
        rates are fetched from a public rate service by the server; nothing about you is sent.
      </p>

      <h2 className="mt-8 text-title-lg font-bold">Who can see it</h2>
      <p className="mt-3 text-muted">
        Everything in a group is visible to its members. A direct expense is visible to the
        people on it. The people running this server can see the database.
      </p>

      <h2 className="mt-8 text-title-lg font-bold">Keeping and deleting it</h2>
      <p className="mt-3 text-muted">
        You can download everything you can see from <strong>Account → Download a backup</strong>,
        and delete your account from <strong>Account → Delete my account</strong> once you are
        settled up. Deleting erases your name, payment details, budgets, comments and sign-in
        methods. Expenses you shared stay on the other people&apos;s books, shown as
        &ldquo;Deleted user&rdquo;, because they are part of their records too. Devices unused for
        six months are signed out automatically.
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
