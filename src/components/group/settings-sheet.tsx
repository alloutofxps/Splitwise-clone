"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Archive, Download, LogOut, Repeat, Trash2, UserPlus, X } from "lucide-react";
import { Sheet, ConfirmSheet } from "../ui/sheet";
import { Avatar } from "../ui/avatar";
import { Switch, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { RecurringSheet } from "./recurring-sheet";
import { useAddMember, useRemoveMember, useUpdateGroup } from "@/lib/client/queries";
import { api, ApiError } from "@/lib/client/api";
import type { GroupDetailDto } from "@/lib/types";
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
}: {
  open: boolean;
  onClose: () => void;
  group: GroupDetailDto;
  meId: string;
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

  useResetOnOpen(open, () => {
    setName(group.name);
    setNewName("");
  });

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    updateGroup.mutate({ name: trimmed });
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
        title: "Could not add them",
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
        title: "Could not remove them",
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
        title: "Could not leave",
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
        title: "Could not delete the group",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <Sheet open={open} onClose={onClose} tall title="Group settings">
        <div className="px-5 pb-6">
          <label className="block">
            <span className="mb-1.5 block text-caption font-bold uppercase tracking-[0.06em] text-subtle">
              Name
            </span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 60))}
              onBlur={commitName}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              className="h-12 w-full rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input font-semibold text-text outline-none transition focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
            />
          </label>

          <div className="mt-4 flex items-start gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-semibold text-text">
                Simplify debts
              </span>
              <span className="mt-0.5 block text-caption leading-relaxed text-muted">
                Show the fewest payments that settle the group.
              </span>
            </span>
            <Switch
              checked={group.simplifyDebts}
              label="Simplify debts"
              onChange={(next) => updateGroup.mutate({ simplifyDebts: next })}
            />
          </div>

          {/* Members ------------------------------------------------------- */}
          <div className="mt-6">
            <p className="mb-2 text-caption font-bold uppercase tracking-[0.06em] text-subtle">
              Members
            </p>
            <ul className="space-y-1.5">
              {group.members.map((member) => {
                const net = BigInt(group.balances.net[member.id] ?? "0");
                return (
                  <li
                    key={member.id}
                    className="flex items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3 py-2.5"
                  >
                    <Avatar person={member} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-lg font-semibold text-text">
                        {member.id === meId ? "You" : member.displayName}
                      </span>
                      {member.isGhost ? (
                        <span className="block text-tiny text-subtle">
                          Has not joined yet
                        </span>
                      ) : null}
                    </span>

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
                        className="flex size-8 shrink-0 items-center justify-center rounded-full text-subtle transition active:scale-90 hover:bg-negative-soft hover:text-negative disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <X className="size-4" />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>

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
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
              />
              <button
                onClick={() => void add()}
                disabled={!newName.trim() || addMember.isPending}
                aria-label="Add member"
                className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-muted transition active:scale-90 disabled:opacity-40"
              >
                <UserPlus className="size-[18px]" />
              </button>
            </div>
          </div>

          {/* Tools --------------------------------------------------------- */}
          <div className="mt-6 space-y-1.5">
            <ActionRow
              icon={<Repeat className="size-[18px]" />}
              label="Repeating expenses"
              description="Rent, bills, subscriptions"
              onClick={() => setRecurring(true)}
            />
            <ActionRow
              icon={<Download className="size-[18px]" />}
              label="Export as CSV"
              description="Every expense and payment"
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
                  ? "Bring it back to your home screen"
                  : "Hide it without deleting anything"
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
              description="You have to be settled up first"
              tone="danger"
              onClick={() => setConfirmLeave(true)}
            />
            <ActionRow
              icon={<Trash2 className="size-[18px]" />}
              label="Delete group"
              description="Removes every expense in it, for everyone"
              tone="danger"
              onClick={() => setConfirmDelete(true)}
            />
          </div>
        </div>
      </Sheet>

      <RecurringSheet
        open={recurring}
        onClose={() => setRecurring(false)}
        group={group}
        meId={meId}
      />

      <ConfirmSheet
        open={confirmLeave}
        onClose={() => setConfirmLeave(false)}
        onConfirm={() => void leave()}
        title={`Leave ${group.name}?`}
        description="Your past expenses stay in the group so everyone else's history still adds up."
        confirmLabel="Leave"
      />

      <ConfirmSheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void destroy()}
        title={`Delete ${group.name}?`}
        description="This removes every expense in the group for everyone in it, permanently. Archiving keeps the history instead."
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
      className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-3 text-left transition active:scale-[0.985] hover:bg-surface-2"
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
