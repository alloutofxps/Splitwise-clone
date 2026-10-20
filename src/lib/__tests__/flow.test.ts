import { describe, expect, it } from "vitest";
import { barSegments, diffEdges, edgePath, placeLabels, pointOnEdge, ringPositions, strokeFor } from "../flow";

describe("ringPositions", () => {
  it("puts one person in the middle", () => {
    expect(ringPositions(["a"], 200, 30).get("a")).toEqual({ x: 100, y: 100 });
  });

  it("puts two people side by side", () => {
    const at = ringPositions(["a", "b"], 200, 30);
    expect(at.get("a")).toEqual({ x: 30, y: 100 });
    expect(at.get("b")).toEqual({ x: 170, y: 100 });
  });

  it("starts at the top and keeps everyone inside the padding", () => {
    const at = ringPositions(["a", "b", "c", "d", "e"], 300, 40);
    expect(at.get("a")).toEqual({ x: 150, y: 40 });
    for (const point of at.values()) {
      expect(point.x).toBeGreaterThanOrEqual(40);
      expect(point.x).toBeLessThanOrEqual(260);
      expect(point.y).toBeGreaterThanOrEqual(40);
      expect(point.y).toBeLessThanOrEqual(260);
    }
  });
});

describe("edgePath", () => {
  it("starts and ends outside the dots", () => {
    const { d, end } = edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 20);
    expect(d.startsWith("M 20 0 Q")).toBe(true);
    expect(end).toEqual({ x: 80, y: 0 });
  });

  it("bows the two directions between a pair to opposite sides", () => {
    const there = edgePath({ x: 0, y: 0 }, { x: 100, y: 0 }, 10).mid;
    const back = edgePath({ x: 100, y: 0 }, { x: 0, y: 0 }, 10).mid;
    expect(Math.sign(there.y)).toBe(-Math.sign(back.y));
  });
});

describe("pointOnEdge", () => {
  it("finds the same middle as edgePath", () => {
    const from = { x: 20, y: 40 };
    const to = { x: 180, y: 120 };
    expect(pointOnEdge(from, to, 12, 0.5)).toEqual(edgePath(from, to, 12).mid);
  });
});

describe("placeLabels", () => {
  const overlap = (a: { x: number; y: number }, b: { x: number; y: number }, width: number) =>
    Math.abs(a.x - b.x) < width && Math.abs(a.y - b.y) < 20;

  it("keeps a lone label in the middle of its line", () => {
    const from = { x: 0, y: 100 };
    const to = { x: 200, y: 100 };
    expect(placeLabels([{ from, to, width: 60 }], 12)).toEqual([edgePath(from, to, 12).mid]);
  });

  it("slides a label along its line when two lines cross at their middles", () => {
    const across = { from: { x: 0, y: 100 }, to: { x: 200, y: 100 }, width: 60 };
    const down = { from: { x: 100, y: 0 }, to: { x: 100, y: 200 }, width: 60 };
    // At their middles the two labels would cover each other.
    expect(overlap(edgePath(across.from, across.to, 12).mid, edgePath(down.from, down.to, 12).mid, 60)).toBe(true);
    const [first, second] = placeLabels([across, down], 12);
    expect(overlap(first, second, 60)).toBe(false);
    // Each stays on its own line: near y 100 across, near x 100 down.
    expect(Math.abs(first.y - 100)).toBeLessThan(40);
    expect(Math.abs(second.x - 100)).toBeLessThan(40);
  });

  it("moves whichever label can get clear, when one line is too short", () => {
    // The four-person map: Sam pays you (down the middle), Ravi pays Ana
    // (across it). Across has no clear spot; down does.
    const sam = { x: 160, y: 252 };
    const you = { x: 160, y: 68 };
    const ravi = { x: 252, y: 160 };
    const ana = { x: 68, y: 160 };
    const [down, across] = placeLabels(
      [
        { from: sam, to: you, width: 54 },
        { from: ravi, to: ana, width: 54 },
      ],
      22,
    );
    expect(overlap(down, across, 54 + 8)).toBe(false);
  });
});

describe("strokeFor", () => {
  it("scales between a hairline and a firm stroke", () => {
    expect(strokeFor(100n, 100n)).toBe(5);
    expect(strokeFor(0n, 100n)).toBe(1.5);
    const quarter = strokeFor(25n, 100n);
    expect(quarter).toBeGreaterThan(1.5);
    expect(quarter).toBeLessThan(5);
  });
});

describe("diffEdges", () => {
  it("says which lines stay, appear and go", () => {
    const tangle = [
      { fromPersonId: "a", toPersonId: "b", amount: 10n },
      { fromPersonId: "b", toPersonId: "c", amount: 10n },
      { fromPersonId: "a", toPersonId: "c", amount: 5n },
    ];
    const simple = [{ fromPersonId: "a", toPersonId: "c", amount: 15n }];
    expect(diffEdges(tangle, simple)).toEqual({ kept: ["a>c"], added: [], removed: ["a>b", "b>c"] });
  });
});

describe("barSegments", () => {
  it("puts people who owe you first, largest first, then people you owe", () => {
    const segments = barSegments([
      { personId: "small", amount: 100n },
      { personId: "owe", amount: -500n },
      { personId: "big", amount: 900n },
    ]);
    expect(segments.map((s) => s.personId)).toEqual(["big", "small", "owe"]);
  });

  it("fills the whole bar and keeps tiny amounts visible", () => {
    const segments = barSegments([
      { personId: "a", amount: 200000n },
      { personId: "b", amount: 200n },
    ]);
    const sum = segments.reduce((total, s) => total + s.share, 0);
    expect(sum).toBeCloseTo(1, 3);
    expect(segments[1].share).toBeGreaterThanOrEqual(0.04);
  });

  it("leaves out people you're square with", () => {
    expect(barSegments([{ personId: "a", amount: 0n }])).toEqual([]);
  });
});
