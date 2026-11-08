import type { Metadata } from "next";
import { LegalLinks, LegalList, LegalPage, LegalSection, LegalText } from "@/components/legal";

export const metadata: Metadata = { title: "Privacy Policy" };

// Read on each request rather than at build time. A `NEXT_PUBLIC_` variable is
// baked in by `next build`, and the Docker build never sees the host's
// variables, so a contact set in the dashboard silently never appeared.
export const dynamic = "force-dynamic";

/**
 * What Divvy stores, why, who sees it, how long it is kept and how to remove
 * it, under the headings a privacy policy is expected to have.
 *
 * Every line is true of this codebase rather than borrowed boilerplate:
 * - Sign-in: lib/identity.ts (a SHA-256 of the recovery key, the devices by
 *   browser and phone type, signed out after SESSION_IDLE_DAYS), the
 *   `divvy_id` and `divvy_webauthn` cookies.
 * - IP addresses: only server/rate-limit.ts, in memory.
 * - Error reports: api/client-errors. Notifications: server/push.ts.
 * - Something wrong? reports: api/reports and server/reports.ts (deleted after
 *   REPORT_KEEP_DAYS, and with the sender's account).
 * - On the device: lib/client/storage.ts, outbox.ts and the service worker's
 *   copies, all cleared at sign-out (lib/client/wipe.ts).
 * - Exchange rates: server/rates.ts, asked by the server, not the browser.
 * - Deleting: an expense or payment keeps its row so it can be restored
 *   (api/expenses/[id]/restore); an account is api/identity/account.
 * - Backups: docker-entrypoint.sh (Litestream, whose old copies go after 24
 *   hours, and the five copies taken as the server starts) and server/jobs.ts
 *   (a copy a day and at each start, the newest seven).
 * Change the date when the text changes. Whoever runs a deployment should add
 * who they are and how to reach them (set `DIVVY_CONTACT`), and have it
 * reviewed for their jurisdiction before charging anyone.
 */
export default function PrivacyPage() {
  // The old name is still honoured for deployments that already set it.
  const contact = process.env.DIVVY_CONTACT || process.env["NEXT_PUBLIC_DIVVY_CONTACT"];

  return (
    <LegalPage title="Privacy Policy" updated="8 November 2026">
      <LegalText>
        This policy explains what information Divvy collects, how it is used and shared, how
        long it is kept, and the choices you have. In this policy, &ldquo;we&rdquo; and
        &ldquo;us&rdquo; mean the people who run Divvy.
      </LegalText>

      <LegalSection title="Information we collect">
        <LegalList>
          <li><strong>Profile.</strong> The name, colour and emoji you choose. We do not ask for your email address, phone number or a password.</li>
          <li><strong>Content you add.</strong> Your groups, and the expenses, payments, comments and receipt photos that you and other members add.</li>
          <li><strong>Payment details.</strong> Any you choose to add, such as a UPI ID or bank account.</li>
          <li><strong>Budgets.</strong> Any budgets you set.</li>
          <li><strong>Sign-in information.</strong> A hashed copy of your recovery key, which cannot be turned back into the key; the public key of any passkey; and a list of the devices you are signed in on, described by browser and device type only.</li>
          <li><strong>Notification settings.</strong> If you turn on notifications, the delivery address your phone or browser provides for each device.</li>
          <li><strong>Reports you send.</strong> If you use <strong>Something wrong?</strong>, what you write, the screen you were on, the version of Divvy, your type of phone or browser, and your name in Divvy if you are signed in. Only the people who run Divvy see them.</li>
          <li><strong>Error reports.</strong> If Divvy fails on your device, the error message, the screen it happened on and the version of Divvy. Error reports do not include your name or anything you have added.</li>
          <li><strong>Technical information.</strong> Like any website, Divvy receives your IP address with each request. We use it only to limit repeated attempts, such as guessing a recovery key, and we do not save it. Our hosting provider keeps standard request logs, which can include IP addresses, for a limited time.</li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Cookies and storage on your device">
        <LegalText>
          Divvy uses one cookie to keep you signed in, and a short-lived one while you add or use
          a passkey. It also saves your settings, such as Day or Night, on your device, along with
          a copy of your recent data so it works offline and any changes waiting to be sent. That
          copy is cleared when you sign out. Divvy does not use advertising or analytics cookies.
        </LegalText>
      </LegalSection>

      <LegalSection title="How we use information">
        <LegalText>
          We use this information only to run Divvy: to show expenses and balances to you and the
          people you share them with, to sign you in, to send the notifications you turn on, and
          to find and fix problems. We do not show ads, track you on other websites or apps, or
          use your information for marketing.
        </LegalText>
      </LegalSection>

      <LegalSection title="How information is shared">
        <LegalList>
          <li><strong>With other members.</strong> Everyone in a group can see everything in that group. An expense between two friends can be seen only by those two. Your payment details can be seen by people you share a group with or have added as a friend. Your budgets can be seen only by you.</li>
          <li><strong>With service providers.</strong> Divvy is hosted on Railway, and a backup copy of its data is stored with Cloudflare. Notifications are delivered by your device&rsquo;s own notification service (Apple, Google, Mozilla or Microsoft) and are encrypted so that only your device can read them.</li>
          <li><strong>Exchange rates.</strong> To convert currencies, Divvy&rsquo;s server gets exchange rates from public services. No information about you is sent to them.</li>
          <li><strong>When required by law.</strong> We may disclose information if we are legally required to.</li>
        </LegalList>
        <LegalText>
          We do not sell or rent your personal information. The people who run Divvy can access
          stored information when needed to operate and support it.
        </LegalText>
      </LegalSection>

      <LegalSection title="How long we keep information">
        <LegalText>
          We keep your information for as long as your account exists. A deleted expense or
          payment no longer counts toward balances, but it is kept so that it can be restored from
          Activity. A receipt photo you remove is deleted.
        </LegalText>
        <LegalText>
          Information that is deleted, including when you delete your account, is removed from our
          backups on this schedule:
        </LegalText>
        <LegalList>
          <li>The backup at Cloudflare: within about a day.</li>
          <li>The server&rsquo;s daily copies: within about a week, as it keeps the newest seven.</li>
          <li>The copy the server takes each time it starts, which happens with every update to Divvy: it keeps the newest five, so these are replaced as updates come out.</li>
        </LegalList>
        <LegalText>A device that has not been used for six months is signed out automatically. Reports sent with Something wrong? are deleted after 90 days, or sooner if you delete your account.</LegalText>
      </LegalSection>

      <LegalSection title="Your choices and rights">
        <LegalList>
          <li><strong>Access.</strong> Download a copy of everything you can see from <strong>You → Download a backup</strong>.</li>
          <li><strong>Correction.</strong> Change your name, colour, emoji and payment details from <strong>You</strong> at any time.</li>
          <li><strong>Deletion.</strong> Once you are settled up with everyone, you can delete your account from <strong>You → Delete my account</strong>. This removes your name, emoji, payment details, budgets, comments, friends list and sign-in information. Expenses and payments you shared stay visible to the other people in them, under the name &ldquo;Deleted user&rdquo;, because they are part of those people&rsquo;s records too.</li>
          <li><strong>Notifications.</strong> Turn them off from <strong>You</strong> at any time.</li>
        </LegalList>
        <LegalText>
          Depending on where you live, you may have further rights over your information,
          including the right to complain to a data protection authority. To use any of these
          rights, contact us.
        </LegalText>
      </LegalSection>

      <LegalSection title="Security">
        <LegalText>
          All connections to Divvy are encrypted (HTTPS), and your recovery key is stored only in
          hashed form. No system is completely secure, so keep your recovery key private.
        </LegalText>
      </LegalSection>

      <LegalSection title="Children">
        <LegalText>
          Divvy is not intended for children under 13, or under the minimum age set by law where
          you live. We do not knowingly collect information from children. If you think a child
          is using Divvy, contact us and we will delete their information.
        </LegalText>
      </LegalSection>

      <LegalSection title="Changes to this policy">
        <LegalText>
          If we change this policy, we will post the new version here and update the date at the
          top.
        </LegalText>
      </LegalSection>

      {contact ? (
        <LegalSection title="Contact us">
          <LegalText>{contact}</LegalText>
        </LegalSection>
      ) : null}

      <LegalLinks other={{ href: "/terms", label: "Terms of Use" }} />
    </LegalPage>
  );
}
