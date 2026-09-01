"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import { Button, Switch, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { CurrencyPicker } from "../expense/currency-picker";
import { useCreateGroup, useDashboard } from "@/lib/client/queries";
import { ApiError } from "@/lib/client/api";

/**
 * Creating a group.
 *
 * The names field is the important one and is easy to miss the point of: you
 * can list everyone who is coming *before any of them install anything*. Each
 * name becomes a placeholder that starts collecting its share immediately, and
 * gets absorbed into a real account when that person joins with the invite
 * code. Without it, the first evening of a trip cannot be recorded until the
 * whole group has been onboarded, which is the moment most expense apps lose
 * people.
 */

const KINDS = [
  { value: "trip", label: "Trip", emoji: "🏝️" },
  { value: "home", label: "Home", emoji: "🏡" },
  { value: "couple", label: "Couple", emoji: "💞" },
  { value: "event", label: "Event", emoji: "🎉" },
  { value: "project", label: "Project", emoji: "🛠️" },
  { value: "other", label: "Other", emoji: "🧾" },
] as const;

export function NewGroupSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const { data } = useDashboard();
  const createGroup = useCreateGroup();

  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<string>("trip");
  const [emoji, setEmoji] = React.useState("🏝️");
  const [currency, setCurrency] = React.useState(data?.me.defaultCurrency ?? "USD");
  const [simplify, setSimplify] = React.useState(true);
  const [names, setNames] = React.useState<string[]>([]);
  const [draftName, setDraftName] = React.useState("");
  const [currencyOpen, setCurrencyOpen] = React.useState(false);

  useResetOnOpen(open, () => {
    setName("");
    setKind("trip");
    setEmoji("🏝️");
    setCurrency(data?.me.defaultCurrency ?? "USD");
    setSimplify(true);
    setNames([]);
    setDraftName("");
  });

  const addName = () => {
    const trimmed = draftName.trim();
    if (!trimmed) return;
    if (names.some((entry) => entry.toLowerCase() === trimmed.toLowerCase())) {
      toast({ tone: "error", title: "That name is already on the list" });
      return;
    }
    haptic();
    setNames((current) => [...current, trimmed]);
    setDraftName("");
  };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      const result = await createGroup.mutateAsync({
        name: name.trim(),
        kind,
        emoji,
        color: "iris",
        currency,
        simplifyDebts: simplify,
        // Fold in a name still sitting in the input, so the user does not lose
        // it by tapping Create instead of the plus.
        placeholderNames: draftName.trim() ? [...names, draftName.trim()] : names,
      });
      haptic([8, 30, 8]);
      toast({ tone: "success", title: `${name.trim()} created` });
      onClose();
      router.push(`/groups/${result.group.id}`);
    } catch (error) {
      toast({
        tone: "error",
        title: "Could not create the group",
        description: error instanceof ApiError ? error.message : undefined,
      });
    }
  };

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        tall
        title="New group"
        footer={
          <Button
            variant="primary"
            size="lg"
            fullWidth
            disabled={!name.trim()}
            loading={createGroup.isPending}
            onClick={() => void submit()}
          >
            Create group
          </Button>
        }
      >
        <div className="px-5 pb-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                // Cycle the emoji through the kind presets - a full emoji
                // keyboard here is more choice than the moment deserves.
                const index = KINDS.findIndex((entry) => entry.emoji === emoji);
                const next = KINDS[(index + 1) % KINDS.length];
                haptic();
                setEmoji(next.emoji);
              }}
              aria-label="Change group icon"
              className="flex size-14 shrink-0 items-center justify-center rounded-[var(--radius-lg)] bg-surface-2 text-display-sm transition active:scale-90"
            >
              {emoji}
            </button>
            <input
              value={name}
              onChange={(event) => setName(event.target.value.slice(0, 60))}
              placeholder="Lisbon 2026"
              autoFocus
              enterKeyHint="done"
              className="h-12 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-surface px-4 text-input font-semibold text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {KINDS.map((entry) => (
              <button
                key={entry.value}
                onClick={() => {
                  haptic();
                  setKind(entry.value);
                  setEmoji(entry.emoji);
                }}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body font-semibold transition active:scale-95",
                  kind === entry.value
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-surface text-muted",
                )}
              >
                <span>{entry.emoji}</span>
                {entry.label}
              </button>
            ))}
          </div>

          <button
            onClick={() => setCurrencyOpen(true)}
            className="mt-5 flex w-full items-center justify-between rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-3 text-left transition active:scale-[0.985]"
          >
            <span className="text-body-lg font-semibold text-muted">Settles in</span>
            <span className="text-body-lg font-bold text-text">{currency}</span>
          </button>
          <p className="mt-1.5 px-1 text-caption leading-relaxed text-subtle">
            Expenses can be in any currency; balances are totted up in this one.
          </p>

          <div className="mt-4 flex items-start gap-3 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-body-lg font-semibold text-text">
                Simplify debts
              </span>
              <span className="mt-0.5 block text-caption leading-relaxed text-muted">
                Collapse the balances into the fewest possible payments, rather
                than everyone settling with everyone.
              </span>
            </span>
            <Switch checked={simplify} onChange={setSimplify} label="Simplify debts" />
          </div>

          {/* Placeholder members --------------------------------------------- */}
          <div className="mt-6">
            <p className="text-body font-semibold text-text">Who else is in?</p>
            <p className="mt-1 text-caption leading-relaxed text-muted">
              Add names now and start splitting straight away — they can claim
              their name later with the invite code.
            </p>

            <div className="mt-3 flex gap-2">
              <input
                value={draftName}
                onChange={(event) => setDraftName(event.target.value.slice(0, 60))}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addName();
                  }
                }}
                placeholder="Add a name"
                enterKeyHint="done"
                className="h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border border-line bg-surface px-3.5 text-input text-text outline-none transition placeholder:text-subtle/70 focus:border-brand focus:ring-4 focus:ring-[var(--brand-ring)]"
              />
              <button
                onClick={addName}
                disabled={!draftName.trim()}
                aria-label="Add name"
                className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-muted transition active:scale-90 disabled:opacity-40"
              >
                <Plus className="size-5" />
              </button>
            </div>

            {names.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {names.map((entry) => (
                  <li key={entry}>
                    <button
                      onClick={() => {
                        haptic();
                        setNames((current) => current.filter((item) => item !== entry));
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-surface-2 py-1.5 pl-3 pr-2 text-body font-semibold text-text transition active:scale-95"
                    >
                      {entry}
                      <X className="size-3.5 text-subtle" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      </Sheet>

      <CurrencyPicker
        open={currencyOpen}
        onClose={() => setCurrencyOpen(false)}
        value={currency}
        onChange={(next) => {
          setCurrency(next);
          setCurrencyOpen(false);
        }}
      />
    </>
  );
}
