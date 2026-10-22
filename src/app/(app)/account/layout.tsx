import type { Metadata } from "next";

/** The screen's name in the browser and for screen readers: "You · Divvy". */
export const metadata: Metadata = { title: "You" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
