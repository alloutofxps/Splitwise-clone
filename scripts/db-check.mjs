/**
 * Read-only health check of a Divvy database (RULES.md D1 to D4, B1).
 *
 * Opens the file read-only and prints counts only: never a name, an amount, a
 * note or an id, so its output is safe to paste anywhere. Every "problem" line
 * should be 0.
 *
 *   DATABASE_URL=file:./design.db node scripts/db-check.mjs
 *
 * On the live server it runs inside the container, from /app (where the
 * database library is installed): `node scripts/db-check-live.mjs`.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Resolved from the folder it runs in, so the same file works here and when
// it is piped into the live server from somewhere else.
const require = createRequire(path.join(process.cwd(), "package.json"));
const Database = require("better-sqlite3");

const url = process.env.DATABASE_URL || "file:/data/divvy.db";
let file = url.replace(/^file:/, "").split("?")[0];
if (!file.startsWith("/") && !/^[A-Za-z]:/.test(file)) file = path.join("prisma", file);
const db = new Database(file, { readonly: true, fileMustExist: true });
const count = (sql) => Number(Object.values(db.prepare(sql).get())[0] ?? 0);
const now = Date.now();
const DAY = 86_400_000;

const tables = db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' ORDER BY name")
  .all()
  .map((row) => row.name);
const rows = Object.fromEntries(tables.map((t) => [t, count(`SELECT COUNT(*) FROM "${t}"`)]));

// Each of these must be 0.
const problems = {
  "database file damaged (quick_check)": db.pragma("quick_check", { simple: true }) === "ok" ? 0 : 1,
  "rows pointing at something missing (foreign keys)": db.pragma("foreign_key_check").length,

  "bills whose shares don't add up to the total (live)": count(`
    SELECT COUNT(*) FROM Expense e WHERE e.deletedAt IS NULL
      AND e.amount != (SELECT COALESCE(SUM(s.amount), 0) FROM ExpenseSplit s WHERE s.expenseId = e.id)`),
  "bills whose shares don't add up to the total (in the bin)": count(`
    SELECT COUNT(*) FROM Expense e WHERE e.deletedAt IS NOT NULL
      AND e.amount != (SELECT COALESCE(SUM(s.amount), 0) FROM ExpenseSplit s WHERE s.expenseId = e.id)`),
  "bills whose payers don't add up to the total (live)": count(`
    SELECT COUNT(*) FROM Expense e WHERE e.deletedAt IS NULL
      AND e.amount != (SELECT COALESCE(SUM(p.amount), 0) FROM ExpensePayer p WHERE p.expenseId = e.id)`),
  "bills whose payers don't add up to the total (in the bin)": count(`
    SELECT COUNT(*) FROM Expense e WHERE e.deletedAt IS NOT NULL
      AND e.amount != (SELECT COALESCE(SUM(p.amount), 0) FROM ExpensePayer p WHERE p.expenseId = e.id)`),
  "bills of zero or less": count("SELECT COUNT(*) FROM Expense WHERE amount <= 0"),
  "negative shares or payments toward a bill": count(
    "SELECT (SELECT COUNT(*) FROM ExpenseSplit WHERE amount < 0) + (SELECT COUNT(*) FROM ExpensePayer WHERE amount < 0)"),
  "bills in the group's own currency with a rate other than 1": count(`
    SELECT COUNT(*) FROM Expense e JOIN "Group" g ON g.id = e.groupId
      WHERE e.currency = g.currency AND e.exchangeRate != '1'`),
  "bills at a rate of 1 whose converted total differs": count(
    "SELECT COUNT(*) FROM Expense WHERE exchangeRate = '1' AND convertedAmount != amount"),
  "group bills sharing with someone never in the group": count(`
    SELECT COUNT(*) FROM ExpenseSplit s JOIN Expense e ON e.id = s.expenseId
      WHERE e.groupId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = e.groupId AND m.personId = s.personId)`),
  "group bills paid by someone never in the group": count(`
    SELECT COUNT(*) FROM ExpensePayer p JOIN Expense e ON e.id = p.expenseId
      WHERE e.groupId IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = e.groupId AND m.personId = p.personId)`),
  "itemised bills with no items": count(`
    SELECT COUNT(*) FROM Expense e WHERE e.splitMode = 'ITEMIZED' AND e.deletedAt IS NULL
      AND NOT EXISTS (SELECT 1 FROM ExpenseItem i WHERE i.expenseId = e.id)`),

  "payments of zero or less": count("SELECT COUNT(*) FROM Settlement WHERE amount <= 0"),
  "live payments from someone to themselves": count(
    "SELECT COUNT(*) FROM Settlement WHERE deletedAt IS NULL AND fromPersonId = toPersonId"),
  "payments at a rate of 1 whose converted total differs": count(
    "SELECT COUNT(*) FROM Settlement WHERE exchangeRate = '1' AND convertedAmount != amount"),
  "group payments involving someone never in the group": count(`
    SELECT COUNT(*) FROM Settlement t WHERE t.groupId IS NOT NULL AND (
      NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = t.groupId AND m.personId = t.fromPersonId) OR
      NOT EXISTS (SELECT 1 FROM Membership m WHERE m.groupId = t.groupId AND m.personId = t.toPersonId))`),

  "dates saved as text instead of numbers": count(`
    SELECT (SELECT COUNT(*) FROM Expense WHERE typeof(date) != 'integer' OR typeof(createdAt) != 'integer')
         + (SELECT COUNT(*) FROM Settlement WHERE typeof(date) != 'integer' OR typeof(createdAt) != 'integer')
         + (SELECT COUNT(*) FROM Person WHERE typeof(createdAt) != 'integer')`),
  "repeating expenses overdue by more than a day": count(
    `SELECT COUNT(*) FROM Recurrence WHERE active = 1 AND nextRunAt < ${now - DAY}
       AND (endsAt IS NULL OR endsAt > ${now})`),
  "repeating expenses stopped by an error": count(
    "SELECT COUNT(*) FROM Recurrence WHERE lastError IS NOT NULL"),
};

// Context, not problems.
const people = "FROM Person WHERE isGhost = 0 AND deletedAt IS NULL";
const usage = {
  "people (not placeholders, not deleted)": count(`SELECT COUNT(*) ${people}`),
  "placeholders": count("SELECT COUNT(*) FROM Person WHERE isGhost = 1"),
  "deleted accounts": count("SELECT COUNT(*) FROM Person WHERE deletedAt IS NOT NULL"),
  "people seen in the last day": count(`SELECT COUNT(*) ${people} AND lastSeenAt > ${now - DAY}`),
  "people seen in the last 7 days": count(`SELECT COUNT(*) ${people} AND lastSeenAt > ${now - 7 * DAY}`),
  "people seen in the last 30 days": count(`SELECT COUNT(*) ${people} AND lastSeenAt > ${now - 30 * DAY}`),
  "groups": count('SELECT COUNT(*) FROM "Group"'),
  "archived groups": count('SELECT COUNT(*) FROM "Group" WHERE archivedAt IS NOT NULL'),
  "bills added in the last 7 days": count(`SELECT COUNT(*) FROM Expense WHERE createdAt > ${now - 7 * DAY}`),
  "bills added in the last 30 days": count(`SELECT COUNT(*) FROM Expense WHERE createdAt > ${now - 30 * DAY}`),
  "bills in the bin": count("SELECT COUNT(*) FROM Expense WHERE deletedAt IS NOT NULL"),
  "bills in a currency other than their group's": count(
    'SELECT COUNT(*) FROM Expense e JOIN "Group" g ON g.id = e.groupId WHERE e.currency != g.currency'),
  "payments in the last 30 days": count(`SELECT COUNT(*) FROM Settlement WHERE createdAt > ${now - 30 * DAY}`),
  "phones with notifications on": rows.PushSubscription ?? 0,
  "receipts, total KB": Math.round(count("SELECT COALESCE(SUM(LENGTH(data)), 0) FROM Attachment") / 1024),
  "database file, KB": Math.round(fs.statSync(file).size / 1024),
};

const bad = Object.values(problems).reduce((a, b) => a + (b > 0 ? 1 : 0), 0);
console.log(JSON.stringify({ checkedAt: new Date(now).toISOString(), rows, problems, usage, verdict: bad === 0 ? "no problems" : `${bad} kinds of problem` }, null, 2));
process.exit(bad === 0 ? 0 : 1);
