import type { Metadata } from "next";

/**
 * The screen's name in the browser and for screen readers: "Friends · Divvy".
 * The template is passed on, or a friend's screen below loses its ending.
 */
export const metadata: Metadata = { title: { default: "Friends", template: "%s · Divvy" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
