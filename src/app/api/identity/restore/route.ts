import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { restoreIdentity, setIdentityCookie } from "@/lib/identity";
import { meDto } from "@/server/me";
import { limitByAddress, RECOVERY_ATTEMPT } from "@/server/rate-limit";

const schema = z.object({
  recoveryKey: z.string().min(8, "That key looks too short."),
});

/**
 * Restores an identity on a new device from its recovery key.
 *
 * Resistant by construction rather than by throttling: the key is 32 random
 * bytes, so guessing was never the threat. The limit below exists so a spray of
 * stolen keys costs the attacker 429s instead of an unbounded stream of
 * database lookups.
 */
export const POST = route(async (request: Request) => {
  limitByAddress(request, "identity-restore", RECOVERY_ATTEMPT);

  const { recoveryKey } = await readBody(request, schema);

  // The same secret is re-signed into a cookie rather than rotated, so the key
  // keeps working on the old device too - which is what "restore" should mean
  // when someone is moving between a phone and a laptop.
  const { person, secret } = await restoreIdentity(recoveryKey);
  await setIdentityCookie(person.id, secret);

  return json({ me: await meDto(person) });
});
