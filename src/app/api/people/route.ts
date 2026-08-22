import { json, route } from "@/lib/api";
import { requireSession } from "@/lib/identity";
import { visiblePeople } from "@/server/me";

/**
 * Everyone the caller can see, for rendering names and avatars without a
 * lookup per row. Small by nature - it is your friends and groupmates, not a
 * directory.
 */
export const GET = route(async () => {
  const session = await requireSession();
  return json({ people: await visiblePeople(session.person.id) });
});
