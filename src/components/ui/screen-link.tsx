import NextLink from "next/link";

/**
 * A link from one screen of the app to another.
 *
 * Next.js checks, as the new screen appears, whether it is in view: it asks
 * the browser where the screen is while the screen is still being built, so
 * the browser lays out the whole page there and then, and again once it is
 * built. Opening a group spent about 25ms of a 50ms frame on that with the
 * processor slowed 4x. The app shell brings the page to the top itself
 * instead, from where it already knows the page is scrolled to (AppShell).
 *
 * Links that leave the app's screens (the privacy page, a page that isn't
 * there) keep Next.js's own link.
 */
export function Link(props: React.ComponentProps<typeof NextLink>) {
  return <NextLink scroll={false} {...props} />;
}
