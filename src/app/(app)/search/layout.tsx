import type { Metadata } from "next";

/** The screen's name in the browser and for screen readers: "Search · Divvy". */
export const metadata: Metadata = { title: "Search" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
