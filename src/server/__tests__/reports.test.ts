import { afterEach, describe, expect, it } from "vitest";
import { readsReports, reportsReaderCode } from "../reports";
import { messageForReport } from "../push";

const person = (inviteCode: string, extra = {}) => ({ inviteCode, deletedAt: null, isGhost: false, ...extra });

describe("who reads reports", () => {
  afterEach(() => {
    delete process.env.DIVVY_REPORTS_TO;
  });

  it("is nobody until it's set", () => {
    expect(reportsReaderCode()).toBeNull();
    expect(readsReports(person("me-calm-otter-x7k2pq"))).toBe(false);
  });

  it("is the person with that invite code, however it was typed", () => {
    process.env.DIVVY_REPORTS_TO = " ME-Calm-Otter-X7K2PQ ";
    expect(readsReports(person("me-calm-otter-x7k2pq"))).toBe(true);
    expect(readsReports(person("me-bold-heron-a2b3c4"))).toBe(false);
  });

  it("is never a group's code, a deleted account or a placeholder", () => {
    process.env.DIVVY_REPORTS_TO = "mango-tiger-42-k7fq";
    expect(reportsReaderCode()).toBeNull();
    process.env.DIVVY_REPORTS_TO = "me-calm-otter-x7k2pq";
    expect(readsReports(person("me-calm-otter-x7k2pq", { deletedAt: new Date() }))).toBe(false);
    expect(readsReports(person("me-calm-otter-x7k2pq", { isGhost: true }))).toBe(false);
  });
});

describe("the notification", () => {
  it("says whether the sender was signed in, and opens the list", () => {
    const signedIn = messageForReport({ id: "r1", text: "Hello", signedIn: true });
    expect(signedIn).toMatchObject({ title: "Someone sent a report", body: "Hello", url: "/reports", tag: "report-r1" });
    expect(messageForReport({ id: "r2", text: "Hi", signedIn: false }).title).toBe("Someone not signed in sent a report");
  });

  it("keeps a long report short, on one line", () => {
    const body = messageForReport({ id: "r3", text: `${"word ".repeat(60)}\n\nmore`, signedIn: true }).body;
    expect(body.length).toBe(120);
    expect(body.endsWith("…")).toBe(true);
    expect(body).not.toContain("\n");
  });
});
