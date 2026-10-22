import type { Metadata } from "next";
import { personPageName } from "@/server/page-names";

/** The screen's name in the browser and for screen readers: "Ravi Kumar · Divvy". */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return { title: (await personPageName(id)) ?? "Friend" };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
