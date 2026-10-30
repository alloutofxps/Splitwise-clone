/**
 * Colour check (RULES.md section 6, C1 to C7), from the tokens in
 * src/app/globals.css and a scan of the components. No server needed.
 *
 *   node scripts/colour-check.mjs
 *
 * One line per rule, passing or failing, with what failed underneath.
 * STRICT=1 exits 1 when a rule fails; STRICT_SKIP=C3,C7 leaves rules out of
 * that while their fixes are still to come (they're still measured).
 *
 *   C1  green, orange, red and amber each mean one thing: the money
 *       colours (positive, negative) only beside money words in the
 *       components (never on alerts, danger styles or hovers), and the four
 *       far enough apart to read as four, colour blind too;
 *   C2  text contrast (WCAG 2.2 AA, 4.5 to 1) on every surface it sits on,
 *       in Day and Night, and no text colour faded below its token;
 *   C3  APCA as a second opinion: body text Lc 75, secondary text and the
 *       money colours Lc 60, the faintest text (timestamps, small notes)
 *       Lc 45, avatar initials Lc 60;
 *   C4  owing and owed apart in lightness or hue under colour blindness
 *       (reported; the words and arrows beside every amount are checked in
 *       the browser suites);
 *   C5  an off switch's track and a field's edge reach 3 to 1 against what
 *       is around them;
 *   C6  the surfaces step evenly in lightness (OKLCH);
 *   C7  any two person colours stay apart, with normal vision and with each
 *       kind of colour blindness.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse, formatHex, wcagContrast, differenceEuclidean, converter, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit, clampChroma } from "culori";
import { APCAcontrast, sRGBtoY } from "apca-w3";

const css = readFileSync("src/app/globals.css", "utf8");
const block = (start) => {
  const i = css.indexOf(start);
  const body = css.slice(i, css.indexOf("\n}", i));
  const map = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) map[m[1]] = m[2].trim();
  return map;
};
const day = block(":root {");
// Night redefines only some tokens; the rest carry over from Day.
const themes = { day, night: { ...day, ...block(".dark {") } };

const oklab = converter("oklab");
const oklch = converter("oklch");
const dE = differenceEuclidean("oklab");
const resolve = (t, value) => {
  let v = value;
  for (let i = 0; i < 5 && v?.startsWith("var("); i++) v = t[v.slice(6, -1).trim()];
  return v;
};
const colour = (t, key) => {
  const v = resolve(t, t[key]);
  return v ? parse(v) : undefined;
};
const rgb = (c) => {
  const h = formatHex(clampChroma(c, "oklch"));
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const wcag = (a, b) => Math.round(wcagContrast(a, b) * 100) / 100;
const apca = (fg, bg) => Math.round(Math.abs(APCAcontrast(sRGBtoY(rgb(fg)), sRGBtoY(rgb(bg)))) * 10) / 10;

const results = [];
function rule(id, name, problems, info = []) {
  results.push({ id, name, problems, info });
}

// ---- C2 and C3: text on the surfaces it sits on -------------------------------

const SURFACES = ["bg", "surface", "surface-2", "surface-3", "elevated"];
// [token, surfaces, APCA minimum]
const TEXT = [
  ["text", SURFACES, 75],
  ["text-muted", SURFACES, 60],
  ["text-subtle", SURFACES, 45],
  ["positive-text", ["bg", "surface", "surface-2", "positive-soft", "elevated"], 60],
  ["negative-text", ["bg", "surface", "surface-2", "negative-soft", "elevated"], 60],
  ["danger", ["bg", "surface", "surface-2", "danger-soft", "elevated"], 60],
  ["warning", ["bg", "surface", "warning-soft", "elevated"], 60],
  ["text-inverse", ["brand", "brand-hover"], 75],
  ["brand-soft-text", ["brand-soft"], 75],
];
const persons = Object.keys(day).filter((k) => k.startsWith("person-"));
const c2 = [];
const c3 = [];
for (const [name, t] of Object.entries(themes)) {
  for (const [fg, bgs, minimum] of TEXT) {
    for (const bg of bgs) {
      const a = colour(t, fg), b = colour(t, bg);
      if (!a || !b) continue;
      const r = wcag(a, b), lc = apca(a, b);
      if (r < 4.5) c2.push(`${name}: ${fg} on ${bg} is ${r} to 1`);
      if (lc < minimum) c3.push(`${name}: ${fg} on ${bg} is Lc ${lc} (needs ${minimum})`);
    }
  }
  for (const p of persons) {
    const a = colour(t, "on-person"), b = colour(t, p);
    if (!a || !b) continue;
    const r = wcag(a, b), lc = apca(a, b);
    if (r < 4.5) c2.push(`${name}: initials on ${p} are ${r} to 1`);
    if (lc < 60) c3.push(`${name}: initials on ${p} are Lc ${lc} (needs 60)`);
  }
}

// Text colours faded below their token with an opacity ("text-subtle/60"),
// placeholders included; disabled controls are exempt from contrast.
const files = [];
(function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (path.endsWith(".tsx")) files.push(path);
  }
})("src");
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w:-])((?:placeholder:)?text-(?:subtle|muted|text)\/\d+)/g)) {
      c2.push(`${file.replace(/\\/g, "/")}:${i + 1} fades text: ${m[1]}`);
    }
  });
}
rule("C2", "text contrast, 4.5 to 1, nothing faded below its token", c2);
rule("C3", "APCA: body 75, secondary and money 60, faintest 45, initials 60", c3);

// ---- C1: the money colours only beside money -----------------------------------

const MONEY = /owe|owed|lent|\bnet\b|amount|balance|toMe|mine\b|iAmPaying|pays?\b|paid|settle|owesYou|direction|tone/i;
// Never money, whatever words sit nearby: alerts, danger styles, hovers.
const NOT_MONEY = /TriangleAlert|role="alert"|tone === "danger"|hover:(?:bg|text)-(?:positive|negative)/;
const c1 = [];
for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (!/(?:text|bg|border|decoration|fill|stroke|ring)-(?:positive|negative)(?:-text|-soft)?\b/.test(line)) return;
    const near = lines.slice(Math.max(0, i - 3), i + 4).join("\n");
    if (NOT_MONEY.test(line) || !MONEY.test(near)) c1.push(`${file.replace(/\\/g, "/")}:${i + 1}: ${line.trim().slice(0, 110)}`);
  });
}
// The four meaning colours far enough apart to read as four, with normal
// vision and the two commonest colour blindnesses.
const MEANINGS = ["positive-text", "negative-text", "danger", "warning"];
const blind = [filterDeficiencyDeuter(1), filterDeficiencyProt(1)];
for (const [name, t] of Object.entries(themes)) {
  for (let i = 0; i < MEANINGS.length; i++) {
    for (let j = i + 1; j < MEANINGS.length; j++) {
      const a = colour(t, MEANINGS[i]), b = colour(t, MEANINGS[j]);
      const normal = dE(a, b), cvd = Math.min(...blind.map((f) => dE(f(a), f(b))));
      if (normal < 0.075 || cvd < 0.045) c1.push(`${name}: ${MEANINGS[i]} and ${MEANINGS[j]} are ${normal.toFixed(3)} apart (${cvd.toFixed(3)} colour blind; need 0.075 and 0.045)`);
    }
  }
}
rule("C1", "green, orange, red and amber each mean one thing, and look it", c1);

// ---- C4: owing and owed under colour blindness (reported) ----------------------

const VISIONS = [["normal", (c) => c], ["protan", filterDeficiencyProt(1)], ["deutan", filterDeficiencyDeuter(1)], ["tritan", filterDeficiencyTrit(1)]];
const c4info = [];
for (const [name, t] of Object.entries(themes)) {
  for (const [vision, f] of VISIONS) {
    const a = f(colour(t, "positive-text")), b = f(colour(t, "negative-text"));
    c4info.push(`${name} ${vision}: ${Math.round(dE(a, b) * 1000) / 1000} apart, lightness gap ${Math.round(Math.abs(oklab(a).l - oklab(b).l) * 1000) / 1000}`);
  }
}
rule("C4", "owing and owed told apart without colour (words and arrows: browser suites)", [], c4info);

// ---- C5: an off switch and a field's edge, 3 to 1 ------------------------------

const c5 = [];
for (const [name, t] of Object.entries(themes)) {
  for (const [part, around] of [["switch-off", ["bg", "surface", "elevated"]], ["field-edge", ["bg", "surface", "elevated", "surface-2"]]]) {
    const a = colour(t, part);
    if (!a) {
      c5.push(`${name}: no --${part} colour yet`);
      continue;
    }
    for (const bg of around) {
      const r = wcag(a, colour(t, bg));
      if (r < 3) c5.push(`${name}: ${part} against ${bg} is ${r} to 1`);
    }
  }
}
rule("C5", "an off switch and a field's edge reach 3 to 1", c5);

// ---- C6: even lightness steps ---------------------------------------------------

const c6 = [];
const c6info = [];
for (const [name, t] of Object.entries(themes)) {
  const order = name === "day" ? ["surface", "bg", "surface-2", "surface-3"] : ["bg", "surface", "surface-2", "surface-3"];
  const L = order.map((k) => oklch(colour(t, k)).l);
  const steps = L.slice(1).map((l, i) => Math.round(Math.abs(l - L[i]) * 1000) / 1000);
  c6info.push(`${name}: ${order.join(" > ")} steps ${steps.join(", ")}`);
  const small = steps.filter((s) => s < 0.01);
  if (small.length) c6.push(`${name}: a step under 0.01 (${steps.join(", ")})`);
  const outer = steps.slice(1);
  if (Math.max(...outer) / Math.min(...outer) > 2) c6.push(`${name}: uneven steps (${steps.join(", ")})`);
}
rule("C6", "surfaces step evenly in lightness", c6, c6info);

// ---- C7: person colours apart ---------------------------------------------------

const MIN = { normal: 0.07, protan: 0.03, deutan: 0.03, tritan: 0.03 };
const c7 = [];
const c7info = [];
for (const [name, t] of Object.entries(themes)) {
  for (const [vision, f] of VISIONS) {
    let closest = [Infinity, "", ""];
    for (let i = 0; i < persons.length; i++) {
      for (let j = i + 1; j < persons.length; j++) {
        const d = dE(f(colour(t, persons[i])), f(colour(t, persons[j])));
        if (d < closest[0]) closest = [d, persons[i], persons[j]];
      }
    }
    const d = Math.round(closest[0] * 1000) / 1000;
    c7info.push(`${name} ${vision}: closest ${closest[1]} and ${closest[2]}, ${d}`);
    if (d < MIN[vision]) c7.push(`${name} ${vision}: ${closest[1]} and ${closest[2]} are ${d} apart (needs ${MIN[vision]})`);
  }
}
rule("C7", "person colours apart, normal vision and colour blind", c7, c7info);

// ---- report ---------------------------------------------------------------------

const skip = (process.env.STRICT_SKIP ?? "").split(",").filter(Boolean);
let failing = 0;
for (const r of results.sort((a, b) => a.id.localeCompare(b.id))) {
  const ok = r.problems.length === 0;
  const skipped = !ok && skip.includes(r.id);
  if (!ok && !skipped) failing++;
  console.log(`${ok ? "✓" : skipped ? "…" : "✗"} ${r.id} ${r.name}${ok ? "" : ` (${r.problems.length})`}${skipped ? ", to be fixed" : ""}`);
  for (const p of r.problems.slice(0, 40)) console.log(`    ${p}`);
  for (const i of r.info) console.log(`    · ${i}`);
}
process.exit(process.env.STRICT && failing ? 1 : 0);
