import { Wordmark } from "@/components/app-shell";

/**
 * The service worker's last-resort fallback for a navigation it cannot serve.
 *
 * Rarely seen in practice - the cached app shell handles almost every offline
 * navigation - but a PWA with no offline page at all shows the browser's dinosaur,
 * which looks like the app is broken rather than the network.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col justify-center px-6 text-center">
      <Wordmark className="mb-8 justify-center" />
      <h1 className="text-heading font-bold tracking-[-0.02em] text-text">
        You&rsquo;re offline
      </h1>
      <p className="mt-2 text-subhead leading-relaxed text-muted">
        Divvy needs a connection to load this page for the first time. Anything
        you have already opened still works, and anything you add now will sync
        when you reconnect.
      </p>
      {/*
        A plain anchor rather than next/link, deliberately: a client-side
        navigation would be served by the same service worker that just failed
        to reach the network. A real page load is the retry.
      */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mx-auto mt-6 flex h-11 items-center justify-center rounded-[var(--radius-md)] bg-brand px-5 text-subhead font-semibold text-white"
      >
        Try again
      </a>
    </div>
  );
}
