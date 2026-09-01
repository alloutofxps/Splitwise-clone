"use client";

import * as React from "react";
import {
  MAX_ATTACHMENTS,
  processFiles,
  type PendingAttachment,
} from "@/lib/client/attachments";
import { SHARE_FLAG, takeSharedPayload } from "@/lib/client/share-target";

/**
 * What the app was launched *for*.
 *
 * Three entry points arrive as a plain GET with a query string and are
 * otherwise indistinguishable from someone opening the home screen:
 *
 *   `?compose=1`      the "Add an expense" home-screen shortcut
 *   `?share=1`        a receipt shared in from another app, parked by the
 *                     service worker for this launch to collect
 *   `?share=unavailable`
 *                     a share that arrived while no worker was controlling the
 *                     page, so the files could not be kept
 *
 * The query is read once and erased from the URL in the same tick. Leaving it
 * in place would mean a refresh, a back gesture, or a restored tab re-opening
 * the composer — and in the share case, doing so with a receipt that has
 * already been consumed.
 *
 * Nothing is read until `enabled`, which the caller ties to having an identity.
 * The relay is one-shot, so reading it on a device that is about to show the
 * onboarding screen would destroy the shared photo to open a composer that
 * cannot exist yet. Waiting costs nothing: a share sits in its cache until it
 * is collected or expires.
 */

export interface LaunchIntent {
  /** Open the expense composer. */
  compose: boolean;
  attachments: PendingAttachment[];
  description: string;
  /** Something to tell the user about how they got here, if anything. */
  notice: string | null;
}

const NOTHING: LaunchIntent = {
  compose: false,
  attachments: [],
  description: "",
  notice: null,
};

export function useLaunchIntent(enabled: boolean): LaunchIntent {
  const [intent, setIntent] = React.useState<LaunchIntent>(NOTHING);

  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const compose = params.get("compose") === "1";
    const share = params.get(SHARE_FLAG);
    if (!compose && !share) return;

    // Erase before doing any async work, so a reload during file processing
    // cannot start a second one.
    params.delete("compose");
    params.delete(SHARE_FLAG);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`,
    );

    if (share === "unavailable") {
      setIntent({
        compose: true,
        attachments: [],
        description: "",
        notice: "That receipt could not be brought across. Add it here instead.",
      });
      return;
    }

    if (!share) {
      setIntent({ ...NOTHING, compose: true });
      return;
    }

    let cancelled = false;

    const collect = async () => {
      const payload = await takeSharedPayload();

      if (cancelled) return;

      if (!payload) {
        // The stash expired, or the worker never wrote one. An empty composer
        // is still the right destination — the user did ask to add something.
        setIntent({ ...NOTHING, compose: true });
        return;
      }

      const { accepted, failures } = await processFiles(payload.files, MAX_ATTACHMENTS);

      if (cancelled) return;

      setIntent({
        compose: true,
        attachments: accepted,
        description: payload.note,
        notice:
          failures.length > 0
            ? `${failures.length} shared file${failures.length === 1 ? "" : "s"} could not be read.`
            : null,
      });
    };

    void collect();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return intent;
}
