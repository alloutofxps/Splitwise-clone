// iPhone and iPad launch screens: the app's real first frame, photographed.
//
//   node scripts/launch-screens.mjs <base-url>
//
// Opening Divvy from the home screen, iOS shows a launch image until the page
// has drawn. Without one it shows a blank white screen, even at Night. These
// images are what the app itself draws first (Home's outline, before the logo
// starts drawing), so the app appears over an identical picture.
//
// For each device and theme it opens the app signed in, holds the dashboard
// request back so the opening outline stays up, tells the browser the
// device's notch and home-bar sizes (Apple's published safe areas), freezes
// every animation at its first frame and takes the picture at the device's
// exact pixel size. Writes public/launch/*.png and src/app/launch-screens.ts,
// the list the root layout puts in every page's head. Run it against a
// production build after anything changes Home's outline, the tab bar or the
// colours.
import { chromium } from "playwright";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";

/**
 * Screens in portrait CSS pixels, their pixel ratio, and the safe areas iOS
 * gives a web app in portrait (and, for iPads, landscape). Devices that share
 * a screen also share an image: iOS can only tell them apart by size.
 * Only devices that run iOS 16.4 or later, which Divvy needs.
 */
const DEVICES = [
  { name: "iPhone SE, 8", w: 375, h: 667, dpr: 2, top: 20, bottom: 0 },
  { name: "iPhone 8 Plus", w: 414, h: 736, dpr: 3, top: 20, bottom: 0 },
  { name: "iPhone X, XS, 11 Pro, 12 mini, 13 mini", w: 375, h: 812, dpr: 3, top: 44, bottom: 34 },
  { name: "iPhone XR, 11", w: 414, h: 896, dpr: 2, top: 48, bottom: 34 },
  { name: "iPhone XS Max, 11 Pro Max", w: 414, h: 896, dpr: 3, top: 44, bottom: 34 },
  { name: "iPhone 12, 13, 14, 16e", w: 390, h: 844, dpr: 3, top: 47, bottom: 34 },
  { name: "iPhone 12 Pro Max, 13 Pro Max, 14 Plus", w: 428, h: 926, dpr: 3, top: 47, bottom: 34 },
  { name: "iPhone 14 Pro, 15, 15 Pro, 16", w: 393, h: 852, dpr: 3, top: 59, bottom: 34 },
  { name: "iPhone 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus", w: 430, h: 932, dpr: 3, top: 59, bottom: 34 },
  { name: "iPhone 16 Pro, 17, 17 Pro", w: 402, h: 874, dpr: 3, top: 62, bottom: 34 },
  { name: "iPhone Air", w: 420, h: 912, dpr: 3, top: 62, bottom: 34 },
  { name: "iPhone 16 Pro Max, 17 Pro Max", w: 440, h: 956, dpr: 3, top: 62, bottom: 34 },
  { name: "iPad 9.7-inch, mini 5", w: 768, h: 1024, dpr: 2, top: 20, bottom: 0, ipad: true },
  { name: "iPad 10.2-inch", w: 810, h: 1080, dpr: 2, top: 20, bottom: 0, ipad: true },
  { name: "iPad Air 10.5-inch", w: 834, h: 1112, dpr: 2, top: 20, bottom: 0, ipad: true },
  { name: "iPad mini 6, 7", w: 744, h: 1133, dpr: 2, top: 24, bottom: 20, ipad: true },
  { name: "iPad 10th, Air 10.9 and 11-inch", w: 820, h: 1180, dpr: 2, top: 24, bottom: 20, ipad: true },
  { name: "iPad Pro 11-inch", w: 834, h: 1194, dpr: 2, top: 24, bottom: 20, ipad: true },
  { name: "iPad Pro 11-inch (M4)", w: 834, h: 1210, dpr: 2, top: 24, bottom: 20, ipad: true },
  { name: "iPad Pro 12.9-inch, Air 13-inch", w: 1024, h: 1366, dpr: 2, top: 24, bottom: 20, ipad: true },
  { name: "iPad Pro 13-inch (M4)", w: 1032, h: 1376, dpr: 2, top: 24, bottom: 20, ipad: true },
];

// A signed-in account to photograph: Home's outline is what a returning
// person, the one opening the app from the home screen, sees first.
async function signUp() {
  const address = `198.20.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const response = await fetch(`${BASE}/api/identity`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": address },
    body: JSON.stringify({ displayName: "Launch Screen", avatarColor: "teal", defaultCurrency: "EUR" }),
  });
  const cookie = /divvy_id=([^;]*)/.exec(response.headers.get("set-cookie") ?? "")?.[1];
  if (!response.ok || !cookie) throw new Error(`sign-up failed: ${response.status}`);
  return cookie;
}

const OUT = "public/launch";
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const cookie = await signUp();
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const screens = [];

for (const device of DEVICES) {
  const orientations = device.ipad ? ["portrait", "landscape"] : ["portrait"];
  for (const orientation of orientations) {
    for (const scheme of ["light", "dark"]) {
      const portrait = orientation === "portrait";
      const width = portrait ? device.w : device.h;
      const height = portrait ? device.h : device.w;
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: device.dpr,
        isMobile: true,
        hasTouch: true,
        colorScheme: scheme,
        serviceWorkers: "block",
      });
      await context.addCookies([{ name: "divvy_id", value: cookie, url: BASE }]);
      const page = await context.newPage();
      // The outline stays up for as long as the dashboard hasn't answered.
      await page.route("**/api/dashboard**", () => new Promise(() => {}));
      const cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setSafeAreaInsetsOverride", {
        insets: { top: device.top, bottom: device.bottom, left: 0, right: 0 },
      });
      await page.goto(BASE, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      // The first frame: every animation (the logo drawing itself) at its start.
      await page.evaluate(() =>
        document.getAnimations().forEach((animation) => {
          animation.pause();
          animation.currentTime = 0;
        }),
      );
      await page.waitForTimeout(100);
      const file = `launch-${width * device.dpr}x${height * device.dpr}-${scheme}.png`;
      await page.screenshot({ path: `${OUT}/${file}` });
      screens.push({
        url: `/launch/${file}`,
        media:
          `screen and (device-width: ${device.w}px) and (device-height: ${device.h}px) and ` +
          `(-webkit-device-pixel-ratio: ${device.dpr}) and (orientation: ${orientation}) and ` +
          `(prefers-color-scheme: ${scheme})`,
      });
      console.log(`${file}  ${device.name}`);
      await context.close();
    }
  }
}
await browser.close();

writeFileSync(
  "src/app/launch-screens.ts",
  `// Written by scripts/launch-screens.mjs; run it again rather than editing.\n` +
    `// iOS launch images, one per screen size, orientation and theme.\n` +
    `export const LAUNCH_SCREENS: { url: string; media: string }[] = [\n` +
    screens.map((screen) => `  { url: ${JSON.stringify(screen.url)}, media: ${JSON.stringify(screen.media)} },\n`).join("") +
    `];\n`,
);
console.log(`${screens.length} launch screens`);
