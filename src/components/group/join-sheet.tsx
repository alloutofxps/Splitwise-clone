"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { UserCheck } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { Button, Skeleton, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { api, ApiError } from "@/lib/client/api";
import { normalizeInviteCode } from "@/lib/invite-code";
import type { PersonDto } from "@/lib/types";

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

type Preview = GroupPreview | PersonPreview;

/**
 * Redeeming an invite code.
 *
 * The code is previewed before anything is joined, which matters for two
 * reasons: you can check you have the right group before committing, and the
 * preview is where unclaimed placeholder names are offered. Picking your own
 * name there merges a week of expenses somebody already filed against "Sam"
 * into your real account, rather than leaving a ghost Sam owing money forever.
 */
export function JoinSheet({
  open,
  onClose,
  initialCode,
}: {
  open: boolean;
  onClose: () => void;
  initialCode?: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();

  const [code, setCode] = React.useState(initialCode ?? "");
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [joining, setJoining] = React.useState(false);
  const [claimId, setClaimId] = React.useState<string | null>(null);
  const [notFound, setNotFound] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setCode(initialCode ?? "");
      setPreview(null);
      setClaimId(null);
      setNotFound(false);
    }
  }, [open, initialCode]);

  // Look the code up as it is typed, debounced. Nobody should have to press a
  // "check" button to find out whether they typed the code correctly.
  React.useEffect(() => {
    const normalized = normalizeInviteCode(code);
    if (normalized.length < 5) {
      setPreview(null);
      setNotFound(false);
      return;
    }

    let cancelled = false;
    setChecking(true);

    const look = async () => {
      try {
        const result = await api.get<Preview>(`/api/invite/${encodeURIComponent(normalized)}`);
        if (!cancelled) {
          setPreview(result);
          setNotFound(false);
        }
      } catch {
        if (!cancelled) {
          setPreview(null);
          setNotFound(true);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    // `setTimeout` wants a void-returning callback, and handing it an async
    // function means nothing is holding the promise: every outcome is already
    // handled inside `look`, so `void` says that rather than leaving it to be
    // read as an oversight.
    const timer = setTimeout(() => void look(), 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      setChecking(false);
    };
  }, [code]);

  const join = async () => {
    if (!preview) return;
    setJoining(true);
    try {
      const result = await api.post<{ kind: string; groupId?: string }>(
        `/api/invite/${encodeURIComponent(normalizeInviteCode(code))}/join`,
        { claimPersonId: claimId ?? undefined },
      );
      await client.invalidateQueries();
      haptic([8, 30, 8]);
      onClose();

      if (result.kind === "group" && result.groupId) {
        toast({ tone: "success", title: "You're in" });
        router.push(`/groups/${result.groupId}`);
      } else {
        toast({ tone: "success", title: "Friend added" });
      }
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not join",
        description: error instanceof ApiError ? error.message : undefined,
      });
    } finally {
      setJoining(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Join with a code"
      footer={
        preview ? (
          <Button variant="primary" size="lg" fullWidth loading={joining} onClick={() => void join()}>
            {preview.kind === "group"
              ? claimId
                ? `Join as ${preview.group.unclaimedMembers.find((m) => m.id === claimId)?.displayName}`
                : `Join ${preview.group.name}`
              : `Add ${preview.person.displayName}`}
          </Button>
        ) : undefined
      }
    >
      <div className="px-5 pb-6">
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="mango-tiger-42"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          className="h-14 w-full rounded-[--radius-md] border border-line bg-surface px-4 text-center text-[19px] font-bold tracking-[0.02em] text-text outline-none transition placeholder:font-medium placeholder:text-subtle/60 focus:border-brand focus:ring-4 focus:ring-[--brand-ring]"
        />

        <p className="mt-2 text-center text-[12px] text-subtle">
          Ask whoever set the group up for their invite code.
        </p>

        <div className="mt-5">
          {checking ? (
            <div className="flex items-center gap-3 rounded-[--radius-lg] border border-line bg-surface p-4">
              <Skeleton className="size-11 rounded-[--radius-md]" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-32" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          ) : notFound ? (
            <p className="rounded-[--radius-md] bg-negative-soft px-4 py-3 text-center text-[13px] font-semibold text-negative-text">
              No group or person has that code.
            </p>
          ) : preview?.kind === "group" ? (
            <div className="rounded-[--radius-lg] border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[--radius-md] bg-surface-2 text-[22px]">
                  {preview.group.emoji}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-bold text-text">
                    {preview.group.name}
                  </p>
                  <p className="text-[12px] text-muted">
                    {preview.group.memberCount}{" "}
                    {preview.group.memberCount === 1 ? "member" : "members"} ·{" "}
                    {preview.group.expenseCount}{" "}
                    {preview.group.expenseCount === 1 ? "expense" : "expenses"} ·{" "}
                    {preview.group.currency}
                  </p>
                </div>
              </div>

              {preview.group.unclaimedMembers.length > 0 ? (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-text">
                    <UserCheck className="size-4 text-brand" />
                    Are you one of these?
                  </p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">
                    Someone has been splitting with these names. Pick yours and
                    everything filed against it becomes yours.
                  </p>

                  <ul className="mt-3 space-y-1.5">
                    {preview.group.unclaimedMembers.map((member) => (
                      <li key={member.id}>
                        <button
                          onClick={() => {
                            haptic();
                            setClaimId(claimId === member.id ? null : member.id);
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
                              claimId === member.id
                                ? "border-brand bg-brand"
                                : "border-line-strong",
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
                    None of these — I&rsquo;m new here
                  </button>
                </div>
              ) : null}
            </div>
          ) : preview?.kind === "person" ? (
            <div className="flex items-center gap-3 rounded-[--radius-lg] border border-line bg-surface p-4">
              <Avatar person={preview.person} size="lg" />
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold text-text">
                  {preview.person.displayName}
                </p>
                <p className="text-[12px] text-muted">
                  Add them so you can split expenses one-to-one.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}
