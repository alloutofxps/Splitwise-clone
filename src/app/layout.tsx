import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Bricolage_Grotesque, Instrument_Serif, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";

/**
 * Self-hosted via next/font, which inlines the font files into the build. A
 * webfont fetched from a CDN would be the one thing in an offline-capable app
 * that still needs the network, and the resulting flash of fallback text is
 * exactly the kind of detail that makes a PWA feel like a website.
 */
const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
  // The variable font covers every weight the design uses in one file.
  axes: ["opsz"],
});

/**
 * The display face, for the numbers people come to look at and the headlines.
 * Expressive at large sizes - its optical-size axis tightens the letterforms
 * as they grow - with tabular figures, so a balance that counts does not wobble.
 */
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bricolage",
  axes: ["opsz", "wdth"],
});

/**
 * The serif, in italic, for the words that carry feeling: names, "all square",
 * the greeting. Used sparingly - a word or two a screen - so it lands.
 */
const serif = Instrument_Serif({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument",
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: {
    default: "Divvy - split expenses with friends",
    template: "%s · Divvy",
  },
  description:
    "Share expenses with friends and housemates. Every feature, no accounts, no paywall.",
  applicationName: "Divvy",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    // Lets the app's own header sit under the status bar instead of beside it.
    statusBarStyle: "black-translucent",
    title: "Divvy",
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
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#111014" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content-Security-Policy only lets scripts carrying this request's
  // nonce run (see `middleware.ts`), so the one inline script carries it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={`${inter.variable} ${display.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Applied before first paint, inline and synchronous. A theme resolved
          in an effect flashes white on every cold start of a dark-mode PWA,
          which is the most visible way to look unfinished.
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
