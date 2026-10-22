import type { Metadata } from "next";
import { groupPageName } from "@/server/page-names";

/** The screen's name in the browser and for screen readers: "Lisbon 2026 · Divvy". */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await groupPageName(id)) ?? "Group" };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
