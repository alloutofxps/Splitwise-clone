/**
 * Demo data.
 *
 * Builds a group that looks like a real trip — mixed currencies, several split
 * modes, a placeholder member nobody has claimed, some settled debt and some
 * outstanding — so every screen has something honest to render on a fresh
 * install.
 *
 *   npm run db:seed
 *
 * The recovery key for the demo identity is printed at the end; paste it into
 * "I already have a recovery key" to sign in as her.
 */

import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

function secret(): string {
  return `dvy_${randomBytes(32).toString("base64url")}`;
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  console.log("Seeding demo data…\n");

  const priyaSecret = secret();

  const priya = await prisma.person.create({
    data: {
      displayName: "Priya Raman",
      avatarColor: "iris",
      defaultCurrency: "EUR",
      credentials: {
        create: { kind: "recovery", secretHash: hash(priyaSecret), label: "Recovery key" },
      },
      inviteCode: "me-sunny-otter",
    },
  });

  const ravi = await prisma.person.create({
    data: {
      displayName: "Ravi Menon",
      avatarColor: "amber",
      defaultCurrency: "EUR",
      credentials: {
        create: { kind: "recovery", secretHash: hash(secret()), label: "Recovery key" },
      },
      inviteCode: "me-swift-heron",
    },
  });

  const nadia = await prisma.person.create({
    data: {
      displayName: "Nadia Okonkwo",
      avatarColor: "teal",
      defaultCurrency: "EUR",
      credentials: {
        create: { kind: "recovery", secretHash: hash(secret()), label: "Recovery key" },
      },
      inviteCode: "me-lunar-reef",
    },
  });

  // Sam was added by name and has never opened the app. His share is already
  // being tracked — this is the case the whole placeholder mechanism exists for.
  const sam = await prisma.person.create({
    data: {
      displayName: "Sam",
      avatarColor: "rose",
      defaultCurrency: "EUR",
      isGhost: true,
      createdByPersonId: priya.id,
      inviteCode: "ghost-seed-sam",
    },
  });

  for (const [a, b] of [
    [priya, ravi],
    [priya, nadia],
    [ravi, nadia],
  ] as const) {
    const [personAId, personBId] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await prisma.friendship.create({ data: { personAId, personBId } });
  }

  await prisma.paymentMethod.createMany({
    data: [
      { personId: priya.id, kind: "upi", value: "priya@okhdfcbank", sortOrder: 0 },
      { personId: priya.id, kind: "revolut", value: "revolut.me/priyar", sortOrder: 1 },
      { personId: ravi.id, kind: "paypal", value: "paypal.me/ravimenon", sortOrder: 0 },
    ],
  });

  const trip = await prisma.group.create({
    data: {
      name: "Lisbon 2026",
      kind: "trip",
      emoji: "🏝️",
      color: "sky",
      currency: "EUR",
      simplifyDebts: true,
      inviteCode: "mango-tiger-42",
      memberships: {
        create: [
          { personId: priya.id, role: "owner" },
          { personId: ravi.id },
          { personId: nadia.id },
          { personId: sam.id },
        ],
      },
    },
  });

  const flat = await prisma.group.create({
    data: {
      name: "Flat 3B",
      kind: "home",
      emoji: "🏡",
      color: "lime",
      currency: "EUR",
      simplifyDebts: false,
      inviteCode: "quiet-willow-71",
      memberships: {
        create: [{ personId: priya.id, role: "owner" }, { personId: nadia.id }],
      },
    },
  });

  const everyone = [priya.id, ravi.id, nadia.id, sam.id];

  /** Helper that writes an expense plus its activity entry. */
  async function expense(input: {
    groupId: string | null;
    description: string;
    amount: bigint;
    currency?: string;
    exchangeRate?: string;
    convertedAmount?: bigint;
    categoryId: string;
    splitMode?: string;
    date: Date;
    paidBy: string;
    splits: { personId: string; amount: bigint; weight?: number; percent?: number }[];
    notes?: string;
    items?: { name: string; amount: bigint; participantIds: string[] }[];
  }) {
    const currency = input.currency ?? "EUR";
    const created = await prisma.expense.create({
      data: {
        groupId: input.groupId,
        description: input.description,
        notes: input.notes ?? null,
        amount: input.amount,
        currency,
        exchangeRate: input.exchangeRate ?? "1",
        convertedAmount: input.convertedAmount ?? input.amount,
        splitMode: input.splitMode ?? "EQUAL",
        categoryId: input.categoryId,
        date: input.date,
        createdByPersonId: input.paidBy,
        payers: { create: [{ personId: input.paidBy, amount: input.amount }] },
        splits: {
          create: input.splits.map((split) => ({
            personId: split.personId,
            amount: split.amount,
            included: true,
            weight: split.weight ?? null,
            percent: split.percent ?? null,
          })),
        },
      },
    });

    for (const [index, item] of (input.items ?? []).entries()) {
      await prisma.expenseItem.create({
        data: {
          expenseId: created.id,
          name: item.name,
          amount: item.amount,
          sortOrder: index,
          shares: { create: item.participantIds.map((personId) => ({ personId })) },
        },
      });
    }

    await prisma.activity.create({
      data: {
        type: "expense.created",
        actorPersonId: input.paidBy,
        groupId: input.groupId,
        expenseId: created.id,
        data: JSON.stringify({
          description: input.description,
          amount: input.amount.toString(),
          currency,
        }),
        createdAt: input.date,
      },
    });

    return created;
  }

  // --- The trip -----------------------------------------------------------

  // Four ways, payer absorbs the rounding.
  await expense({
    groupId: trip.id,
    description: "Airbnb — 4 nights",
    amount: 96000n,
    categoryId: "accommodation",
    date: daysAgo(21),
    paidBy: priya.id,
    splits: everyone.map((personId) => ({ personId, amount: 24000n })),
    notes: "Alfama, two bedrooms plus the sofa bed.",
  });

  await expense({
    groupId: trip.id,
    description: "Flights",
    amount: 78400n,
    categoryId: "flights",
    date: daysAgo(20),
    paidBy: ravi.id,
    splits: [
      { personId: priya.id, amount: 19600n },
      { personId: ravi.id, amount: 19600n },
      { personId: nadia.id, amount: 19600n },
      { personId: sam.id, amount: 19600n },
    ],
  });

  // Itemised: a receipt where people ordered different things.
  await expense({
    groupId: trip.id,
    description: "Dinner at Cervejaria",
    amount: 14250n,
    categoryId: "dining",
    splitMode: "ITEMIZED",
    date: daysAgo(19),
    paidBy: nadia.id,
    splits: [
      { personId: priya.id, amount: 2850n },
      { personId: ravi.id, amount: 5700n },
      { personId: nadia.id, amount: 3325n },
      { personId: sam.id, amount: 2375n },
    ],
    items: [
      { name: "Seafood platter", amount: 4800n, participantIds: [ravi.id] },
      { name: "Grilled bass", amount: 2800n, participantIds: [nadia.id] },
      { name: "Bacalhau", amount: 2400n, participantIds: [priya.id] },
      { name: "Vegetable rice", amount: 2000n, participantIds: [sam.id] },
    ],
    notes: "Service and the wine split across everyone by what they ordered.",
  });

  // A GBP expense inside a EUR group.
  await expense({
    groupId: trip.id,
    description: "Airport transfer",
    amount: 5200n,
    currency: "GBP",
    exchangeRate: "1.18",
    convertedAmount: 6136n,
    categoryId: "taxi",
    date: daysAgo(21),
    paidBy: priya.id,
    splits: [
      { personId: priya.id, amount: 1300n },
      { personId: ravi.id, amount: 1300n },
      { personId: nadia.id, amount: 1300n },
      { personId: sam.id, amount: 1300n },
    ],
  });

  // Shares: Ravi and Sam shared a double room.
  await expense({
    groupId: trip.id,
    description: "Sintra day trip",
    amount: 18000n,
    categoryId: "activities",
    splitMode: "SHARES",
    date: daysAgo(18),
    paidBy: ravi.id,
    splits: [
      { personId: priya.id, amount: 3600n, weight: 1 },
      { personId: ravi.id, amount: 7200n, weight: 2 },
      { personId: nadia.id, amount: 3600n, weight: 1 },
      { personId: sam.id, amount: 3600n, weight: 1 },
    ],
  });

  const drinks = await expense({
    groupId: trip.id,
    description: "Drinks in Bairro Alto",
    amount: 6800n,
    categoryId: "drinks",
    date: daysAgo(17),
    paidBy: nadia.id,
    splits: everyone.map((personId) => ({ personId, amount: 1700n })),
  });

  await prisma.comment.createMany({
    data: [
      {
        expenseId: drinks.id,
        personId: ravi.id,
        body: "I only had the one — happy to be left out of this round?",
        createdAt: daysAgo(17),
      },
      {
        expenseId: drinks.id,
        personId: nadia.id,
        body: "You had three. I have photographic evidence.",
        createdAt: daysAgo(17),
      },
    ],
  });

  await prisma.activity.create({
    data: {
      type: "comment.created",
      actorPersonId: nadia.id,
      groupId: trip.id,
      expenseId: drinks.id,
      data: JSON.stringify({
        description: "Drinks in Bairro Alto",
        preview: "You had three. I have photographic evidence.",
      }),
      createdAt: daysAgo(17),
    },
  });

  await expense({
    groupId: trip.id,
    description: "Groceries",
    amount: 4715n,
    categoryId: "groceries",
    date: daysAgo(16),
    paidBy: priya.id,
    splits: [
      { personId: priya.id, amount: 1179n },
      { personId: ravi.id, amount: 1179n },
      { personId: nadia.id, amount: 1179n },
      { personId: sam.id, amount: 1178n },
    ],
  });

  // Someone has already paid some of it back.
  const settlement = await prisma.settlement.create({
    data: {
      groupId: trip.id,
      fromPersonId: nadia.id,
      toPersonId: priya.id,
      amount: 15000n,
      currency: "EUR",
      convertedAmount: 15000n,
      date: daysAgo(9),
      method: "Bank transfer",
      createdByPersonId: nadia.id,
    },
  });

  await prisma.activity.create({
    data: {
      type: "settlement.created",
      actorPersonId: nadia.id,
      groupId: trip.id,
      settlementId: settlement.id,
      data: JSON.stringify({
        amount: "15000",
        currency: "EUR",
        fromPersonId: nadia.id,
        toPersonId: priya.id,
      }),
      createdAt: daysAgo(9),
    },
  });

  // --- The flat -----------------------------------------------------------

  for (const [index, month] of [2, 1, 0].entries()) {
    const date = new Date();
    date.setMonth(date.getMonth() - month, 1);
    date.setHours(12, 0, 0, 0);

    await expense({
      groupId: flat.id,
      description: "Rent",
      amount: 140000n,
      categoryId: "rent",
      date,
      paidBy: priya.id,
      splits: [
        { personId: priya.id, amount: 70000n },
        { personId: nadia.id, amount: 70000n },
      ],
    });

    await expense({
      groupId: flat.id,
      description: index % 2 === 0 ? "Electricity" : "Internet",
      amount: index % 2 === 0 ? 8640n : 4500n,
      categoryId: index % 2 === 0 ? "utilities" : "internet",
      date: new Date(date.getTime() + 3 * DAY),
      paidBy: index % 2 === 0 ? nadia.id : priya.id,
      splits: [
        { personId: priya.id, amount: index % 2 === 0 ? 4320n : 2250n },
        { personId: nadia.id, amount: index % 2 === 0 ? 4320n : 2250n },
      ],
    });
  }

  // A repeating expense that will post itself next month.
  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
  nextMonth.setHours(12, 0, 0, 0);

  await prisma.recurrence.create({
    data: {
      groupId: flat.id,
      description: "Rent",
      amount: 140000n,
      currency: "EUR",
      categoryId: "rent",
      splitMode: "EQUAL",
      payersJson: JSON.stringify([{ personId: priya.id, amount: "140000" }]),
      splitsJson: JSON.stringify([
        { personId: priya.id, amount: "70000", included: true },
        { personId: nadia.id, amount: "70000", included: true },
      ]),
      frequency: "MONTHLY",
      interval: 1,
      dayOfMonth: 1,
      startDate: nextMonth,
      nextRunAt: nextMonth,
      createdByPersonId: priya.id,
    },
  });

  // --- A direct, non-group expense ----------------------------------------

  await expense({
    groupId: null,
    description: "Concert tickets",
    amount: 9000n,
    categoryId: "entertainment",
    date: daysAgo(5),
    paidBy: ravi.id,
    splits: [
      { personId: priya.id, amount: 4500n },
      { personId: ravi.id, amount: 4500n },
    ],
  });

  console.log("Seeded:");
  console.log("  2 groups, 1 direct expense, 4 people (one unclaimed placeholder)");
  console.log(`  Trip invite code:  ${trip.inviteCode}`);
  console.log(`  Flat invite code:  ${flat.inviteCode}`);
  console.log("\nSign in as Priya with this recovery key:\n");
  console.log(`  ${priyaSecret}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
