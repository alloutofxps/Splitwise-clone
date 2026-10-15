import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { NextConfig } from "next";

/**
 * A value that changes when the deployed code changes.
 *
 * The service worker names its caches after this and is registered as
 * `/sw.js?v=<id>`, which is what makes an update detectable at all: a worker
 * script whose bytes never change is never re-evaluated, so a hard-coded
 * version would pin last week's cached API responses on a user's phone until
 * they uninstalled the app.
 *
 * Read from the environment first so a platform that knows its own commit can
 * say so, then from git, then from the package version. A checkout with
 * uncommitted changes therefore keeps one id across rebuilds — fine, because
 * the dev worker is never registered.
 */
function buildId(): string {
  const declared =
    process.env.NEXT_PUBLIC_BUILD_ID ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA;
  if (declared) return declared.slice(0, 12);

  try {
    // execFile rather than exec: no shell, so nothing here can be influenced by
    // the environment's own quoting rules.
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Not a git checkout - a tarball deploy, or a Docker build without .git.
  }

  try {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version?: string };
    if (pkg.version) return `v${pkg.version}`;
  } catch {
    // Fall through.
  }

  return "dev";
}

const BUILD_ID = buildId();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Inlined into both bundles, so the client can name the worker it registers.
  env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID },
  // eslint-disable-next-line @typescript-eslint/require-await
  generateBuildId: async () => BUILD_ID,
  // There are no Server Actions in this app. The 12 MB `serverActions` limit
  // that used to sit here looked like a request-size cap and was not one: it
  // applies only to Server Actions, not to route handlers. Request bodies are
  // capped in `lib/api.ts` (`readBody`) and `middleware.ts` instead.
  poweredByHeader: false,
  // `async` with nothing to await, because `NextConfig` types `headers` as
  // returning a promise and this is the shape Next's own documentation uses.
  // eslint-disable-next-line @typescript-eslint/require-await
  async headers() {
    return [
      {
        // The service worker must never be served stale or it will pin an old
        // app shell on the user's phone until they uninstall the PWA.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // The receipt reader's engine and language data: several megabytes
        // that only change with the package version, so a phone keeps them.
        source: "/ocr/:file*",
        headers: [{ key: "Cache-Control", value: "public, max-age=2592000" }],
      },
      {
        source: "/:path*",
        // The Content-Security-Policy and HSTS are set per request in
        // `middleware.ts`, because the CSP carries a fresh nonce each time.
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
