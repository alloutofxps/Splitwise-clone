// Mutation testing (RULES.md M12, Q2): Stryker plants small mistakes in the
// money code, one at a time, and checks that some test fails for each.
//   MONEY_RUNS=300 npx stryker run
// CI runs it too (the `mutation` job) and fails below 85%. On 2026-10-28 it
// scored 89.5%; every mistake still missed was checked by hand and none can
// change an amount anyone sees.
// MONEY_RUNS keeps the random money tests quick while Stryker repeats them
// once per planted mistake.
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: { configFile: "vitest.config.mts" },
  mutate: ["src/lib/split.ts", "src/lib/balances.ts", "src/lib/money.ts"],
  reporters: ["clear-text", "progress", "html", "json"],
  jsonReporter: { fileName: "perf-runs/stryker/report.json" },
  htmlReporter: { fileName: "perf-runs/stryker/report.html" },
  tempDirName: ".stryker-tmp",
  concurrency: 4,
  thresholds: { high: 90, low: 80, break: 85 },
};
