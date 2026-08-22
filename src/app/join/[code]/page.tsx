"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, UserCheck } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button, Skeleton, cn, haptic } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Wordmark } from "@/components/app-shell";
import { api, ApiError } from "@/lib/client/api";
import { colorForName, initials } from "@/lib/avatar";
import { normalizeInviteCode } from "@/lib/invite-code";
import type { MeDto, PersonDto } from "@/lib/types";

interface GroupPreview {
  kind: "group";
  group: {
    id: string;
    name: string;
    emoji: string;
    currency: string;
    memberCount: number;
    expenseCount: number;
    members: PersonDto[];
    unclaimedMembers: PersonDto[];
  };
}

interface PersonPreview {
  kind: "person";
  person: PersonDto;
}

/**
 * The invite landing page.
 *
 * Somebody tapped a link in a group chat. They may have the app set up, or this
 * may be the very first thing they ever see of it — so this page handles both
 * without a redirect, and shows what they are joining *before* asking for
 * anything. Seeing "Lisbon 2026 · 4 people · 23 expenses" first is what makes
 * typing your name feel reasonable rather than like a sign-up wall.
 */
export default function JoinPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();

  const code = normalizeInviteCode(params.code ?? "");

  const [preview, setPreview] = React.useState<GroupPreview | PersonPreview | null>(null);
  const [me, setMe] = React.useState<MeDto | null | undefined>(undefined);
  const [error, setError] = React.useState<string | null>(null);
  const [claimId, setClaimId] = React.useState<string | null>(null);
  const [joining, setJoining] = React.useState(false);
  const [name, setName] = React.useState("");

  // Load the invite and the viewer's identity together: which of the two paths
  // this page takes depends on both.
  React.useEffect(() => {
    let cancelled = false;

    // Both branches settle inside, so nothing is left to reject; `void` says
    // the promise is deliberately unheld rather than forgotten.
    void Promise.all([
      api
        .get<GroupPreview | PersonPreview>(`/api/invite/${encodeURIComponent(code)}`)
        .catch((caught: unknown) => {
          if (!cancelled) {
            setError(
              caught instanceof ApiError ? caught.message : "That invite link is not valid.",
            );
          }
          return null;
        }),
      api
        .get<{ me: MeDto }>("/api/identity")
        .then((result) => result.me)
        .catch(() => null),
    ]).then(([invite, identity]) => {
      if (cancelled) return;
      setPreview(invite);
      setMe(identity);
    });

    return () => {
      cancelled = true;
    };
  }, [code]);

  const join = async (claim?: string | null) => {
    setJoining(true);
    try {
      const result = await api.post<{ kind: string; groupId?: string }>(
        `/api/invite/${encodeURIComponent(code)}/join`,
        { claimPersonId: claim ?? undefined },
      );
      await client.invalidateQueries();
      haptic([8, 30, 8]);
      if (result.kind === "group" && result.groupId) {
        router.push(`/groups/${result.groupId}`);
      } else {
        router.push("/friends");
      }
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not join",
        description: caught instanceof ApiError ? caught.message : undefined,
      });
      setJoining(false);
    }
  };

  /** New arrival: create the identity, then redeem the code in one go. */
  const createAndJoin = async () => {
    if (!name.trim()) return;
    setJoining(true);
    try {
      await api.post("/api/identity", {
        displayName: name.trim(),
        avatarColor: colorForName(name),
        // Claiming a placeholder folds this person into the existing member
        // rather than creating a second one, so it happens at creation time.
        claimGhostId: claimId ?? undefined,
      });
      await join(claimId);
    } catch (caught) {
      toast({
        tone: "error",
        title: "Could not set that up",
        description: caught instanceof ApiError ? caught.message : undefined,
      });
      setJoining(false);
    }
  };

  if (me === undefined) {
    return (
      <div className="mx-auto w-full max-w-[440px] px-6 pt-16">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-6 h-32 w-full rounded-[--radius-xl]" />
      </div>
    );
  }

  if (error || !preview) {
    return (
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col justify-center px-6 text-center">
        <Wordmark className="mb-8 justify-center" />
        <p className="text-[19px] font-bold text-text">This invite is not valid</p>
        <p className="mt-2 text-[14px] leading-relaxed text-muted">
          {error ?? "The code may have been changed or the group deleted."}
        </p>
        <Button variant="primary" className="mt-6" onClick={() => router.push("/")}>
          Open Divvy
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2.5rem,env(safe-area-inset-top))]">
      <Wordmark className="mb-8" />

      <div className="flex flex-1 flex-col">
        <p className="text-[13px] font-semibold uppercase tracking-[0.06em] text-subtle">
          You&rsquo;ve been invited to
        </p>

        {preview.kind === "group" ? (
          <>
            <h1 className="mt-2 flex items-center gap-2.5 text-[30px] font-black leading-tight tracking-[-0.03em] text-text">
              <span>{preview.group.emoji}</span>
              <span className="min-w-0 break-words">{preview.group.name}</span>
            </h1>
            <p className="mt-2 text-[15px] text-muted">
              {preview.group.memberCount}{" "}
              {preview.group.memberCount === 1 ? "person" : "people"} ·{" "}
              {preview.group.expenseCount}{" "}
              {preview.group.expenseCount === 1 ? "expense" : "expenses"} · settles in{" "}
              {preview.group.currency}
            </p>

            <ul className="mt-5 flex flex-wrap gap-2">
              {preview.group.members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center gap-2 rounded-full bg-surface-2 py-1.5 pl-1.5 pr-3"
                >
                  <Avatar person={member} size="xs" />
                  <span className="text-[13px] font-semibold text-text">
                    {member.displayName}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <h1 className="mt-2 text-[30px] font-black leading-tight tracking-[-0.03em] text-text">
              {preview.person.displayName}
            </h1>
            <p className="mt-2 text-[15px] text-muted">
              Add them to split expenses one-to-one.
            </p>
            <div className="mt-5">
              <Avatar person={preview.person} size="xl" />
            </div>
          </>
        )}

        {/* Placeholder claiming ------------------------------------------- */}
        {preview.kind === "group" && preview.group.unclaimedMembers.length > 0 ? (
          <div className="mt-7 rounded-[--radius-lg] border border-line bg-surface p-4">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-text">
              <UserCheck className="size-4 text-brand" />
              Which one are you?
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              These names have been splitting expenses already. Pick yours and
              everything filed against it becomes yours.
            </p>

            <ul className="mt-3 space-y-1.5">
              {preview.group.unclaimedMembers.map((member) => (
                <li key={member.id}>
                  <button
                    onClick={() => {
                      haptic();
                      setClaimId(claimId === member.id ? null : member.id);
                      if (claimId !== member.id && !name) setName(member.displayName);
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-[--radius-md] border px-3 py-2.5 text-left transition active:scale-[0.985]",
                      claimId === member.id
                        ? "border-brand bg-brand-soft"
                        : "border-line bg-surface-2",
                    )}
                  >
                    <Avatar person={member} size="sm" />
                    <span className="flex-1 truncate text-[14px] font-semibold text-text">
                      {member.displayName}
                    </span>
                    <span
                      className={cn(
                        "size-5 shrink-0 rounded-full border-2 transition",
                        claimId === member.id ? "border-brand bg-brand" : "border-line-strong",
                      )}
                    />
                  </button>
                </li>
              ))}
            </ul>

            <button
              onClick={() => {
                haptic();
                setClaimId(null);
              }}
              className="mt-2.5 w-full py-1.5 text-[13px] font-semibold text-muted"
            >
              None of these — I&rsquo;m new
            </button>
          </div>
        ) : null}

        {/* Name, only for a brand-new arrival ------------------------------ */}
        {!me ? (
          <div className="mt-7">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-muted">
                Your name
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="flex size-12 shrink-0 items-center justify-center rounded-full text-[17px] font-bold text-white transition-colors duration-300"
                  style={{ background: `var(--avatar-${colorForName(name || "divvy")})` }}
                >
                  {name.trim() ? initials(name) : "?"}
                </span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value.slice(0, 60))}
                  onKeyDown={(event) => void (event.key === "Enter" && createAndJoin())}
                  placeholder="Priya"
                  autoFocus
                  enterKeyHint="go"
                  className="h-12 min-w-0 flex-1 rounded-[--radius-md] border border-line bg-surface px-4 text-[16px] font-medium text-text outline-none transition placeholder:text-subtle/60 focus:border-brand focus:ring-4 focus:ring-[--brand-ring]"
                />
              </div>
            </label>
            <p className="mt-2 text-[12px] leading-relaxed text-subtle">
              No email, no password. You will get a recovery key afterwards to
              save — that is the only way back in on another device.
            </p>
          </div>
        ) : null}
      </div>

      <div className="pt-8">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={joining}
          disabled={!me && !name.trim()}
          onClick={() => void (me ? join(claimId) : createAndJoin())}
        >
          {preview.kind === "group"
            ? claimId
              ? `Join as ${preview.group.unclaimedMembers.find((m) => m.id === claimId)?.displayName}`
              : `Join ${preview.group.name}`
            : `Add ${preview.person.displayName}`}
          <ArrowRight className="size-[18px]" />
        </Button>

        {me ? (
          <p className="mt-3 text-center text-[12px] text-subtle">
            Joining as {me.displayName}
          </p>
        ) : null}
      </div>
    </div>
  );
}
