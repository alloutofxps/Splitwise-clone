import { NextResponse } from "next/server";

/**
 * The share target's fallback path.
 *
 * In normal operation this handler never runs: the service worker intercepts
 * the POST before it reaches the network, parks the files in a cache and
 * redirects. It exists for the window where it cannot — a worker that was
 * evicted, or one still installing when the OS delivers a share — because the
 * alternative is a browser error page on a navigation the user cannot retry.
 *
 * The files are unrecoverable here. A server cannot hand them to a device that
 * has no session-scoped place to put them, and inventing a server-side staging
 * area for a case that resolves itself on the next launch would be a database
 * table earning its keep once a year. So the share opens the composer and says
 * what happened, which takes one tap to recover from.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // The files are unrecoverable here, so the body is never parsed - only
  // released. It used to be read in full with `formData()`, by an endpoint
  // that needs no account, which let anyone make the server buffer an
  // arbitrarily large upload. Cancelling the stream closes it without reading.
  await request.body?.cancel().catch(() => {});

  return NextResponse.redirect(new URL("/?share=unavailable", request.url), 303);
}

/**
 * A GET here means someone opened the URL directly, which is not a share.
 */
export function GET(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/", request.url), 307);
}
