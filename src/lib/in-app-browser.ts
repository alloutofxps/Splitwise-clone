/** What these apps put in the browser's description of itself. First match wins. */
const APPS: [RegExp, string][] = [
  [/WhatsApp/i, "WhatsApp"],
  [/Instagram/i, "Instagram"],
  // WeChat calls itself MicroMessenger, and Messenger says FB too, so the order
  // of these three matters.
  [/MicroMessenger/i, "WeChat"],
  [/Messenger|FB_IAB\/MESSENGER/i, "Messenger"],
  [/FBAN|FBAV|FB_IAB/i, "Facebook"],
  [/\bLine\//i, "LINE"],
  [/Snapchat/i, "Snapchat"],
  [/TikTok|musical_ly|BytedanceWebview/i, "TikTok"],
  [/LinkedInApp/i, "LinkedIn"],
];

/**
 * The name to use if this is a browser inside another app, or null for a real
 * browser. Any other app gets a general description where it can be told apart:
 * an iPhone browser that doesn't call itself Safari, or Android's `wv` marker.
 * The home-screen app also doesn't say Safari, so the caller rules that out.
 */
export function inAppBrowserName(userAgent: string): string | null {
  const named = APPS.find(([pattern]) => pattern.test(userAgent));
  if (named) return named[1];
  const iPhone = /iPhone|iPad|iPod/.test(userAgent) && !/Safari\//.test(userAgent);
  const android = /Android/.test(userAgent) && /;\s*wv\)/.test(userAgent);
  return iPhone || android ? "this app" : null;
}
