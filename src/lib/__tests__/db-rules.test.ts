import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * The database refuses rows the money rules say can't exist
 * (prisma/migrations/20261028150000_refuse_impossible_rows), and still takes
 * every row that can. Built from the real migrations, in order.
 */

type Db = Awaited<ReturnType<PrismaBetterSqlite3["connect"]>>;
let db: Db;
const now = Date.now();


beforeEach(async () => {
  db = await new PrismaBetterSqlite3({ url: ":memory:" }).connect();
  const dir = path.join(process.cwd(), "prisma", "migrations");
  for (const name of readdirSync(dir).filter((n) => /^\d/.test(n)).sort()) {
    await db.executeScript(readFileSync(path.join(dir, name, "migration.sql"), "utf8"));
  }
  await db.executeScript(`
    INSERT INTO "Person" (id, displayName, inviteCode, updatedAt) VALUES ('ana', 'Ana', 'a', ${now}), ('ben', 'Ben', 'b', ${now});
    INSERT INTO "Group" (id, name, inviteCode, updatedAt) VALUES ('g', 'Trip', 'g', ${now});
  `);
});

const expense = (id: string, amount: number, converted = amount) =>
  db.executeScript(`INSERT INTO "Expense" (id, groupId, description, amount, currency, convertedAmount, createdByPersonId, updatedAt) VALUES ('${id}', 'g', 'Dinner', ${amount}, 'EUR', ${converted}, 'ana', ${now})`);
const row = (table: "ExpenseSplit" | "ExpensePayer", id: string, person: string, amount: number) =>
  db.executeScript(`INSERT INTO "${table}" (id, expenseId, personId, amount) VALUES ('${id}', 'e', '${person}', ${amount})`);
const payment = (id: string, from: string, to: string, amount: number, deletedAt: number | null = null) =>
  db.executeScript(`INSERT INTO "Settlement" (id, groupId, fromPersonId, toPersonId, amount, currency, convertedAmount, createdByPersonId, updatedAt, deletedAt) VALUES ('${id}', 'g', '${from}', '${to}', ${amount}, 'EUR', ${amount}, 'ana', ${now}, ${deletedAt ?? "NULL"})`);
const sql = (text: string) => db.executeScript(text);

/** The database's own words when it refuses, or "accepted". */
async function refusal(write: () => Promise<unknown>): Promise<string> {
  try {
    await write();
    return "accepted";
  } catch (error) {
    return (error as { cause?: { originalMessage?: string } }).cause?.originalMessage ?? String(error);
  }
}

describe("rows that can exist", () => {
  it("are all accepted", async () => {
    await expense("e", 1000);
    await expense("tiny", 1, 0); // rounds to nothing in the group's currency
    await row("ExpenseSplit", "s1", "ana", 0);
    await row("ExpenseSplit", "s2", "ben", 1000);
    await row("ExpensePayer", "p1", "ana", 1000);
    await payment("t1", "ben", "ana", 500);
    await payment("t2", "ana", "ana", 500, now); // binned, left by a merge
    await sql(`UPDATE "Settlement" SET deletedAt = ${now} WHERE id = 't1'`);
  });
});

describe("rows that can't", () => {
  beforeEach(() => expense("e", 1000));

  it("a bill of nothing, or less", async () => {
    expect(await refusal(() => expense("zero", 0))).toMatch(/amount above zero/);
    expect(await refusal(() => expense("minus", -5))).toMatch(/amount above zero/);
    expect(await refusal(() => expense("neg-converted", 5, -1))).toMatch(/amount above zero/);
    expect(await refusal(() => sql(`UPDATE "Expense" SET amount = 0 WHERE id = 'e'`))).toMatch(/amount above zero/);
  });

  it("a share or a payment towards a bill below zero", async () => {
    expect(await refusal(() => row("ExpenseSplit", "s", "ana", -1))).toMatch(/share can't be below zero/);
    expect(await refusal(() => row("ExpensePayer", "p", "ana", -1))).toMatch(/paid can't be below zero/);
    await row("ExpenseSplit", "ok", "ben", 1);
    expect(await refusal(() => sql(`UPDATE "ExpenseSplit" SET amount = -1 WHERE id = 'ok'`))).toMatch(/below zero/);
  });

  it("a payment of nothing, or from someone to themselves", async () => {
    expect(await refusal(() => payment("zero", "ben", "ana", 0))).toMatch(/two different people/);
    expect(await refusal(() => payment("self", "ana", "ana", 500))).toMatch(/two different people/);
    await payment("binned", "ana", "ana", 500, now);
    expect(await refusal(() => sql(`UPDATE "Settlement" SET deletedAt = NULL WHERE id = 'binned'`))).toMatch(/two different people/);
    await payment("live", "ben", "ana", 500);
    expect(await refusal(() => sql(`UPDATE "Settlement" SET fromPersonId = 'ana' WHERE id = 'live'`))).toMatch(/two different people/);
  });
});
