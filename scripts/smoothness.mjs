// Smoothness (MOTION-SPEC 8, RULES S2): every flow recorded three times with
// the processor slowed 4x, and the middle result of the three kept, so one
// unlucky run doesn't decide it.
//
//   node scripts/smoothness.mjs <base-url> <out-dir>
//
// Prints each flow's share of late frames (over 25ms, counted against the
// frames a 60Hz phone would draw) against the 2% limit, and writes
// out/summary.json. Each run's own timing.json and late.json (every late
// frame with the code that ran in it) are in out/run-1 to run-3.
//
// RUNS=n records n times instead of three. FLOW=<name> records one flow.
// STRICT=1 fails when any flow is over the limit. In CI it runs on GitHub's
// machines, the same kind every time, so its numbers can be compared from
// one change to the next; this laptop's numbers drift through a day.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "smoothness";
const RUNS = Number(process.env.RUNS ?? 3);
const LIMIT = 0.02;

mkdirSync(OUT, { recursive: true });
const runs = [];
for (let n = 1; n <= RUNS; n++) {
  const dir = `${OUT}/run-${n}`;
  const run = spawnSync(process.execPath, ["scripts/motion-record.mjs", BASE, dir, "timing"], {
    env: { ...process.env, DETAIL: "1" },
    stdio: "inherit",
  });
  if (run.status !== 0) {
    console.error(`run ${n} stopped (exit ${run.status})`);
    process.exit(1);
  }
  runs.push(JSON.parse(readFileSync(`${dir}/timing.json`, "utf8")));
}

const middle = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percent = (share) => `${(share * 100).toFixed(1)}%`;
const summary = {};
const lines = [];
for (const flow of Object.keys(runs[0])) {
  const shares = runs.map((run) => run[flow]?.lateShareAt60Hz).filter((share) => share != null);
  if (!shares.length) continue;
  const share = middle(shares);
  summary[flow] = { lateShareAt60Hz: share, runs: shares, passes: share < LIMIT };
  lines.push({ flow, share, shares, passes: share < LIMIT });
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));

console.log(`\nLate frames, the middle of ${RUNS} runs (limit under ${percent(LIMIT)}):`);
for (const { flow, share, shares, passes } of lines)
  console.log(`${flow.padEnd(18)} ${percent(share).padStart(6)}  [${shares.map(percent).join(", ")}]  ${passes ? "passes" : "OVER"}`);
const over = lines.filter((line) => !line.passes).length;
console.log(over ? `${over} of ${lines.length} flows over the limit` : `all ${lines.length} flows pass`);

// On GitHub, the same table on the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Smoothness: late frames, the middle of ${RUNS} runs (limit under ${percent(LIMIT)})`,
      "",
      "| Flow | Late frames | Each run | |",
      "|---|---|---|---|",
      ...lines.map(({ flow, share, shares, passes }) => `| ${flow} | ${percent(share)} | ${shares.map(percent).join(", ")} | ${passes ? "passes" : "over"} |`),
      "",
    ].join("\n"),
  );
}

process.exitCode = process.env.STRICT && over ? 1 : 0;
