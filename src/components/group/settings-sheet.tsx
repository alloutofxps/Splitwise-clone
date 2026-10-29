"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, ChevronRight, Download, LogOut, Merge, PieChart, Repeat, Trash2, UserPlus, X } from "lucide-react";
import { Sheet, ConfirmSheet, WhileOpen } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { RecurringSheet } from "./recurring-sheet";
import { MergePersonSheet } from "./merge-person-sheet";
import { DefaultSplitSheet } from "./default-split-sheet";
import { describeDefaultSplit } from "@/lib/default-split";
import { useAddMember, useDashboard, useRemoveMember, useUpdateGroup } from "@/lib/client/queries";
import { api, ApiError } from "@/lib/client/api";
import type { GroupDetailDto, PersonDto } from "@/lib/types";
import { useResetOnOpen } from "../ui/use-reset-on-open";

/**
 * Group settings.
 *
 * The destructive actions are deliberately staged. Leaving or deleting is
 * refused by the server while balances are outstanding, and the message says
 * why rather than just disabling a button - "you can't do this" is only useful
 * when it comes with "because Priya still owes you 40".
 */
export function GroupSettingsSheet({
  open,
  onClose,
  group,
  meId,
  onOpenBalances,
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetailDto;
  meId: string;
  /** Simplify lives on the Balances tab, where you can see what it changes. */
  onOpenBalances: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();

  const updateGroup = useUpdateGroup(group.id);
  const addMember = useAddMember(group.id);
  const removeMember = useRemoveMember(group.id);

  const [name, setName] = React.useState(group.name);
  const [newName, setNewName] = React.useState("");
  const [confirmLeave, setConfirmLeave] = React.useState(false);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  const [recurring, setRecurring] = React.useState(false);
  const [usualSplit, setUsualSplit] = React.useState(false);
  const [merging, setMerging] = React.useState<PersonDto | null>(null);

  useResetOnOpen(open, () => {
    setName(group.name);
    setNewName("");
  });

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    updateGroup.mutate({ name: trimmed });
  };

  /*
   * People you already split with who are not in this group yet. Placeholders
   * are excluded: a placeholder belongs to the group that made it, and pulling
   * one into a second group would entangle two sets of balances.
   */
  const { data: dashboard } = useDashboard();
  const inGroup = new Set(group.members.map((member) => member.id));
  const addable = (dashboard?.people ?? []).filter(
    (person) => !inGroup.has(person.id) && !person.isGhost && person.id !== dashboard?.me.id,
  );

  /*
   * Who a placeholder could turn out to be: any real account the viewer can
   * see, themselves included, whether or not they are already in this group.
   * Already being in the group is in fact the common case — somebody was added
   * by name last month and has since joined properly — and excluding them
   * would hide the merge exactly when it is needed.
   */
  const mergeCandidates = [
    ...(dashboard ? [dashboard.me] : []),
    ...(dashboard?.people ?? []).filter((person) => !person.isGhost),
  ].filter((person) => person.id !== merging?.id);

  const addExisting = async (person: { id: string; displayName: string }) => {
    try {
      await addMember.mutateAsync({ personId: person.id });
      haptic();
      toast({ tone: "success", title: `${person.displayName} added` });
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't add them",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  const add = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await addMember.mutateAsync({ name: trimmed });
      setNewName("");
      haptic();
      toast({ tone: "success", title: `${trimmed} added` });
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't add them",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  const remove = async (personId: string, displayName: string) => {
    try {
      await removeMember.mutateAsync(personId);
      toast({ tone: "success", title: `${displayName} removed` });
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't remove them",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  const leave = async () => {
    try {
      await api.del(`/api/groups/${group.id}/members/${meId}`);
      await client.invalidateQueries();
      setConfirmLeave(false);
      onClose();
      toast({ tone: "success", title: `You left ${group.name}` });
      router.push("/");
    } catch (error) {
      setConfirmLeave(false);
      toast({
        tone: "error",
        title: "Couldn't leave",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  const destroy = async () => {
    try {
      await api.del(`/api/groups/${group.id}`);
      await client.invalidateQueries();
      setConfirmDelete(false);
      onClose();
      toast({ tone: "success", title: "Group deleted" });
      router.push("/");
    } catch (error) {
      setConfirmDelete(false);
      toast({
        tone: "error",
        title: "Couldn't delete the group",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} tall title="Group settings">
        <div className="px-5 pb-6">
          <label className="block">
            <span className="mb-1.5 block text-caption font-medium text-subtle">
              Name
            </span>
            <input
              dir="auto"
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 60))}
              onBlur={commitName}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className="h-12 w-full rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-3.5 text-input font-semibold text-text outline-none transition focus:ring-[1.5px] focus:ring-text"
            />
          </label>

          {/* One Simplify switch, on Balances, where you can see what it does. */}
          <button
            onClick={() => {
              haptic();
              onOpenBalances();
            }}
            className="mt-4 flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3.5 py-3 text-left transition active:opacity-70"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-semibold text-text">
                Simplify debts
              </span>
              <span className="mt-0.5 block text-caption leading-relaxed text-muted">
                {group.simplifyDebts ? "On" : "Off"}.{" "}
                {/* The switch only shows on Balances while someone owes something. */}
                {group.balances.pairwise.length > 0 || group.balances.simplified.length > 0
                  ? "Change it on the Balances tab."
                  : "You can change it on the Balances tab once someone owes something."}
              </span>
            </span>
            <ChevronRight className="size-[18px] shrink-0 text-subtle" />
          </button>

          {/* Members ------------------------------------------------------- */}
          <div className="mt-6">
            <p className="mb-2 text-caption font-medium text-subtle">
              Members
            </p>
            <ul className="space-y-1.5">
              {group.members.map((member) => {
                const net = BigInt(group.balances.net[member.id] ?? "0");
                return (
                  <li
                    key={member.id}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3 py-2.5"
                  >
                    <Avatar person={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-lg font-semibold text-text">
                        {member.id === meId ? "You" : member.displayName}
                      </span>
                      {member.isGhost ? (
                        <span className="block text-tiny text-subtle">
                          Not on Divvy yet
                        </span>
                      ) : null}
                    </span>

                    {/*
                      A placeholder can turn out to be somebody who is already
                      here under another spelling. Offered on the row itself
                      because that is where you notice it — reading the member
                      list and seeing the same person twice.
                    */}
                    {member.isGhost ? (
                      <button
                        onClick={() => {
                          haptic();
                          setMerging(member);
                        }}
                        aria-label={`${member.displayName} is someone already on Divvy`}
                        title="This is someone already on Divvy"
                        className="tap-44 relative flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:opacity-70 hover:bg-surface-2 hover:text-text"
                      >
                        <Merge className="size-4" />
                      </button>
                    ) : null}

                    {member.id !== meId ? (
                      <button
                        onClick={() => {
                          haptic();
                          // Handled inside `remove`, which toasts either way.
                          void remove(member.id, member.displayName);
                        }}
                        aria-label={`Remove ${member.displayName}`}
                        disabled={net !== 0n}
                        title={
                          net !== 0n
                            ? "They still have a balance in this group"
                            : undefined
                        }
                        className="tap-44 relative flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:opacity-70 hover:bg-negative-soft hover:text-negative disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

            {/*
              People you already split with, offered before the name box.
              Typing a name makes a *placeholder* — so reaching for it to add
              somebody you already had produced a second, unclaimed copy of
              them, with balances that could never meet.
            */}
            {addable.length > 0 ? (
              <ul className="mt-2.5 space-y-1.5">
                {addable.map((person) => (
                  <li key={person.id}>
                    <button
                      onClick={() => void addExisting(person)}
                      disabled={addMember.isPending}
                      className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3 py-2 text-left transition active:opacity-70 disabled:opacity-50"
                    >
                      <Avatar person={person} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-body-lg font-semibold text-text">
                        {person.displayName}
                      </span>
                      <UserPlus className="size-4 shrink-0 text-subtle" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-2.5 flex gap-2">
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value.slice(0, 60))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void add();
                  }
                }}
                placeholder="Add someone by name"
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-transparent bg-surface-2 px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:ring-[1.5px] focus:ring-text"
              />
              <button
                onClick={() => void add()}
                disabled={!newName.trim() || addMember.isPending}
                aria-label="Add member"
                className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-muted transition active:opacity-70 disabled:opacity-40"
              >
                <UserPlus className="size-[18px]" />
              </button>
            </div>
          </div>

          {/* Tools --------------------------------------------------------- */}
          <div className="mt-6 space-y-1.5">
            <ActionRow
              icon={<PieChart className="size-[18px]" />}
              label="Usual split"
              description={describeDefaultSplit(group.defaultSplit, (id) =>
                id === meId ? "You" : (group.members.find((m) => m.id === id)?.displayName ?? "Someone"),
              )}
              onClick={() => setUsualSplit(true)}
            />
            <ActionRow
              icon={<Repeat className="size-[18px]" />}
              label="Repeating expenses"
              description="Rent, bills, subscriptions"
              onClick={() => setRecurring(true)}
            />
            <ActionRow
              icon={<Download className="size-[18px]" />}
              label="Export as CSV"
              description="A spreadsheet of every expense and payment"
              onClick={() => {
                haptic();
                // Absolute, and a full navigation rather than a router push:
                // this is a file download, not a page.
                window.location.assign(
                  new URL(`/api/groups/${group.id}/export`, window.location.origin),
                );
              }}
            />
            <ActionRow
              icon={<Archive className="size-[18px]" />}
              label={group.archivedAt ? "Unarchive group" : "Archive group"}
              description={
                group.archivedAt
                  ? "Show it on your home screen again"
                  : "Hide it. Nothing gets deleted."
              }
              onClick={() => {
                updateGroup.mutate({ archived: !group.archivedAt });
                toast({
                  tone: "success",
                  title: group.archivedAt ? "Group unarchived" : "Group archived",
                });
              }}
            />
          </div>

          {/* Danger -------------------------------------------------------- */}
          <div className="mt-6 space-y-1.5">
            <ActionRow
              icon={<LogOut className="size-[18px]" />}
              label="Leave group"
              description="You need to be settled up first"
              tone="danger"
              onClick={() => setConfirmLeave(true)}
            />
            <ActionRow
              icon={<Trash2 className="size-[18px]" />}
              label="Delete group"
              description="Deletes all its expenses, for everyone"
              tone="danger"
              onClick={() => setConfirmDelete(true)}
            />
          </div>
        </div>
      </Sheet>

      <WhileOpen open={recurring}>
        <RecurringSheet
          open={recurring}
          onClose={() => setRecurring(false)}
          group={group}
          meId={meId}
        />
      </WhileOpen>
      <WhileOpen open={usualSplit}>
        <DefaultSplitSheet
          open={usualSplit}
          onClose={() => setUsualSplit(false)}
          group={group}
          meId={meId}
        />
      </WhileOpen>

      <WhileOpen open={merging !== null}>
        <MergePersonSheet
          open={merging !== null}
          onClose={() => setMerging(null)}
          ghost={merging}
          candidates={mergeCandidates}
        />
      </WhileOpen>

      <ConfirmSheet
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void leave()}
        title={`Leave ${group.name}?`}
        description="Your past expenses stay in the group, so everyone else's totals still add up."
        confirmLabel="Leave"
      />

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void destroy()}
        title={`Delete ${group.name}?`}
        description="This deletes every expense in the group, for everyone, forever. If you just want it out of the way, archive it instead."
        confirmLabel="Delete for everyone"
      />
    </>
  );
}

function ActionRow({
  icon,
  label,
  description,
  onClick,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
  tone?: "default" | "danger";
}) {
  return (
    <button
      onClick={() => {
        haptic();
        onClick();
      }}
      className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[var(--card-border)] bg-surface px-3.5 py-3 text-left transition active:opacity-70 hover:bg-surface-2"
    >
      <span className={cn("shrink-0", tone === "danger" ? "text-negative" : "text-muted")}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-body-lg font-semibold",
            tone === "danger" ? "text-negative-text" : "text-text",
          )}
        >
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 block text-caption leading-snug text-muted">
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
