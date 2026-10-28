-- Rows the money rules say can never exist, refused by the database itself
-- (RULES.md D1, D2). The app already refuses each of these before saving;
-- this is the second wall, for a bug or a hand-run query that gets past it.
-- A refused write fails as a server error, which the health check counts, so
-- the owner is emailed rather than the row quietly stored.
--
-- What can't be written as a rule on one row, like a bill's shares adding up
-- to its total, is checked daily instead (server/integrity.ts).
--
-- Triggers rather than CHECK constraints: SQLite can only add a CHECK by
-- rebuilding the table. Adding a trigger never touches the rows, and every
-- live row already passes (scripts/db-check-live.mjs, 28 October 2026).

-- A bill is for more than nothing. Converted to the group's currency a tiny
-- amount can round to 0, so that one may be 0 but not below.
CREATE TRIGGER "Expense_amount_check_insert" BEFORE INSERT ON "Expense"
WHEN NEW."amount" <= 0 OR NEW."convertedAmount" < 0
BEGIN SELECT RAISE(ABORT, 'An expense needs an amount above zero.'); END;

CREATE TRIGGER "Expense_amount_check_update" BEFORE UPDATE OF "amount", "convertedAmount" ON "Expense"
WHEN NEW."amount" <= 0 OR NEW."convertedAmount" < 0
BEGIN SELECT RAISE(ABORT, 'An expense needs an amount above zero.'); END;

-- Nobody pays or owes less than nothing towards a bill.
CREATE TRIGGER "ExpenseSplit_amount_check_insert" BEFORE INSERT ON "ExpenseSplit"
WHEN NEW."amount" < 0
BEGIN SELECT RAISE(ABORT, 'A share can''t be below zero.'); END;

CREATE TRIGGER "ExpenseSplit_amount_check_update" BEFORE UPDATE OF "amount" ON "ExpenseSplit"
WHEN NEW."amount" < 0
BEGIN SELECT RAISE(ABORT, 'A share can''t be below zero.'); END;

CREATE TRIGGER "ExpensePayer_amount_check_insert" BEFORE INSERT ON "ExpensePayer"
WHEN NEW."amount" < 0
BEGIN SELECT RAISE(ABORT, 'What someone paid can''t be below zero.'); END;

CREATE TRIGGER "ExpensePayer_amount_check_update" BEFORE UPDATE OF "amount" ON "ExpensePayer"
WHEN NEW."amount" < 0
BEGIN SELECT RAISE(ABORT, 'What someone paid can''t be below zero.'); END;

-- A payment is for more than nothing, and between two different people. A
-- binned one may name the same person twice: merging a placeholder into
-- somebody can leave that behind, and it stays binned (settlements restore).
CREATE TRIGGER "Settlement_check_insert" BEFORE INSERT ON "Settlement"
WHEN NEW."amount" <= 0 OR NEW."convertedAmount" < 0
  OR (NEW."deletedAt" IS NULL AND NEW."fromPersonId" = NEW."toPersonId")
BEGIN SELECT RAISE(ABORT, 'A payment needs an amount above zero and two different people.'); END;

CREATE TRIGGER "Settlement_check_update" BEFORE UPDATE OF "amount", "convertedAmount", "deletedAt", "fromPersonId", "toPersonId" ON "Settlement"
WHEN NEW."amount" <= 0 OR NEW."convertedAmount" < 0
  OR (NEW."deletedAt" IS NULL AND NEW."fromPersonId" = NEW."toPersonId")
BEGIN SELECT RAISE(ABORT, 'A payment needs an amount above zero and two different people.'); END;
