/**
 * Finds the ten person colours (RULES C7): spread in lightness as well as
 * hue, so every pair stays apart with normal vision and each colour
 * blindness, while white (Day) or dark (Night) initials stay readable on
 * them (4.5 to 1, Lc 60), each still reads as text on the page for someone
 * not on Divvy yet, and each stays as close to its old value as that allows.
 *
 *   node scripts/person-colours.mjs
 *
 * Prints the values for src/app/globals.css; colour-check.mjs checks them.
 */
import { parse, formatHex, clampChroma, wcagContrast, differenceEuclidean, filterDeficiencyProt, filterDeficiencyDeuter, filterDeficiencyTrit, converter } from "culori";
import { APCAcontrast, sRGBtoY } from "apca-w3";

const dE = differenceEuclidean("oklab");
const oklch = converter("oklch");
const VISIONS = [[(c) => c, 0.07], [filterDeficiencyProt(1), 0.03], [filterDeficiencyDeuter(1), 0.03], [filterDeficiencyTrit(1), 0.03]];
const rgb = (c) => {
  const h = formatHex(clampChroma(c, "oklch"));
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
};
const lc = (fg, bg) => Math.abs(APCAcontrast(sRGBtoY(rgb(fg)), sRGBtoY(rgb(bg))));

const NAMES = ["azure", "violet", "orchid", "coral", "amber", "olive", "teal", "cobalt", "plum", "sand"];
const HUES = [245, 290, 330, 20, 70, 110, 185, 265, 310, 55];
const CHROMA = { day: [0.136, 0.14, 0.14, 0.14, 0.118, 0.118, 0.096, 0.15, 0.12, 0.07], night: [0.126, 0.126, 0.126, 0.126, 0.117, 0.108, 0.099, 0.135, 0.108, 0.063] };
const HUE_WINDOW = Number(process.env.HUE_WINDOW ?? 15);
const CHROMA_WINDOW = Number(process.env.CHROMA_WINDOW ?? 0.04);
const THEMES = {
  day: { L: [0.42, 0.58], initials: parse("#ffffff"), page: ["#fafaf8", "#ffffff", "#f3f2ef"].map((x) => parse(x)) },
  night: { L: [0.74, 0.86], initials: parse("#0b0b0a"), page: ["#0b0b0a", "#141413", "#1c1c1a", "#232321"].map((x) => parse(x)) },
};

let seed = 7;
const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

function ok(c, t) {
  if (wcagContrast(t.initials, c) < 4.5 || lc(t.initials, c) < 60) return false;
  // Someone not on Divvy yet is drawn as an outline with initials in their
  // colour: that colour is text on the page.
  return t.page.every((p) => wcagContrast(c, p) >= 4.5);
}
function score(cols) {
  let worst = Infinity;
  for (let i = 0; i < cols.length; i++) {
    for (let j = i + 1; j < cols.length; j++) {
      for (const [f, need] of VISIONS) worst = Math.min(worst, dE(f(cols[i]), f(cols[j])) / need);
    }
  }
  return worst;
}
const make = (l, c, h) => clampChroma({ mode: "oklch", l, c, h }, "oklch");
// Enough separation (110% of the target), then as close to today as can be:
// lightness, hue and chroma each weighed against a step that looks similar.
const L0 = { day: 0.545, night: 0.74 };
function objective(cols, state, name) {
  if (!cols.every((c) => ok(c, THEMES[name]))) return -1;
  const s = score(cols);
  if (s < 1.1) return s * 100;
  const C = CHROMA[name];
  const drift = state.reduce((sum, x, i) => sum + Math.abs(x.l - L0[name]) / 0.08 + Math.abs(x.h - HUES[i]) / 20 + Math.abs(x.c - C[i]) / 0.05, 0);
  return 110 + 1000 - drift * 10;
}

for (const [name, t] of Object.entries(THEMES)) {
  let best = null;
  for (let restart = 0; restart < 30; restart++) {
    const C = CHROMA[name];
    let state = HUES.map((h, i) => ({ l: t.L[0] + random() * (t.L[1] - t.L[0]), c: C[i], h }));
    let cols = state.map((s) => make(s.l, s.c, s.h));
    let current = objective(cols, state, name);
    for (let step = 0; step < 8000; step++) {
      const i = Math.floor(random() * state.length);
      const next = { ...state[i] };
      next.l = Math.min(t.L[1], Math.max(t.L[0], next.l + (random() - 0.5) * 0.04));
      next.c = Math.min(C[i] + CHROMA_WINDOW, Math.max(Math.max(0.04, C[i] - CHROMA_WINDOW), next.c + (random() - 0.5) * 0.03));
      next.h = Math.min(HUES[i] + HUE_WINDOW, Math.max(HUES[i] - HUE_WINDOW, next.h + (random() - 0.5) * 8));
      const col = make(next.l, next.c, next.h);
      const trial = cols.slice();
      trial[i] = col;
      const trialState = state.slice();
      trialState[i] = next;
      const s = objective(trial, trialState, name);
      if (s >= current) {
        state[i] = next;
        cols = trial;
        current = s;
      }
    }
    if (current > 0 && (!best || current > best.score)) best = { score: current, cols };
  }
  console.log(`${name}: worst pair at ${(score(best.cols) * 100).toFixed(0)}% of the target`);
  best.cols.forEach((c, i) => {
    const o = oklch(c);
    console.log(`  --person-${NAMES[i]}: oklch(${o.l.toFixed(3)} ${o.c.toFixed(3)} ${Math.round(((o.h % 360) + 360) % 360)});  /* ${formatHex(c)}, initials ${wcagContrast(t.initials, c).toFixed(2)} to 1, Lc ${lc(t.initials, c).toFixed(1)} */`);
  });
}
