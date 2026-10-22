"use client";

import * as React from "react";
import { Sheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { Button, Segmented, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import { useUpdateGroup } from "@/lib/client/queries";
import { ApiError } from "@/lib/client/api";
import { defaultSplitProblem, type DefaultSplit } from "@/lib/default-split";
import type { GroupDetailDto } from "@/lib/types";

type Mode = "EQUAL" | "PERCENT" | "SHARES";

/**
 * Sets how new expenses in a group split unless someone changes it: a couple
 * who always go 60/40, or flatmates with one bigger room.
 */
export function DefaultSplitSheet({
  group,
  meId,
  open,
  onClose,
}: {
  group: GroupDetailDto;
  meId: string;
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const updateGroup = useUpdateGroup(group.id);

  const startFrom = React.useCallback((): { mode: Mode; values: Record<string, string> } => {
    const split = group.defaultSplit;
    const values: Record<string, string> = {};
    if (!split) {
      // A reasonable starting point if they switch mode: an even split.
      const even = group.members.length > 0 ? Math.floor(10000 / group.members.length) / 100 : 0;
      group.members.forEach((m, i) => {
        values[m.id] = String(i === 0 ? Math.round((100 - even * (group.members.length - 1)) * 100) / 100 : even);
      });
      return { mode: "EQUAL", values };
    }
    for (const m of group.members) {
      const entry = split.entries.find((e) => e.personId === m.id);
      values[m.id] = entry ? String(entry.value) : "0";
    }
    return { mode: split.mode, values };
  }, [group.defaultSplit, group.members]);

  const [mode, setMode] = React.useState<Mode>(() => startFrom().mode);
  const [values, setValues] = React.useState<Record<string, string>>(() => startFrom().values);
  useResetOnOpen(open, () => {
    const start = startFrom();
    setMode(start.mode);
    setValues(start.values);
  });

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    // Sensible numbers for the new mode rather than percentages read as shares.
    const fresh: Record<string, string> = {};
    if (next === "SHARES") group.members.forEach((m) => (fresh[m.id] = "1"));
    if (next === "PERCENT") {
      const n = group.members.length;
      const even = Math.floor(10000 / n) / 100;
      group.members.forEach((m, i) => (fresh[m.id] = String(i === 0 ? Math.round((100 - even * (n - 1)) * 100) / 100 : even)));
    }
    setMode(next);
    if (next !== "EQUAL") setValues(fresh);
  };

  const number = (id: string) => {
    const parsed = Number.parseFloat((values[id] ?? "").replace(",", "."));
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  };
  const draft: DefaultSplit | null =
    mode === "EQUAL"
      ? null
      : { mode, entries: group.members.map((m) => ({ personId: m.id, value: number(m.id) })) };
  const total = draft ? draft.entries.reduce((sum, e) => sum + e.value, 0) : 0;
  const problem = draft ? defaultSplitProblem(draft, group.members.map((m) => m.id)) : null;

  const save = () => {
    updateGroup.mutate(
      { defaultSplit: draft },
      {
        onSuccess: () => {
          haptic(10);
          toast({
            tone: "success",
            title: draft ? "Usual split saved" : "Back to splitting equally",
            description: draft ? "New expenses in this group will start with it." : undefined,
          });
          onClose();
        },
        onError: (error) =>
          toast({
            tone: "error",
            title: "Couldn't save that",
            description: error instanceof ApiError ? error.message : undefined,
          }),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="Usual split"
      footer={
        <Button
          variant="primary"
          size="lg"
          fullWidth
          loading={updateGroup.isPending}
          disabled={Boolean(problem)}
          onClick={save}
        >
          {problem ? problem : "Save"}
        </Button>
      }
    >
      <div className="px-5 pb-6">
        <p className="text-body-lg leading-relaxed text-muted">
          New expenses in this group start with this split. You can still change it on any
          expense.
        </p>

        <Segmented<Mode>
          kind="choice"
          label="Default split"
          className="mt-4"
          value={mode}
          onChange={switchMode}
          options={[
            { value: "EQUAL", label: "Equally" },
            { value: "PERCENT", label: "By percent" },
            { value: "SHARES", label: "By shares" },
          ]}
        />

        {mode === "EQUAL" ? (
          <p className="mt-5 rounded-[var(--radius-md)] bg-surface-2 px-4 py-3.5 text-body leading-relaxed text-muted">
            Everyone pays the same. This is how a group splits when it has no usual split.
          </p>
        ) : (
          <>
            <ul className="mt-5 space-y-2">
              {group.members.map((member) => (
                <li
                  key={member.id}
                  className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3.5 py-2.5"
                >
                  <Avatar person={member} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                    {member.id === meId ? "You" : member.displayName}
                  </span>
                  <label className="flex items-center gap-1.5">
                    <input
                      inputMode="decimal"
                      value={values[member.id] ?? ""}
                      onChange={(event) =>
                        setValues((current) => ({
                          ...current,
                          [member.id]: event.target.value.replace(/[^\d.,]/g, "").slice(0, 8),
                        }))
                      }
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label={`${mode === "PERCENT" ? "Percent" : "Shares"} for ${member.id === meId ? "you" : member.displayName}`}
                      className="h-10 w-20 rounded-[var(--radius-sm)] border border-line bg-surface-2 px-2.5 text-right text-input font-semibold text-text outline-none focus:border-brand"
                    />
                    <span className="w-12 text-body font-semibold text-muted">
                      {mode === "PERCENT" ? "%" : number(member.id) === 1 ? "share" : "shares"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p
              className={cn(
                "mt-3 text-center text-body font-semibold",
                problem ? "text-negative-text" : "text-positive-text",
              )}
            >
              {mode === "PERCENT"
                ? `Adds up to ${Math.round(total * 100) / 100}%`
                : total > 0
                  ? `${total} ${total === 1 ? "share" : "shares"} in total`
                  : "Nobody has a share yet"}
            </p>
            {mode === "SHARES" ? (
              <p className="mt-1 text-center text-caption text-subtle">
                Someone with 2 shares pays twice as much as someone with 1.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}
