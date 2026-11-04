import type { Metadata } from "next";
import { LegalLinks, LegalList, LegalPage, LegalSection, LegalText } from "@/components/legal";

export const metadata: Metadata = { title: "Terms of Use" };

// Read on each request, like the privacy page, so the contact set on the host
// appears without a rebuild.
export const dynamic = "force-dynamic";

/**
 * The terms of using Divvy, under the headings terms of use are expected to
 * have (findings item 15).
 *
 * Only what is true of this app: it is free, it keeps a record and never moves
 * money (the payment links are lib/payments.ts), sign-in is a recovery key or
 * a passkey, and it comes without promises. Change the date when the text
 * changes. Whoever runs a deployment should have it reviewed for their
 * jurisdiction before charging anyone, as with the privacy page.
 */
export default function TermsPage() {
  const contact = process.env.DIVVY_CONTACT || process.env["NEXT_PUBLIC_DIVVY_CONTACT"];

  return (
    <LegalPage title="Terms of Use" updated="4 November 2026">
      <LegalText>
        These terms apply to your use of Divvy. By using Divvy, you agree to them. If you do not
        agree, please do not use Divvy. In these terms, &ldquo;we&rdquo; and &ldquo;us&rdquo; mean
        the people who run Divvy.
      </LegalText>

      <LegalSection title="The service">
        <LegalText>
          Divvy is a free service for keeping track of shared expenses and balances. Divvy does not
          hold, send or receive money. Payments between people happen outside Divvy, and recording
          a payment in Divvy does not move any money. Divvy may link to payment apps; payments you
          make there are covered by those apps&rsquo; own terms.
        </LegalText>
      </LegalSection>

      <LegalSection title="Balances and exchange rates">
        <LegalText>
          Balances are calculated from what you and other members enter, and exchange rates come
          from public sources, so they can contain mistakes. Check amounts with each other before
          paying. A balance in Divvy is a record kept for your convenience, not a bill or a legal
          claim.
        </LegalText>
      </LegalSection>

      <LegalSection title="Your account">
        <LegalText>
          Divvy does not use passwords. You sign in on a new device with your recovery key or a
          passkey. Keep your recovery key private: anyone who has it can sign in as you. If you
          lose it and every device you are signed in on, we may not be able to restore your
          account. You are responsible for activity on your account.
        </LegalText>
      </LegalSection>

      <LegalSection title="Acceptable use">
        <LegalText>You agree not to:</LegalText>
        <LegalList>
          <li>use Divvy for anything unlawful, or to harass, threaten or deceive anyone;</li>
          <li>access, or try to access, groups, accounts or data that are not yours;</li>
          <li>interfere with, overload or disrupt Divvy, or get around its limits or security.</li>
        </LegalList>
        <LegalText>We may suspend or remove an account that breaks these terms.</LegalText>
      </LegalSection>

      <LegalSection title="Your content">
        <LegalText>
          You keep ownership of what you add. You give us permission to store it, keep backup
          copies of it and show it to the people you share it with, only as needed to run Divvy.
          Everything you add to a group can be seen by everyone in that group, so add only what
          you are happy for them to see. The Privacy Policy explains what is kept, for how long,
          and how to download or delete it.
        </LegalText>
      </LegalSection>

      <LegalSection title="Ending your use">
        <LegalText>
          You can stop using Divvy at any time, and delete your account from{" "}
          <strong>You → Delete my account</strong> once you are settled up with everyone. We may
          change, suspend or stop Divvy at any time.
        </LegalText>
      </LegalSection>

      <LegalSection title="Disclaimer">
        <LegalText>
          Divvy is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties
          of any kind. We do not promise that it will be free of errors or always available. Keep
          your own copy of anything important with <strong>You → Download a backup</strong>.
        </LegalText>
      </LegalSection>

      <LegalSection title="Limitation of liability">
        <LegalText>
          To the extent the law allows, we are not liable for any loss arising from your use of
          Divvy, including mistakes in balances or lost data.
        </LegalText>
      </LegalSection>

      <LegalSection title="Changes to these terms">
        <LegalText>
          We may update these terms. When we do, we will post the new version here and update the
          date at the top. Continuing to use Divvy after a change means you accept the updated
          terms.
        </LegalText>
      </LegalSection>

      {contact ? (
        <LegalSection title="Contact us">
          <LegalText>{contact}</LegalText>
        </LegalSection>
      ) : null}

      <LegalLinks other={{ href: "/privacy", label: "Privacy Policy" }} />
    </LegalPage>
  );
}
