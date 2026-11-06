import { api } from "@/lib/client/api";
import { signInCodeIn } from "@/lib/invite-code";
import type { MeDto } from "@/lib/types";

/** Where to get a code, for someone on the screen that asks for one. */
export const SIGN_IN_CODE_HELP =
  "In Divvy where you\u2019re signed in, go to You, Your devices, Add another device, and copy the sign-in code.";

/** Signs this device in with a code from another one. */
export async function claimSignInCode(text: string): Promise<MeDto> {
  const { me } = await api.post<{ me: MeDto }>(
    `/api/identity/link/${encodeURIComponent(signInCodeIn(text))}/claim`,
  );
  return me;
}
