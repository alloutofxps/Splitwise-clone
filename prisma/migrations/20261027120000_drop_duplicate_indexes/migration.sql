-- Seven indexes that a unique rule on the same table already covers (audit
-- item 21). A unique rule makes its own index, and an index on (a, b) also
-- serves lookups by a alone, so these only cost space and a little time on
-- every write. Dropping an index never touches the rows.
DROP INDEX "Person_inviteCode_idx";
DROP INDEX "Group_inviteCode_idx";
DROP INDEX "Friendship_personAId_idx";
DROP INDEX "Membership_groupId_idx";
DROP INDEX "ExpensePayer_expenseId_idx";
DROP INDEX "ExpenseSplit_expenseId_idx";
DROP INDEX "ExpenseItemShare_itemId_idx";
