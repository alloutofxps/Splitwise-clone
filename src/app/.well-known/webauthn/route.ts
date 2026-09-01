import { NextResponse } from "next/server";
import { relatedOrigins } from "@/lib/webauthn";

/**
 * Related Origin Requests.
 *
 * A browser fetches this when it meets a passkey whose Relying Party ID is not
 * the domain it is currently on. Listing the other address here is what lets a
 * passkey made at the old domain still work at the new one, which turns a
 * domain move from a cutover that locks everybody out into an overlap they
 * never notice.
 *
 * Empty by default — an app with one address needs nothing here, and an empty
 * list is the correct answer rather than a missing file.
 */
export function GET() {
  return NextResponse.json(
    { origins: relatedOrigins() },
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
