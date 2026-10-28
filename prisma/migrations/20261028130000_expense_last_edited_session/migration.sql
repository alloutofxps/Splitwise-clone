-- Which sign-in saved an expense's current version (server/write.ts,
-- updateExpense). Empty for every existing row, which only makes the edit
-- check stricter for them; adding a column never touches the rows.
ALTER TABLE "Expense" ADD COLUMN "lastEditedSessionId" TEXT;
