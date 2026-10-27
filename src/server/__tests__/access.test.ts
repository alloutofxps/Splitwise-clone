import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

// A throwaway database built from the migrations, set before the app's client
// opens its connection (on the first query).
const folder = mkdtempSync(path.join(tmpdir(), "divvy-access-"));
process.env.DATABASE_URL = `file:${path.join(folder, "access.db")}`;

const { prisma } = await import("@/lib/db");
const { GROUP_COLUMNS, MEMBERSHIP_COLUMNS, readAccessRow, requireGroupAccess } = await import("../access");

describe("the access check's column lists", () => {
  // If this fails, a column was added to (or removed from) Group or Membership:
  // add it to GROUP_COLUMNS or MEMBERSHIP_COLUMNS in server/access.ts.
  it("name every column of a group", () => {
    expect(Object.keys(GROUP_COLUMNS).sort()).toEqual(Object.values(Prisma.GroupScalarFieldEnum).sort());
  });

  it("name every column of a membership", () => {
    expect(Object.keys(MEMBERSHIP_COLUMNS).sort()).toEqual(Object.values(Prisma.MembershipScalarFieldEnum).sort());
  });
});

describe("readAccessRow", () => {
  it("reads no row as a group that doesn't exist", () => {
    expect(readAccessRow(undefined)).toEqual({ group: null, membership: null });
  });

  it("reads a row with no membership as someone never in the group", () => {
    const row: Record<string, unknown> = {};
    for (const name of Object.keys(GROUP_COLUMNS)) row[`g_${name}`] = name;
    for (const name of Object.keys(MEMBERSHIP_COLUMNS)) row[`m_${name}`] = null;
    const { group, membership } = readAccessRow(row);
    expect(group?.id).toBe("id");
    expect(membership).toBeNull();
  });
});

describe("requireGroupAccess", () => {
  beforeAll(async () => {
    const driver = await new PrismaBetterSqlite3({ url: path.join(folder, "access.db") }).connect();
    const migrations = path.join(process.cwd(), "prisma", "migrations");
    for (const name of readdirSync(migrations).filter((entry) => !entry.includes(".")).sort()) {
      await driver.executeScript(readFileSync(path.join(migrations, name, "migration.sql"), "utf8"));
    }
    await driver.dispose();

    const person = (id: string) => ({ id, displayName: id, inviteCode: `code-${id}` });
    await prisma.person.createMany({ data: [person("ana"), person("ben"), person("cy"), person("dee")] });
    await prisma.group.create({
      data: {
        id: "flat",
        name: "Flat",
        inviteCode: "flat-code",
        defaultSplit: '{"mode":"EQUAL","entries":[]}',
        archivedAt: new Date("2026-10-01T12:00:00Z"),
        simplifyDebts: false,
        ledgerVersion: 3,
      },
    });
    await prisma.membership.createMany({
      data: [
        { groupId: "flat", personId: "ana", role: "owner" },
        { groupId: "flat", personId: "ben", nickname: "Benny" },
        { groupId: "flat", personId: "cy", leftAt: new Date("2026-10-02T08:30:00Z") },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    rmSync(folder, { recursive: true, force: true });
  });

  it("returns exactly the group and membership Prisma would", async () => {
    for (const personId of ["ana", "ben"]) {
      const access = await requireGroupAccess("flat", personId);
      expect(access.group).toEqual(await prisma.group.findUnique({ where: { id: "flat" } }));
      expect(access.membership).toEqual(
        await prisma.membership.findUnique({ where: { groupId_personId: { groupId: "flat", personId } } }),
      );
      expect(access.isOwner).toBe(personId === "ana");
    }
  });

  it("refuses someone who left, or was never in the group", async () => {
    await expect(requireGroupAccess("flat", "cy")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(requireGroupAccess("flat", "dee")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("says when the group doesn't exist", async () => {
    await expect(requireGroupAccess("gone", "ana")).rejects.toBeInstanceOf(NotFoundError);
  });
});
