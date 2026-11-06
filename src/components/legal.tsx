import type { ReactNode } from "react";
import Link from "next/link";

/** The privacy and terms pages: one column, with the date they last changed. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-[640px] px-6 pb-12 pt-[max(3rem,var(--top-safe))] text-body-lg leading-relaxed text-text">
      <h1 className="text-display-sm font-semibold tracking-[-0.03em]">{title}</h1>
      <p className="mt-2 text-muted">Last updated {updated}</p>
      {children}
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mt-8 text-title-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="mt-3 list-disc space-y-2 pl-5 text-muted">{children}</ul>;
}

export function LegalText({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-muted">{children}</p>;
}

/** Back to the app, and across to the other page. */
export function LegalLinks({ other }: { other: { href: string; label: string } }) {
  const link = "inline-flex min-h-11 min-w-11 items-center font-semibold text-brand";
  return (
    <p className="mt-8 flex flex-wrap gap-x-6">
      <Link href="/" className={link}>
        Back to Divvy
      </Link>
      <Link href={other.href} className={link}>
        {other.label}
      </Link>
    </p>
  );
}
