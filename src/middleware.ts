import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs in front of every request.
 *
 * Three jobs:
 *
 * 1. **Content-Security-Policy with a per-request nonce.** Only scripts this
 *    server put on the page can run. If an injection bug ever slips in -
 *    a name, a note or a receipt filename rendered somewhere unescaped - the
 *    injected script is refused by the browser rather than reading balances.
 *    Next reads the nonce from the request's CSP header and stamps it on its
 *    own scripts; the one inline script we write (`app/layout.tsx`) reads it
 *    from `x-nonce`.
 * 2. **A request id**, so a log line and a user's complaint can be matched.
 * 3. **An early size check**, so a request that declares an oversized body is
 *    refused before any handler runs. Handlers enforce their exact limits as
 *    they read (`lib/api.ts`), for clients that send no length at all.
 */

const MAX_DECLARED_BODY = 34 * 1024 * 1024;

export function middleware(request: NextRequest) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_DECLARED_BODY) {
    return NextResponse.json(
      { error: "That request is too large.", code: "too_large" },
      { status: 413 },
    );
  }

  const nonce = btoa(crypto.randomUUID());
  const production = process.env.NODE_ENV === "production";
  // HTTPS-only directives follow the connection, not the build: a production
  // build served over plain http (a local check, a CI smoke test) would
  // otherwise upgrade its own asset requests to https and fail to load.
  const https =
    request.nextUrl.protocol === "https:" ||
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();

  const csp = [
    "default-src 'self'",
    // `strict-dynamic` lets Next's nonced loader pull in its own chunks. The
    // dev server additionally needs eval for fast refresh.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    // Motion and layout code set inline style attributes throughout; styles
    // cannot run code, so this is the accepted trade-off.
    "style-src 'self' 'unsafe-inline'",
    // Receipts preview as blob: URLs, QR codes render as data: URLs.
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("x-request-id", requestId);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Request-Id", requestId);
  if (https) {
    // Two years, every subdomain: after the first visit the browser never
    // tries plain HTTP again, so a hostile network cannot downgrade it.
    response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except immutable build assets and static files, which carry
    // their own headers from next.config.ts and never render a page.
    "/((?!_next/static|_next/image|icons/|favicon.ico|manifest.webmanifest|sw.js).*)",
  ],
};
