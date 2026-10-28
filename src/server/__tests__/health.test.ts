import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import {
  allowedGap,
  healthProblems,
  noteJobRan,
  noteIntegrity,
  noteJobScheduled,
  notePhoneError,
  resetHealth,
} from "../health";

const MINUTE = 60_000;
const T0 = new Date("2026-10-28T12:00:00Z").getTime();

beforeEach(() => {
  resetHealth();
  (globalThis as { __divvyErrorTimes?: number[] }).__divvyErrorTimes = [];
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the health check's alarm", () => {
  it("is quiet when nothing is wrong", () => {
    noteJobScheduled("push", 15_000);
    expect(healthProblems()).toEqual([]);
  });

  it("goes off at five server errors in fifteen minutes, and clears after", () => {
    for (let i = 0; i < 4; i++) log.error("boom");
    expect(healthProblems()).toEqual([]);
    log.error("boom");
    expect(healthProblems()).toEqual(["5 server errors in the last 15 minutes"]);
    vi.setSystemTime(T0 + 15 * MINUTE + 1);
    expect(healthProblems()).toEqual([]);
  });

  it("goes off when a job stops running, and clears when it runs again", () => {
    noteJobScheduled("push", 15_000);
    noteJobScheduled("snapshot", 24 * 60 * MINUTE);
    // Fifteen-second job: late after its gap, about sixteen minutes.
    expect(allowedGap(15_000)).toBe(15_000 + 30_000 + 15 * MINUTE);
    expect(healthProblems(T0 + allowedGap(15_000))).toEqual([]);
    expect(healthProblems(T0 + allowedGap(15_000) + MINUTE)).toEqual(["the push job has not run for 17 minutes"]);
    noteJobRan("push", T0 + allowedGap(15_000) + MINUTE);
    expect(healthProblems(T0 + allowedGap(15_000) + MINUTE)).toEqual([]);
    // The daily snapshot gets a day and a quarter or so.
    expect(allowedGap(24 * 60 * MINUTE)).toBe((24 * 60 + 120 + 15) * MINUTE);
  });

  it("goes off when three signed-in people crash in an hour", () => {
    notePhoneError("ana");
    notePhoneError("ana");
    notePhoneError("ben");
    expect(healthProblems()).toEqual([]);
    notePhoneError("cy");
    expect(healthProblems()).toEqual(["crashes on 3 people's phones in the last hour"]);
    expect(healthProblems(T0 + 60 * MINUTE + 1)).toEqual([]);
  });

  it("goes off while the daily database check has found something", () => {
    noteIntegrity({ "bills whose shares don't add up to the total (live)": 1 });
    expect(healthProblems()).toEqual([
      "the daily database check found bills whose shares don't add up to the total (live): 1",
    ]);
    noteIntegrity({});
    expect(healthProblems()).toEqual([]);
  });

  it("ignores a job it was never told about", () => {
    noteJobRan("unknown");
    expect(healthProblems(T0 + 100 * 60 * MINUTE)).toEqual([]);
  });
});
