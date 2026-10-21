import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { describe, expect, it } from "vitest";
import { databaseFile } from "../../../prisma/database-url";
import { oneAtATime } from "../one-at-a-time";

const sql = (text: string) => ({ sql: text, args: [], argTypes: [] });

describe("databaseFile", () => {
  it("reads a relative address from prisma/, as Prisma 6 did", () => {
    expect(databaseFile("file:./design.db")).toBe(path.join(process.cwd(), "prisma", "design.db"));
  });

  it("leaves production's absolute address alone", () => {
    expect(databaseFile("file:/data/divvy.db")).toBe("/data/divvy.db");
  });

  it("drops Prisma 6's pool settings instead of naming the file after them", () => {
    expect(databaseFile("file:/data/divvy.db?connection_limit=1")).toBe("/data/divvy.db");
  });
});

describe("oneAtATime", () => {
  async function open() {
    const db = oneAtATime(await new PrismaBetterSqlite3({ url: ":memory:" }).connect());
    await db.executeRaw(sql("CREATE TABLE saves (who TEXT)"));
    return db;
  }

  async function saved(db: Awaited<ReturnType<typeof open>>) {
    const result = await db.queryRaw(sql("SELECT who FROM saves ORDER BY rowid"));
    return result.rows.map((row) => row[0]);
  }

  it("keeps another request's save when a transaction rolls back", async () => {
    const db = await open();
    const tx = await db.startTransaction();
    await tx.executeRaw(sql("INSERT INTO saves VALUES ('inside')"));

    // Without the turn-taking this ran inside the open transaction and was
    // undone with it.
    const outside = db.executeRaw(sql("INSERT INTO saves VALUES ('outside')"));

    await tx.executeRaw(sql("ROLLBACK"));
    await tx.rollback();
    await outside;

    expect(await saved(db)).toEqual(["outside"]);
  });

  it("lets transactions and queries through in the order they asked", async () => {
    const db = await open();
    const first = await db.startTransaction();
    const second = db.startTransaction();
    const query = db.executeRaw(sql("INSERT INTO saves VALUES ('c')"));

    await first.executeRaw(sql("INSERT INTO saves VALUES ('a')"));
    await first.executeRaw(sql("COMMIT"));
    await first.commit();

    const tx = await second;
    await tx.executeRaw(sql("INSERT INTO saves VALUES ('b')"));
    await tx.executeRaw(sql("COMMIT"));
    await tx.commit();
    await query;

    expect(await saved(db)).toEqual(["a", "b", "c"]);
  });

  it("gives the turn back when a transaction cannot start", async () => {
    const db = await open();
    await expect(db.startTransaction("READ UNCOMMITTED")).rejects.toThrow();
    await db.executeRaw(sql("INSERT INTO saves VALUES ('after')"));
    expect(await saved(db)).toEqual(["after"]);
  });
});
