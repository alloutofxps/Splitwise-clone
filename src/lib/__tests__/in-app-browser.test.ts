import { describe, expect, it } from "vitest";
import { inAppBrowserName } from "../in-app-browser";

const iPhone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const android = "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36";

describe("inAppBrowserName", () => {
  it.each([
    [`${iPhone} Mobile/15E148 WhatsApp/2.26.1`, "WhatsApp"],
    [`${iPhone} Mobile/15E148 Instagram 300.0`, "Instagram"],
    [`${iPhone} Mobile/15E148 [FBAN/FBIOS;FBAV/400.0]`, "Facebook"],
    [`${iPhone} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/400.0]`, "Messenger"],
    [`${android} [FB_IAB/MESSENGER;FBAV/400.0]`, "Messenger"],
    [`${android} [FB_IAB/FB4A;FBAV/400.0]`, "Facebook"],
    [`${iPhone} Mobile/15E148 Line/14.0`, "LINE"],
    [`${iPhone} Mobile/15E148 MicroMessenger/8.0`, "WeChat"],
    [`${iPhone} Mobile/15E148 Snapchat/12.0`, "Snapchat"],
    [`${iPhone} Mobile/15E148 musical_ly_30.0`, "TikTok"],
    [`${iPhone} Mobile/15E148 LinkedInApp/9.0`, "LinkedIn"],
  ])("names the app: %s", (userAgent, name) => {
    expect(inAppBrowserName(userAgent)).toBe(name);
  });

  it("describes other apps it can tell apart", () => {
    expect(inAppBrowserName(`${iPhone} Mobile/15E148`)).toBe("this app");
    expect(inAppBrowserName(android)).toBe("this app");
  });

  it.each([
    `${iPhone} Version/18.0 Mobile/15E148 Safari/604.1`,
    `${iPhone} CriOS/126.0 Mobile/15E148 Safari/604.1`,
    `${iPhone} FxiOS/126.0 Mobile/15E148 Safari/605.1.15`,
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  ])("leaves a real browser alone: %s", (userAgent) => {
    expect(inAppBrowserName(userAgent)).toBeNull();
  });
});
