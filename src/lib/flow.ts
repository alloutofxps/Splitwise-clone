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

/**
 * What changes between two sets of lines: which stay (and may change amount),
 * which appear and which go. Simplify uses this to untangle: the lines that
 * survive stay put, the rest draw out, the new ones draw in.
 */
export function diffEdges(
  before: FlowEdge[],
  after: FlowEdge[],
): { kept: string[]; added: string[]; removed: string[] } {
  const was = new Set(before.map(edgeKey));
  const now = new Set(after.map(edgeKey));
  return {
    kept: [...now].filter((key) => was.has(key)),
    added: [...now].filter((key) => !was.has(key)),
    removed: [...was].filter((key) => !now.has(key)),
  };
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
