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
// COMPARE=<url> also records main, served at that address, taking turns with
// the change on the same machine: main then the change, then the change then
// main, and so on, so a machine that slows down through the job slows both
// alike. Main's runs are in out/main. Each flow then shows main, the change
// and the difference, the middle of each round's own difference. This is the
// fair before and after: GitHub hands each job a different machine, and
// main's own numbers have been 2 of 14 flows over the limit on one and 9 of
// 14 on the next, with the same code (PERF-BASELINE 30).
//
// The two opening flows (01, 08) are judged by what the screen shows while
// the opening drawing is on it (motion-record's `seen`, MOTION-SPEC 8): the
// app starting reads its scripts and builds its first screen in tasks of
// 100ms and more, so the page's own count can't pass there, and the drawing
// is made to keep moving through them. Opening a group (02, 11) is judged
// the same way, from each new screen's first picture until everything moving
// for it has stopped: building a group's screen takes the page a few hundred
// milliseconds that nothing on screen can hide. Their page count is still
// shown.
//
// RUNS=n records n times instead of three. FLOW=<name> records one flow.
// STRICT=1 fails when any flow is over the limit.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:3100";
const OUT = process.argv[3] ?? "smoothness";
const MAIN = process.env.COMPARE;
const RUNS = Number(process.env.RUNS ?? 3);
const LIMIT = 0.02;
const OPENING_FLOWS = ["01-opening", "08-first-run"];
const CHANGE_FLOWS = ["02-home-to-group", "11-group-row"];
const SEEN_FLOWS = [...OPENING_FLOWS, ...CHANGE_FLOWS];

function record(base, dir, mode = "timing") {
  const run = spawnSync(process.execPath, ["scripts/motion-record.mjs", base, dir, mode], {
    env: { ...process.env, DETAIL: "1" },
    stdio: "inherit",
  });
  if (run.status !== 0) {
    console.error(`${dir} stopped (exit ${run.status})`);
    process.exit(1);
  }
  const timing = JSON.parse(readFileSync(`${dir}/${mode}.json`, "utf8"));
  if (mode !== "timing") return timing;
  // The opening flows and opening a group: what was seen, in place of the
  // page's own count.
  const seen = record(base, dir, "seen");
  for (const flow of SEEN_FLOWS) {
    if (!timing[flow]) continue;
    timing[flow] = seen[flow]
      ? { ...seen[flow], page: timing[flow].lateShareAt60Hz }
      : // The drawing never showed, or no new screen slid in: counted as
        // failing, not left out.
        { ...timing[flow], lateShareAt60Hz: 1, page: timing[flow].lateShareAt60Hz };
  }
  return timing;
}

mkdirSync(OUT, { recursive: true });
const runs = [];
const mainRuns = [];
for (let n = 1; n <= RUNS; n++) {
  const turns = [() => runs.push(record(BASE, `${OUT}/run-${n}`))];
  if (MAIN) turns.push(() => mainRuns.push(record(MAIN, `${OUT}/main/run-${n}`)));
  if (n % 2) turns.reverse();
  for (const turn of turns) turn();
}

const middle = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const percent = (share) => `${(share * 100).toFixed(1)}%`;
const points = (share) => `${share > 0 ? "+" : ""}${(share * 100).toFixed(1)}`;
const sharesOf = (all, flow) => all.map((run) => run[flow]?.lateShareAt60Hz ?? null);
const summary = {};
const lines = [];
for (const flow of Object.keys(runs[0])) {
  const shares = sharesOf(runs, flow).filter((share) => share != null);
  if (!shares.length) continue;
  const share = middle(shares);
  const line = { flow, share, shares, passes: share < LIMIT };
  if (MAIN) {
    const own = sharesOf(mainRuns, flow);
    const paired = sharesOf(runs, flow)
      .map((share, n) => (share == null || own[n] == null ? null : share - own[n]))
      .filter((difference) => difference != null);
    line.mainShares = own.filter((share) => share != null);
    line.mainShare = line.mainShares.length ? middle(line.mainShares) : null;
    line.difference = paired.length ? middle(paired) : null;
  }
  summary[flow] = {
    lateShareAt60Hz: share,
    runs: shares,
    passes: line.passes,
    ...(MAIN && { main: line.mainShare, mainRuns: line.mainShares, difference: line.difference }),
  };
  lines.push(line);
}
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));

const over = lines.filter((line) => !line.passes).length;
const verdict = over ? `${over} of ${lines.length} flows over the limit` : `all ${lines.length} flows pass`;
const mainOver = MAIN && lines.filter((line) => line.mainShare != null && line.mainShare >= LIMIT).length;

console.log(`\nLate frames, the middle of ${RUNS} runs (limit under ${percent(LIMIT)}):`);
for (const line of lines) {
  const theirs = MAIN ? `main ${line.mainShare == null ? "  -  " : percent(line.mainShare).padStart(5)}  ` : "";
  const change = MAIN && line.difference != null ? `  ${points(line.difference).padStart(5)}` : "";
  const page = SEEN_FLOWS.includes(line.flow) ? `  (seen; the page's own count ${percent(middle(runs.map((run) => run[line.flow]?.page ?? 0)))})` : "";
  console.log(`${line.flow.padEnd(18)} ${theirs}${percent(line.share).padStart(6)}${change}  [${line.shares.map(percent).join(", ")}]  ${line.passes ? "passes" : "OVER"}${page}`);
}
console.log(verdict + (MAIN ? ` (main: ${mainOver})` : ""));

// On GitHub, the same table on the run's summary page.
if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = MAIN
    ? [
        "| Flow | Main | This change | Difference | Each run (this change) | |",
        "|---|---|---|---|---|---|",
        ...lines.map((line) =>
          `| ${line.flow} | ${line.mainShare == null ? "-" : percent(line.mainShare)} | ${percent(line.share)} | ${line.difference == null ? "-" : points(line.difference)} | ${line.shares.map(percent).join(", ")} | ${line.passes ? "passes" : "over"} |`,
        ),
      ]
    : [
        "| Flow | Late frames | Each run | |",
        "|---|---|---|---|",
        ...lines.map(({ flow, share, shares, passes }) => `| ${flow} | ${percent(share)} | ${shares.map(percent).join(", ")} | ${passes ? "passes" : "over"} |`),
      ];
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Smoothness: late frames, the middle of ${RUNS} runs (limit under ${percent(LIMIT)})`,
      "",
      ...(MAIN ? ["Main and this change recorded in turns on the same machine. Difference: points of late frames, the middle of each round's own difference; minus is better.", ""] : []),
      `${OPENING_FLOWS.join(" and ")}: late frames on screen while the opening drawing shows; ${CHANGE_FLOWS.join(" and ")}: late frames on screen while the group's screen moves in (MOTION-SPEC 8). Not the page's own count.`,
      "",
      ...rows,
      "",
      verdict + (MAIN ? `; main: ${mainOver}.` : "."),
      "",
    ].join("\n"),
  );
}

process.exitCode = process.env.STRICT && over ? 1 : 0;
