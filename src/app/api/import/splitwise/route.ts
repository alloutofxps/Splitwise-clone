import { z } from "zod";
import { currencyCode, json, readBody, route, text } from "@/lib/api";
import { requireSession, uniqueGroupCode, ValidationError } from "@/lib/identity";
import { prisma } from "@/lib/db";
import { colorForName } from "@/lib/avatar";
import { generateGhostCode } from "@/lib/codes";
import { convert } from "@/lib/money";
import { newId } from "@/lib/ids";
import { categoryFor, rebuildRow } from "@/lib/splitwise-import";
import { createExpense, recordActivity } from "@/server/write";
import { bumpLedgerQuery } from "@/server/ledger";
import { getRate } from "@/server/rates";
import { groupSummaries } from "@/server/read";
import { limitByAccount, WRITE } from "@/server/rate-limit";

/** A big group's whole history; anything larger is better split into several imports. */
const MAX_ROWS = 5000;
const MAX_PEOPLE = 50;

const minor = z.string().regex(/^-?\d{1,18}$/, "An amount in the file couldn't be read.");

const schema = z.object({
  name: text(60, "The group name").refine((v) => v.length > 0, "Give the group a name."),
  emoji: z.string().trim().max(8).default("🧾"),
  currency: currencyCode,
  /** The file's person columns, in order. Exactly one is the person importing. */
  people: z
    .array(z.object({ name: text(60, "A name").refine((v) => v.length > 0, "Every person needs a name."), isMe: z.boolean() }))
    .min(2, "A group needs at least two people.")
    .max(MAX_PEOPLE),
  rows: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date in the file couldn't be read."),
        description: text(140, "A description"),
        category: z.string().max(80),
        cost: minor,
        currency: currencyCode,
        nets: z.array(minor).max(MAX_PEOPLE),
      }),
    )
    .min(1, "There's nothing to import in that file.")
    .max(MAX_ROWS, `That's more than ${MAX_ROWS} rows. Split it into smaller exports.`),
});

/**
 * Brings a Splitwise group across.
 *
 * Creates the group with the importer in it and everyone else added by name,
 * so they can claim their name with the invite code later. Every row is
 * rebuilt here from the file's own numbers (see lib/splitwise-import.ts) and
 * saved through the same code as an expense typed in by hand, so the usual
 * checks apply and the balances come out as they were in Splitwise.
 */
export const POST = route(async (request: Request) => {
  const session = await requireSession();
  limitByAccount(session.person.id, "group-create", WRITE);
  const input = await readBody(request, schema, { maxBytes: 4 * 1024 * 1024 });

  const meIndex = input.people.findIndex((p) => p.isMe);
  if (meIndex === -1 || input.people.filter((p) => p.isMe).length > 1) {
    throw new ValidationError("Pick which name in the file is you.");
  }
  if (input.rows.some((row) => row.nets.length !== input.people.length)) {
    throw new ValidationError("Some rows in the file have the wrong number of columns.");
  }

  // Today's rate for each other currency in the file, looked up before
  // anything is written, so a missing rate stops the import cleanly.
  const rates = new Map<string, string>([[input.currency, "1"]]);
  for (const code of new Set(input.rows.map((r) => r.currency))) {
    if (rates.has(code)) continue;
    const found = await getRate(code, input.currency).catch(() => null);
    if (!found) {
      throw new ValidationError(
        `Some expenses are in ${code}, and we couldn't get an exchange rate to ${input.currency} right now. Please try again later.`,
      );
    }
    rates.set(code, found.rate);
  }

  const inviteCode = await uniqueGroupCode();
  const { group, personIds } = await prisma.$transaction(async (tx) => {
    const created = await tx.group.create({
      data: {
        name: input.name,
        kind: "other",
        emoji: input.emoji || "🧾",
        currency: input.currency,
        inviteCode,
        memberships: { create: { personId: session.person.id, role: "owner" } },
      },
    });
    const ids: string[] = [];
    for (const [index, person] of input.people.entries()) {
      if (index === meIndex) {
        ids.push(session.person.id);
        continue;
      }
      const ghost = await tx.person.create({
        data: {
          displayName: person.name,
          isGhost: true,
          createdByPersonId: session.person.id,
          defaultCurrency: input.currency,
          avatarColor: colorForName(person.name),
          inviteCode: generateGhostCode(),
        },
      });
      await tx.membership.create({ data: { groupId: created.id, personId: ghost.id, role: "member" } });
      ids.push(ghost.id);
    }
    return { group: created, personIds: ids };
  });

  let expenses = 0;
  let payments = 0;
  let skipped = 0;

  for (const row of input.rows) {
    const rebuilt = rebuildRow(row);
    // Midday, so the date reads the same in every time zone.
    const date = new Date(`${row.date}T12:00:00.000Z`);
    const rate = rates.get(row.currency) ?? "1";

    if (rebuilt.kind === "skip") {
      skipped++;
      continue;
    }

    if (rebuilt.kind === "payment") {
      await prisma.settlement.create({
        data: {
          id: newId("stl"),
          groupId: group.id,
          fromPersonId: personIds[rebuilt.from],
          toPersonId: personIds[rebuilt.to],
          amount: rebuilt.amount,
          currency: row.currency,
          exchangeRate: rate,
          convertedAmount: convert(rebuilt.amount, row.currency, input.currency, rate),
          date,
          note: "Imported from Splitwise",
          method: null,
          createdByPersonId: session.person.id,
        },
      });
      payments++;
      continue;
    }

    await createExpense({
      id: newId("exp"),
      groupId: group.id,
      description: row.description || "Imported expense",
      notes: "Imported from Splitwise",
      amount: rebuilt.amount,
      currency: row.currency,
      exchangeRate: rate,
      settlementCurrency: input.currency,
      splitMode: "EXACT",
      categoryId: categoryFor(row.category, row.description),
      date,
      createdByPersonId: session.person.id,
      payers: rebuilt.payers.map((p) => ({ personId: personIds[p.index], amount: p.amount })),
      splits: rebuilt.splits.map((s) => ({
        personId: personIds[s.index],
        amount: s.amount,
        included: s.amount !== 0n,
        weight: null,
        percent: null,
        adjustment: null,
      })),
      items: [],
      attachments: [],
    });
    expenses++;
  }

  await bumpLedgerQuery([group.id]);
  await recordActivity({
    type: "group.created",
    actorPersonId: session.person.id,
    groupId: group.id,
    data: { groupName: group.name, imported: expenses + payments },
  });

  const summaries = await groupSummaries(session.person.id);
  return json(
    { group: summaries.find((g) => g.id === group.id), imported: { expenses, payments, skipped } },
    { status: 201 },
  );
});
