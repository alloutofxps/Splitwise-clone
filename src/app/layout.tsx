import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { LAUNCH_SCREENS } from "./launch-screens";

/**
 * Self-hosted via next/font, which inlines the font files into the build. A
 * webfont fetched from a CDN would be the one thing in an offline-capable app
 * that still needs the network, and the resulting flash of fallback text is
 * exactly the kind of detail that makes a PWA feel like a website.
 */
const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist",
});

/** For the things people read out or copy: invite codes, the recovery key. */
const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-geist-mono",
});

const TITLE = "Divvy: split bills with friends";
const DESCRIPTION =
  "Split bills with friends and housemates. See who owes what and pay each other back. Free, with no ads.";

/**
 * Where the app lives, for the absolute addresses a link preview needs.
 * Railway gives the running server its public domain.
 */
const SITE = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: TITLE,
    template: "%s · Divvy",
  },
  description: DESCRIPTION,
  /*
   * What WhatsApp, Messages and Slack show when a Divvy link is shared, an
   * invite above all: the name, the line above and the app's icon, instead
   * of a bare address (POLISH-AUDIT 29).
   */
  openGraph: {
    type: "website",
    siteName: "Divvy",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Divvy" }],
  },
  twitter: {
    card: "summary",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/icons/icon-512.png"],
  },
  applicationName: "Divvy",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // Lets the app's own header sit under the status bar instead of beside it.
    statusBarStyle: "black-translucent",
    title: "Divvy",
    // Shown by iOS while the app starts from the home screen: the app's own
    // first frame, so it appears over an identical picture rather than a
    // white flash (scripts/launch-screens.mjs).
    startupImage: LAUNCH_SCREENS,
  },
  formatDetection: {
    // Stops iOS turning every amount and date into a phone number link.
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays enabled - disabling it is an accessibility failure, and
  // the 16px input floor already prevents the focus-zoom it usually "fixes".
  maximumScale: 5,
  userScalable: true,
  // `cover` is what lets the layout paint into the notch and home-indicator
  // areas; every edge is then handled with env(safe-area-inset-*).
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf8" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0a" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content-Security-Policy only lets scripts carrying this request's
  // nonce run (see `middleware.ts`), so the one inline script carries it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Applied before first paint, inline and synchronous. A theme resolved
          in an effect flashes white on every cold start of a dark-mode PWA,
          which is the most visible way to look unfinished.

          The second part checks whether Divvy can be drawn properly here, and
          only if not fetches public/unsupported.js, an "update your browser"
          notice. Modern phones never download it. Its styling needs what arrived with Safari
          16.4, Chrome 111 and Firefox 128 (OKLCH colours, color-mix and
          registered properties); below that the colours and layout break.
          The check is written in old JavaScript so old browsers can run it,
          and kept tiny because its text travels twice in every page.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html: `
(function () {
  try {
    var stored = localStorage.getItem('divvy-theme');
    var system = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = stored === 'dark' || (stored !== 'light' && system);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
})();
(function () {
  var c = window.CSS, ok = false;
  try { ok = !!c && typeof c.registerProperty === 'function' && c.supports('color', 'oklch(0.5 0.1 200)') && c.supports('color', 'color-mix(in srgb, red, blue)'); } catch (e) {}
  if (ok) return;
  var s = document.createElement('script');
  s.src = '/unsupported.js';
  document.head.appendChild(s);
})();
            `.trim(),
          }}
        />
      </head>
      <body className="min-h-[100dvh] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
