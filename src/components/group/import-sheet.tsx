"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, TriangleAlert } from "lucide-react";
import { Sheet } from "../ui/sheet";
import { Button, cn, haptic } from "../ui/primitives";
import { useToast } from "../ui/toast";
import { useResetOnOpen } from "../ui/use-reset-on-open";
import { api, ApiError } from "@/lib/client/api";
import { keys, useDashboard } from "@/lib/client/queries";
import {
  groupNameFromFile,
  mainCurrency,
  parseSplitwiseExport,
  rebuildRow,
  type SplitwiseExport,
} from "@/lib/splitwise-import";

/**
 * Moves a group over from Splitwise, from the spreadsheet Splitwise exports.
 *
 * Everything is read on the phone first, so the preview - how many expenses,
 * who is in it, which one is you - appears before anything is sent.
 */
export function ImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const client = useQueryClient();
  const { data } = useDashboard();
  const fileInput = React.useRef<HTMLInputElement>(null);

  const [parsed, setParsed] = React.useState<SplitwiseExport | null>(null);
  const [name, setName] = React.useState("");
  const [meIndex, setMeIndex] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  useResetOnOpen(open, () => {
    setParsed(null);
    setName("");
    setMeIndex(null);
    setError(null);
    setBusy(false);
  });

  const readFile = async (file: File) => {
    setError(null);
    if (file.size > 3 * 1024 * 1024) {
      setError("That file is too big. Export one group at a time.");
      return;
    }
    try {
      const result = parseSplitwiseExport(await file.text());
      if (result.rows.length === 0) throw new Error("There's nothing to import in that file.");
      setParsed(result);
      setName(groupNameFromFile(file.name));
      // Guess which column is the person importing, by name.
      const mine = (data?.me.displayName ?? "").trim().toLowerCase();
      const first = mine.split(/\s+/)[0];
      const guess = result.people.findIndex((p) => {
        const theirs = p.trim().toLowerCase();
        return theirs === mine || (first.length > 1 && theirs.split(/\s+/)[0] === first);
      });
      setMeIndex(guess >= 0 ? guess : null);
    } catch (e) {
      setParsed(null);
      setError(e instanceof Error ? e.message : "That file couldn't be read.");
    }
  };

  const summary = React.useMemo(() => {
    if (!parsed) return null;
    let expenses = 0;
    let payments = 0;
    for (const row of parsed.rows) {
      const kind = rebuildRow(row).kind;
      if (kind === "expense") expenses++;
      if (kind === "payment") payments++;
    }
    const dates = parsed.rows.map((r) => r.date).sort();
    const currency = mainCurrency(parsed.rows) ?? "USD";
    const others = [...new Set(parsed.rows.map((r) => r.currency))].filter((c) => c !== currency);
    return { expenses, payments, from: dates[0], to: dates[dates.length - 1], currency, others };
  }, [parsed]);

  const submit = async () => {
    if (!parsed || !summary || meIndex === null || !name.trim()) return;
    setBusy(true);
    try {
      const result = await api.post<{ group: { id: string }; imported: { expenses: number; payments: number } }>(
        "/api/import/splitwise",
        {
          name: name.trim(),
          currency: summary.currency,
          people: parsed.people.map((person, index) => ({ name: person.slice(0, 60), isMe: index === meIndex })),
          rows: parsed.rows,
        },
      );
      haptic([8, 30, 8]);
      void client.invalidateQueries({ queryKey: keys.dashboard });
      toast({
        tone: "success",
        title: "Imported from Splitwise",
        description: `${result.imported.expenses} expenses and ${result.imported.payments} payments are in ${name.trim()}.`,
      });
      onClose();
      router.push(`/groups/${result.group.id}`);
    } catch (e) {
      toast({
        tone: "error",
        title: "Couldn't import that",
        description: e instanceof ApiError ? e.message : "Please try again.",
      });
      setBusy(false);
    }
  };

  const formatDay = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      tall
      title="Import from Splitwise"
      footer={
        parsed ? (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={busy}
            disabled={meIndex === null || !name.trim()}
            onClick={() => void submit()}
          >
            {meIndex === null ? "Pick which name is you" : `Import ${summary ? summary.expenses + summary.payments : 0} items`}
          </Button>
        ) : undefined
      }
    >
      <div className="px-5 pb-6">
        <input
          ref={fileInput}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void readFile(file);
          }}
        />

        {!parsed ? (
          <>
            <p className="text-body-lg leading-relaxed text-muted">
              Bring a group over with all its expenses and payments. Everyone&rsquo;s balance will
              be the same as in Splitwise.
            </p>
            <ol className="mt-5 space-y-3">
              {[
                "In Splitwise, open the group.",
                "Tap the settings gear, then Export as spreadsheet.",
                "Save the file, then choose it here.",
              ].map((step, i) => (
                <li key={step} className="flex items-start gap-3">
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-caption font-semibold text-brand-soft-text">
                    {i + 1}
                  </span>
                  <span className="pt-0.5 text-body-lg text-text">{step}</span>
                </li>
              ))}
            </ol>
            <Button
              variant="primary"
              size="lg"
              fullWidth
              className="mt-6"
              icon={<FileUp className="size-[18px]" />}
              onClick={() => {
                haptic();
                fileInput.current?.click();
              }}
            >
              Choose the file
            </Button>
            {error ? (
              <p className="mt-4 flex gap-2 rounded-[var(--radius-md)] bg-danger-soft p-3.5 text-body leading-relaxed text-danger">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}
          </>
        ) : summary ? (
          <>
            <label className="block">
              <span className="mb-1.5 block text-body font-semibold text-muted">Group name</span>
              <input
                dir="auto"
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 60))}
                className="h-12 w-full rounded-[var(--radius-md)] border border-field-edge bg-surface-2 px-3.5 text-input font-semibold text-text outline-none focus:ring-[1.5px] focus:ring-text"
              />
            </label>

            <div className="mt-4 rounded-[var(--radius-lg)] bg-surface-2 px-4 py-3.5 text-body leading-relaxed text-text">
              <p>
                <b>{summary.expenses}</b> {summary.expenses === 1 ? "expense" : "expenses"} and{" "}
                <b>{summary.payments}</b> {summary.payments === 1 ? "payment" : "payments"}, from{" "}
                {formatDay(summary.from)} to {formatDay(summary.to)}.
              </p>
              <p className="mt-1 text-muted">The group will use {summary.currency}.</p>
              {summary.others.length > 0 ? (
                <p className="mt-1 text-muted">
                  Some expenses are in {summary.others.join(", ")}. They&rsquo;ll be converted at
                  today&rsquo;s rate.
                </p>
              ) : null}
              {parsed.problems.length > 0 ? (
                <p className="mt-1 text-warning-soft-text">
                  {parsed.problems.length} {parsed.problems.length === 1 ? "row" : "rows"} couldn&rsquo;t be read and will be left out.
                </p>
              ) : null}
            </div>

            <p className="mb-2 mt-6 text-body font-semibold text-text">Which name is you?</p>
            <ul className="space-y-1.5" role="radiogroup" aria-label="Which name is you?">
              {parsed.people.map((person, index) => (
                <li key={`${person}-${index}`}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={meIndex === index}
                    onClick={() => {
                      haptic();
                      setMeIndex(index);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between rounded-[var(--radius-md)] border px-3.5 py-3 text-left text-body-lg font-semibold transition active:opacity-70",
                      meIndex === index
                        ? "border-brand bg-brand-soft text-brand-soft-text"
                        : "border-[var(--card-border)] bg-surface text-text",
                    )}
                  >
                    {person}
                    {meIndex === index ? <span className="text-caption font-semibold">You</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-caption leading-relaxed text-subtle">
              Everyone else is added by name. They can join with the group&rsquo;s invite code and
              pick their name, and everything under it becomes theirs.
            </p>
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
