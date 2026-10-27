/**
 * Geometry for the flow drawings: the flow bar (who makes up a balance) and the
 * flow map (who owes whom, as lines between people). Kept free of React so the
 * arithmetic can be tested on its own; the components only draw what this
 * returns.
 */

export interface FlowEdge {
  fromPersonId: string;
  toPersonId: string;
  /** Minor units, always positive: `from` owes `to` this much. */
  amount: bigint;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * People spaced evenly round a circle, the first at the top, going clockwise.
 * One person sits in the middle; two face each other across it.
 */
export function ringPositions(ids: string[], size: number, padding: number): Map<string, Point> {
  const centre = size / 2;
  const radius = Math.max(0, centre - padding);
  const result = new Map<string, Point>();
  if (ids.length === 1) {
    result.set(ids[0], { x: centre, y: centre });
    return result;
  }
  ids.forEach((id, index) => {
    // Two people side by side read better than one above the other.
    const start = ids.length === 2 ? Math.PI : -Math.PI / 2;
    const angle = start + (index / ids.length) * Math.PI * 2;
    result.set(id, {
      x: round(centre + radius * Math.cos(angle)),
      y: round(centre + radius * Math.sin(angle)),
    });
  });
  return result;
}

/**
 * The curve for one debt, as an SVG path from just outside the payer's dot to
 * just outside the payee's, bowed to one side so a debt each way between the
 * same two people draws as two separate arcs instead of one line over another.
 *
 * Also returns the curve's midpoint, where the amount label goes.
 */
export function edgePath(
  from: Point,
  to: Point,
  inset: number,
  bend = 0.18,
): { d: string; mid: Point; end: Point; angle: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;

  const start = { x: from.x + ux * inset, y: from.y + uy * inset };
  const end = { x: to.x - ux * inset, y: to.y - uy * inset };

  // Always bow to the left of the direction of travel: A→B and B→A then sit on
  // opposite sides of the straight line between them.
  const offset = length * bend;
  const control = {
    x: (start.x + end.x) / 2 - uy * offset,
    y: (start.y + end.y) / 2 + ux * offset,
  };

  // The point at t = 0.5 on a quadratic Bézier.
  const mid = {
    x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
  };

  // Direction at the end of the curve, for the arrowhead.
  const angle = (Math.atan2(end.y - control.y, end.x - control.x) * 180) / Math.PI;

  return {
    d: `M ${round(start.x)} ${round(start.y)} Q ${round(control.x)} ${round(control.y)} ${round(end.x)} ${round(end.y)}`,
    mid: { x: round(mid.x), y: round(mid.y) },
    end: { x: round(end.x), y: round(end.y) },
    angle: round(angle),
  };
}

/** The point `t` of the way (0 to 1) along the curve that `edgePath` draws. */
export function pointOnEdge(from: Point, to: Point, inset: number, t: number, bend = 0.18): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const start = { x: from.x + ux * inset, y: from.y + uy * inset };
  const end = { x: to.x - ux * inset, y: to.y - uy * inset };
  const offset = length * bend;
  const control = { x: (start.x + end.x) / 2 - uy * offset, y: (start.y + end.y) / 2 + ux * offset };
  const a = (1 - t) * (1 - t);
  const b = 2 * (1 - t) * t;
  const c = t * t;
  return {
    x: round(a * start.x + b * control.x + c * end.x),
    y: round(a * start.y + b * control.y + c * end.y),
  };
}

/** How far along its line a label may slide to get clear, nearest first. */
const LABEL_STOPS = [0.5, ...[0.04, 0.08, 0.12, 0.16, 0.2, 0.24, 0.28, 0.32, 0.36].flatMap((step) => [0.5 - step, 0.5 + step])];

/** What a label must keep clear of, besides the other labels. */
export interface LabelSurroundings {
  /** The drawing's width and height: a label stays inside it. */
  size?: number;
  /** People's dots, which a label must not cover. */
  dots?: Point[];
  dotRadius?: number;
  /** Other things to keep clear of, such as names: centre, width and height. */
  blocks?: { x: number; y: number; width: number; height: number }[];
}

/**
 * Where each line's amount label goes.
 *
 * Every label starts at the middle of its line. Then, in a few passes, each
 * label tries the spots along its own line, nearest the middle first, and
 * takes the one that costs least: on top of another label, a person's dot
 * or a name costs most, then running out of the drawing, then lying over somebody
 * else's line (it would hide that line), and last, distance from the middle.
 * When every spot on its line is taken, it may sit just beside the line.
 * Either label of a pair may be the one that moves: a short line often has
 * nowhere to go, while the line crossing it does. With many people the best
 * spot can still touch something; it is then the least bad one, and kept
 * inside the drawing.
 */
export function placeLabels(
  lines: { from: Point; to: Point; width: number }[],
  inset: number,
  surroundings: LabelSurroundings = {},
  height = 20,
  gap = 4,
): Point[] {
  const { size, dots = [], dotRadius = 18, blocks = [] } = surroundings;
  const spots = lines.map(({ from, to }) => pointOnEdge(from, to, inset, 0.5));
  // Points along every line, to tell whether a label would lie over one.
  const traces = lines.map(({ from, to }) =>
    Array.from({ length: 25 }, (_, step) => pointOnEdge(from, to, inset, step / 24)),
  );

  const cost = (index: number, at: Point, t: number) => {
    const half = lines[index].width / 2;
    let total = Math.abs(t - 0.5) * 10;
    lines.forEach((other, otherIndex) => {
      if (otherIndex === index) return;
      const there = spots[otherIndex];
      if (Math.abs(at.x - there.x) * 2 < lines[index].width + other.width + gap * 2 && Math.abs(at.y - there.y) < height + gap) {
        total += 1000;
      }
      for (const point of traces[otherIndex]) {
        if (Math.abs(point.x - at.x) < half + 2 && Math.abs(point.y - at.y) < height / 2 + 2) {
          total += 40;
          break;
        }
      }
    });
    for (const dot of dots) {
      const nearestX = Math.max(at.x - half, Math.min(dot.x, at.x + half));
      const nearestY = Math.max(at.y - height / 2, Math.min(dot.y, at.y + height / 2));
      if (Math.hypot(dot.x - nearestX, dot.y - nearestY) < dotRadius + 2) total += 500;
    }
    for (const block of blocks) {
      if (Math.abs(block.x - at.x) * 2 < block.width + lines[index].width + gap && Math.abs(block.y - at.y) * 2 < block.height + height + gap) {
        total += 500;
      }
    }
    if (size !== undefined) {
      const spill =
        Math.max(0, half - at.x) + Math.max(0, at.x + half - size) + Math.max(0, height / 2 - at.y) + Math.max(0, at.y + height / 2 - size);
      total += spill * 10;
    }
    return total;
  };

  const along = spots.map(() => 0.5);
  const beside = spots.map(() => false);
  const best = spots.map((spot, index) => cost(index, spot, 0.5));
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    lines.forEach(({ from, to }, index) => {
      best[index] = cost(index, spots[index], along[index]) + (beside[index] ? 60 : 0);
      // Beside its line, just clear of it, is the fallback when every spot on
      // it is taken: it costs more than lying over one other line.
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const normal = { x: -(to.y - from.y) / length, y: (to.x - from.x) / length };
      for (const t of LABEL_STOPS) {
        const onLine = pointOnEdge(from, to, inset, t);
        for (const side of [0, 1, -1]) {
          const candidate = { x: onLine.x + normal.x * side * (height / 2 + 6), y: onLine.y + normal.y * side * (height / 2 + 6) };
          const price = cost(index, candidate, t) + (side === 0 ? 0 : 60);
          if (price < best[index] - 0.01) {
            spots[index] = candidate;
            along[index] = t;
            beside[index] = side !== 0;
            best[index] = price;
            moved = true;
          }
        }
      }
    });
    if (!moved) break;
  }

  // Inside the drawing whatever else happened.
  return spots.map(({ x, y }, index) => {
    if (size === undefined) return { x, y };
    const half = lines[index].width / 2;
    return {
      x: Math.min(Math.max(x, half + 1), size - half - 1),
      y: Math.min(Math.max(y, height / 2 + 1), size - height / 2 - 1),
    };
  });
}

/**
 * Line thickness for an amount, relative to the biggest on screen. Square-root
 * scaled, because a debt ten times bigger drawn ten times thicker swamps
 * everything else; between a hairline and a firm stroke.
 */
export function strokeFor(amount: bigint, largest: bigint, min = 1.5, max = 5): number {
  if (largest <= 0n || amount <= 0n) return min;
  const share = Math.sqrt(Number(amount) / Number(largest));
  return round(min + (max - min) * Math.min(1, share));
}

/** The key that identifies one debt across a re-draw. */
export function edgeKey(edge: Pick<FlowEdge, "fromPersonId" | "toPersonId">): string {
  return `${edge.fromPersonId}>${edge.toPersonId}`;
}

export interface BarSegment {
  personId: string;
  /** Positive: they owe you. Negative: you owe them. */
  amount: bigint;
  /** Share of the bar's width, 0 to 1, after the minimum is applied. */
  share: number;
}

/**
 * The flow bar's segments: one per person, sized by how much is between you,
 * people who owe you first (largest first), then people you owe.
 *
 * Every segment gets at least `minShare` of the bar, so a €2 debt beside a
 * €2,000 one is still a visible, tappable sliver. The rest is shared out in
 * proportion.
 */
export function barSegments(
  entries: { personId: string; amount: bigint }[],
  minShare = 0.04,
): BarSegment[] {
  const live = entries.filter((entry) => entry.amount !== 0n);
  if (live.length === 0) return [];
  const size = (value: bigint) => (value < 0n ? -value : value);
  const sorted = [...live].sort((a, b) => {
    if (a.amount > 0n !== b.amount > 0n) return a.amount > 0n ? -1 : 1;
    return size(b.amount) > size(a.amount) ? 1 : size(b.amount) < size(a.amount) ? -1 : 0;
  });

  const total = sorted.reduce((sum, entry) => sum + Number(size(entry.amount)), 0);
  const floor = Math.min(minShare, 1 / sorted.length);
  const spare = 1 - floor * sorted.length;
  return sorted.map((entry) => ({
    personId: entry.personId,
    amount: entry.amount,
    share: round(floor + spare * (Number(size(entry.amount)) / total), 4),
  }));
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
