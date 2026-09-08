"use client";

import * as React from "react";
import { Merge } from "lucide-react";
import { Sheet, ConfirmSheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { EmptyState, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useDashboard, useMergePerson } from "@/lib/client/queries";
import { ApiError } from "@/lib/client/api";
import type { PersonDto } from "@/lib/types";

/**
 * "Who is this, really?"
 *
 * A placeholder is created the moment somebody types a name, and it starts
 * collecting that person's share straight away. When the real person joins
 * from an invite they can claim it themselves — but only while they have no
 * account. Once they do, there is a real row and a stale placeholder and the
 * two of them accumulate balances that never meet.
 *
 * Which is why this is a picker and not a name match. The two names are very
 * often different — "Sansa S" typed from memory a month ago, next to an
 * account called "Sansa" — and a spelling comparison would miss exactly the
 * cases that need fixing while confidently merging two different people who
 * happen to share a first name. Somebody has to say it, so somebody does.
 */
export function MergePersonSheet({
  open,
  onClose,
  ghost,
  candidates,
}: {
  open: boolean;
  onClose: () => void;
  ghost: PersonDto | null;
  /** Everyone this placeholder could turn out to be, already filtered. */
  candidates: PersonDto[];
}) {
  const toast = useToast();
  const merge = useMergePerson();
  const { data: dashboard } = useDashboard();
  const [chosen, setChosen] = React.useState<PersonDto | null>(null);

  const confirm = async () => {
    if (!ghost || !chosen) return;
    try {
      await merge.mutateAsync({ ghostId: ghost.id, intoPersonId: chosen.id });
      haptic();
      toast({
        tone: "success",
        title: `${ghost.displayName} is ${chosen.id === dashboard?.me.id ? "you" : chosen.displayName}`,
        description: "Their expenses and payments moved across.",
      });
      setChosen(null);
      onClose();
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not merge them",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} title={ghost ? `Who is ${ghost.displayName}?` : "Who is this?"}>
        <div className="px-5 pb-6">
          <p className="mb-4 text-subhead leading-relaxed text-muted">
            Pick the account this placeholder belongs to. Everything filed against{" "}
            <span className="font-semibold text-text">{ghost?.displayName}</span> — every share,
            every payment — becomes theirs, and no balance changes.
          </p>

          {candidates.length === 0 ? (
            <EmptyState
              icon={<Merge className="size-6" />}
              title="Nobody to merge into"
              description="Only people already on Divvy can take over a placeholder. Share the group link with them first."
            />
          ) : (
            <ul className="space-y-1.5">
              {candidates.map((person) => (
                <li key={person.id}>
                  <button
                    onClick={() => {
                      haptic();
                      setChosen(person);
                    }}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2.5 text-left transition active:scale-[0.985] active:bg-surface-2"
                  >
                    <Avatar person={person} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                      {person.id === dashboard?.me.id ? "You" : person.displayName}
                    </span>
                    <Merge className="size-4 shrink-0 text-subtle" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Sheet>

      {/*
        Worth a second tap. The merge deletes a row and rewrites the ledger
        around it, and there is no undo — the placeholder it dissolved does not
        exist any more to be put back.
      */}
      <ConfirmSheet
        open={chosen !== null}
        onClose={() => setChosen(null)}
        title={`Merge ${ghost?.displayName ?? "this placeholder"}?`}
        description={
          chosen
            ? `Everything filed against ${ghost?.displayName ?? "the placeholder"} moves to ${
                chosen.id === dashboard?.me.id ? "you" : chosen.displayName
              }, and the placeholder disappears. This cannot be undone.`
            : ""
        }
        confirmLabel="Merge them"
        onConfirm={() => void confirm()}
        loading={merge.isPending}
      />
    </>
  );
}
