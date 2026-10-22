import type { Metadata } from "next";

/** The screen's name in the browser and for screen readers: "Activity · Divvy". */
export const metadata: Metadata = { title: "Activity" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
