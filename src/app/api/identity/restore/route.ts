import { z } from "zod";
import { json, readBody, route } from "@/lib/api";
import { restoreIdentity, setIdentityCookie } from "@/lib/identity";
import { meDto } from "@/server/me";

const schema = z.object({
  recoveryKey: z.string().min(8, "That key looks too short."),
});

/**
 * Restores an identity on a new device from its recovery key.
 *
 * Deliberately unthrottled at the app layer but resistant by construction: the
 * key is 32 random bytes, so guessing is not a threat model that rate limiting
 * meaningfully improves. Put the app behind a reverse proxy with rate limiting
 * if it is exposed to the open internet.
 */
export const POST = route(async (request: Request) => {
  const { recoveryKey } = await readBody(request, schema);

  // The same secret is re-signed into a cookie rather than rotated, so the key
  // keeps working on the old device too - which is what "restore" should mean
  // when someone is moving between a phone and a laptop.
  const { person, secret } = await restoreIdentity(recoveryKey);
  await setIdentityCookie(person.id, secret);

  return json({ me: await meDto(person) });
});
