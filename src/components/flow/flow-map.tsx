"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { edgeKey, edgePath, placeLabels, ringPositions, strokeFor, type FlowEdge, type Point } from "@/lib/flow";
import { formatMoney } from "@/lib/money";
import { initials } from "@/lib/avatar";
import type { PersonDto } from "@/lib/types";
import { usePersonHue } from "../ui/avatar";
import { cn } from "../ui/primitives";
import { DURATION, EASE_ENTER, EASE_STANDARD } from "../ui/motion";
import { untilClear, useStage } from "../ui/stage";

const DOT = 18;
/**
 * The width of an amount's pill at 11.5px, plus padding: figures about 6.8px,
 * commas and points 2.2px, letters and symbols about 8px (measured). A flat 7px
 * a character made long amounts' pills wider than their text, so they met.
 */
const labelWidthFor = (label: string) => {
  let width = 12;
  for (const char of label) width += /\d/.test(char) ? 6.8 : /[.,]/.test(char) ? 2.2 : char === " " ? 3 : 8;
  return Math.round(width);
};

/** A name's width at 12px, erring wide, to keep it inside the drawing. */
const nameWidthFor = (name: string) => name.length * 7;

/**
 * Where a person's first name goes: outside the ring, away from the lines,
 * which all run inwards; under the dot for someone alone in the middle, or
 * whose name would run past the edge of the drawing (and out of its card).
 */
function nameSpot(person: PersonDto, at: Point, size: number, isMe: boolean) {
  const centre = size / 2;
  const first = isMe ? "You" : person.displayName.split(" ")[0];
  const text = first.length > 10 ? `${first.slice(0, 9)}…` : first;
  const width = nameWidthFor(text);
  const dx = at.x - centre;
  const dy = at.y - centre;
  const away = Math.hypot(dx, dy);
  const ux = away < 1 ? 0 : dx / away;
  const uy = away < 1 ? 1 : dy / away;
  let x = at.x + ux * (DOT + 12);
  let y = at.y + uy * (DOT + 12) + 4;
  let anchor: "start" | "end" | "middle" = ux > 0.35 ? "start" : ux < -0.35 ? "end" : "middle";
  if ((anchor === "start" && x + width > size - 2) || (anchor === "end" && x - width < 2)) {
    anchor = "middle";
    y = at.y + DOT + 16;
  }
  if (anchor === "middle") x = Math.min(Math.max(x, width / 2 + 2), size - width / 2 - 2);
  // The box it takes up, by its middle, for keeping amounts off it.
  const middle = anchor === "start" ? x + width / 2 : anchor === "end" ? x - width / 2 : x;
  return { x, y, anchor, text, box: { x: middle, y: y - 4, width, height: 14 } };
}

/** A payment travelling along its line (MOTION-SPEC, money). */
export const TRAVEL_MS = 700;
/**
 * The money speeds up away from the payer and is still moving when it reaches
 * the payee, so the ring there reads as it landing. A curve that slows to a
 * stop spent its last quarter covering a few pixels, and the dot looked stuck.
 */
const TRAVEL_EASE = [0.4, 0, 0.7, 0.6] as const;
/** The receiver's ring, once the money has arrived. */
const RING_MS = 400;
/**
 * The "paid" moment, when a payment clears a debt: a jade disc pops over the
 * payee with a little overshoot, a tick draws across it, six sparks fly out,
 * and after a moment it all fades. About 1.2s, and never in the way of a tap.
 */
const PAID_MS = 1170;
const PAID_FADE_MS = 250;
const SPARKS = 6;

/** A payment to show moving along its line. */
export interface Travel {
  fromPersonId: string;
  toPersonId: string;
  /** What was paid, to size the line it travels along. */
  amount: bigint;
  /** The payment cleared everything between the two, so the line is gone. */
  cleared: boolean;
  /** Change it to play the same payment again. */
  nonce: number;
}

/**
 * The flow map: people round a ring, debts as lines between them, each line in
 * the colour of the person who pays (DESIGN-PLAN Part 2).
 *
 * Lines are keyed by who pays whom, so when the set changes - switching
 * Simplify on, recording a payment - the lines that survive stay put, the rest
 * draw themselves out and the new ones draw in. That is the untangle. A payment
 * can also be shown travelling: a dot runs along the line from payer to payee.
 *
 * The drawing is decoration over a plain list, which screen readers get
 * instead.
 */
export function FlowMap({
  people,
  edges,
  currency,
  meId,
  travel,
  onTravelled,
  size = 320,
  className,
  labels = true,
}: {
  /** Amount labels on the lines. Off for the welcome screen's demonstration. */
  labels?: boolean;
  /** Everyone who could appear, in a stable order, so nobody moves on a re-draw. */
  people: PersonDto[];
  edges: FlowEdge[];
  currency: string;
  meId: string;
  /** A payment to show moving. Change `nonce` to play it again. */
  travel?: Travel | null;
  /** Called once the payment has finished playing. */
  onTravelled?: () => void;
  size?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const positions = React.useMemo(
    () => ringPositions(people.map((person) => person.id), size, DOT + 50),
    [people, size],
  );
  const byId = React.useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const largest = edges.reduce((max, edge) => (edge.amount > max ? edge.amount : max), 0n);
  // Each amount sits at the middle of its line unless that would cover another
  // amount; then it slides along its own line until it is clear.
  const labelSpots = React.useMemo(() => {
    const drawn = edges.flatMap((edge) => {
      const from = positions.get(edge.fromPersonId);
      const to = positions.get(edge.toPersonId);
      return from && to ? [{ key: edgeKey(edge), from, to, width: labelWidthFor(formatMoney(edge.amount, currency)) }] : [];
    });
    // Clear of people's dots and names and inside the drawing, as well as of
    // each other.
    const names = people.flatMap((person) => {
      const at = positions.get(person.id);
      return at ? [nameSpot(person, at, size, person.id === meId).box] : [];
    });
    const spots = placeLabels(drawn, DOT + 4, { size, dots: [...positions.values()], dotRadius: DOT, blocks: names });
    return new Map(drawn.map((line, index) => [line.key, spots[index]]));
  }, [edges, positions, currency, size, people, meId]);
  const nameOf = (id: string) => (id === meId ? "You" : (byId.get(id)?.displayName ?? "Someone"));

  return (
    <figure className={cn("relative", className)}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="mx-auto block w-full max-w-[360px] overflow-visible"
        aria-hidden="true"
      >
        <AnimatePresence initial={false}>
          {edges.map((edge) => {
            const from = positions.get(edge.fromPersonId);
            const to = positions.get(edge.toPersonId);
            const payer = byId.get(edge.fromPersonId);
            if (!from || !to || !payer) return null;
            return (
              <EdgeLine
                key={edgeKey(edge)}
                payer={payer}
                from={from}
                to={to}
                width={strokeFor(edge.amount, largest)}
                reduce={Boolean(reduce)}
              />
            );
          })}
        </AnimatePresence>

        {/* Every amount over every line, so no line is drawn across an amount. */}
        {labels ? (
          <AnimatePresence initial={false}>
            {edges.map((edge) => {
              const spot = labelSpots.get(edgeKey(edge));
              return spot ? (
                <EdgeLabel key={edgeKey(edge)} label={formatMoney(edge.amount, currency)} at={spot} reduce={Boolean(reduce)} />
              ) : null;
            })}
          </AnimatePresence>
        ) : null}

        {people.map((person) => {
          const at = positions.get(person.id);
          return at ? (
            <PersonNode key={person.id} person={person} at={at} centre={size / 2} isMe={person.id === meId} />
          ) : null;
        })}

        {/* Over the people, so the ring and the tick land on top of the payee. */}
        {travel ? (
          <Traveller
            key={travel.nonce}
            from={positions.get(travel.fromPersonId)}
            to={positions.get(travel.toPersonId)}
            payer={byId.get(travel.fromPersonId)}
            width={strokeFor(travel.amount, largest > travel.amount ? largest : travel.amount)}
            cleared={travel.cleared}
            reduce={Boolean(reduce)}
            onDone={onTravelled}
          />
        ) : null}
      </svg>

      <figcaption className="sr-only">
        {edges.length === 0 ? (
          "Nobody owes anybody."
        ) : (
          <ul>
            {edges.map((edge) => (
              <li key={edgeKey(edge)}>
                {nameOf(edge.fromPersonId)} {edge.fromPersonId === meId ? "pay" : "pays"}{" "}
                {edge.toPersonId === meId ? "you" : nameOf(edge.toPersonId)} {formatMoney(edge.amount, currency)}
              </li>
            ))}
          </ul>
        )}
      </figcaption>
    </figure>
  );
}

function EdgeLine({
  payer,
  from,
  to,
  width,
  reduce,
}: {
  payer: PersonDto;
  from: Point;
  to: Point;
  width: number;
  reduce: boolean;
}) {
  const hue = usePersonHue(payer);
  const { d, end, angle } = edgePath(from, to, DOT + 4);
  const draw = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, exit: { pathLength: 0, opacity: 0 } };

  return (
    <motion.g>
      <motion.path
        d={d}
        fill="none"
        stroke={hue}
        strokeWidth={width}
        strokeLinecap="round"
        {...draw}
        // A line changing in place (Simplify, a payment): it lands like a new row.
        transition={{ duration: DURATION.arrive, ease: EASE_STANDARD }}
      />
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.fade, ease: EASE_STANDARD, delay: reduce ? 0 : 0.18 }}
      >
        {/* Arrowhead at the payee's end. */}
        <path
          d="M -7 -4.5 L 0 0 L -7 4.5"
          fill="none"
          stroke={hue}
          strokeWidth={Math.max(1.75, width * 0.6)}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={`translate(${end.x} ${end.y}) rotate(${angle})`}
        />
      </motion.g>
    </motion.g>
  );
}

/**
 * One amount on its line. Drawn in a layer above all the lines, so none is
 * drawn across it; it fades in a moment after its line draws, as before.
 */
function EdgeLabel({ label, at, reduce }: { label: string; at: Point; reduce: boolean }) {
  const width = labelWidthFor(label);
  return (
    <motion.g
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.fade, ease: EASE_STANDARD, delay: reduce ? 0 : 0.18 }}
    >
      <rect x={at.x - width / 2} y={at.y - 10} width={width} height={20} rx={10} fill="var(--surface)" stroke="var(--border)" />
      <text x={at.x} y={at.y + 4} textAnchor="middle" className="tabular" fill="var(--text)" fontSize={11.5} fontWeight={500}>
        {label}
      </text>
    </motion.g>
  );
}

function PersonNode({
  person,
  at,
  centre,
  isMe,
}: {
  person: PersonDto;
  at: Point;
  centre: number;
  isMe: boolean;
}) {
  const hue = usePersonHue(person);
  const name = nameSpot(person, at, centre * 2, isMe);
  return (
    <g>
      <circle
        cx={at.x}
        cy={at.y}
        r={DOT}
        fill={person.isGhost ? "var(--surface)" : hue}
        stroke={person.isGhost ? hue : "var(--surface)"}
        strokeWidth={person.isGhost ? 1.5 : 2}
      />
      <text
        x={at.x}
        y={at.y + 4.5}
        textAnchor="middle"
        fontSize={12.5}
        fontWeight={600}
        fill={person.isGhost ? hue : "var(--on-person)"}
      >
        {person.avatarEmoji ?? initials(person.displayName)}
      </text>
      <text x={name.x} y={name.y} textAnchor={name.anchor} fontSize={12} fill="var(--text-muted)">
        {name.text}
      </text>
    </g>
  );
}

/**
 * A payment on its way.
 *
 * Waits for the panel it was saved in to leave, then a dot carries the money
 * from payer to payee along the line, which shortens behind it: the debt
 * shrinking by what was paid. On arrival the payee's circle sends out one ring,
 * and if the payment cleared the line entirely, the paid moment plays over them.
 * The balances count while the ring plays (the stage's beat is set to the travel
 * time).
 *
 * Every part is handed to the browser as one animation when it starts, rather
 * than worked out by our code on each frame: the path is sampled once, and
 * the dot plays those points as keyframes. On a slow phone the per-frame
 * version was a large share of what made this moment stutter.
 */
function Traveller({
  from,
  to,
  payer,
  width,
  cleared,
  reduce,
  onDone,
}: {
  from?: Point;
  to?: Point;
  payer?: PersonDto;
  width: number;
  cleared: boolean;
  reduce: boolean;
  onDone?: () => void;
}) {
  const hue = usePersonHue(payer ?? { avatarColor: "cobalt" });
  const stage = useStage();
  const pathRef = React.useRef<SVGPathElement>(null);
  const dotRef = React.useRef<SVGGElement>(null);
  const ringRef = React.useRef<SVGCircleElement>(null);
  const paidRef = React.useRef<SVGGElement>(null);
  const [phase, setPhase] = React.useState<"waiting" | "travelling" | "arrived">("waiting");
  const done = React.useRef(onDone);
  React.useEffect(() => {
    done.current = onDone;
  });

  // Start once the panel has gone.
  const placed = Boolean(from && to);
  React.useEffect(() => {
    if (phase !== "waiting" || stage.covered) return;
    if (reduce || !placed) {
      done.current?.();
      return;
    }
    const timer = window.setTimeout(() => setPhase("travelling"), untilClear(stage));
    return () => window.clearTimeout(timer);
  }, [phase, stage, reduce, placed]);

  // The journey. Depends on nothing but having started: the saved payment
  // comes back from the server mid-way and redraws the map, and that must not
  // stop it.
  React.useEffect(() => {
    if (phase !== "travelling") return;
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) {
      setPhase("arrived");
      return;
    }
    const length = path.getTotalLength();
    const points = Array.from({ length: 25 }, (_, index) => path.getPointAtLength((length * index) / 24));
    const timing: KeyframeAnimationOptions = {
      duration: TRAVEL_MS,
      easing: `cubic-bezier(${TRAVEL_EASE.join(", ")})`,
      fill: "forwards",
    };
    const line = path.animate([{ strokeDashoffset: 0 }, { strokeDashoffset: -1 }], timing);
    const journey = dot.animate(
      points.map((point) => ({ transform: `translate(${point.x}px, ${point.y}px)` })),
      timing,
    );
    journey.onfinish = () => setPhase("arrived");
    return () => {
      line.cancel();
      journey.cancel();
    };
  }, [phase]);

  // Arrival: one ring, and the paid moment if the debt is paid off.
  React.useEffect(() => {
    if (phase !== "arrived") return;
    const animations: Animation[] = [];
    const ring = ringRef.current;
    if (ring) {
      animations.push(
        ring.animate(
          [
            { transform: "scale(1)", opacity: 0.6 },
            { transform: `scale(${(DOT + 12) / DOT})`, opacity: 0 },
          ],
          { duration: RING_MS, easing: `cubic-bezier(${EASE_ENTER.join(", ")})`, fill: "forwards" },
        ),
      );
    }
    if (cleared && paidRef.current) animations.push(...playPaid(paidRef.current));
    const timer = window.setTimeout(() => done.current?.(), cleared ? PAID_MS : RING_MS);
    return () => {
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
    };
  }, [phase, cleared]);

  if (!from || !to || !payer || reduce) return null;
  const { d } = edgePath(from, to, DOT + 4);

  return (
    <g>
      {/* The line itself: still whole while the panel leaves, then erased
          from the payer's end as the money moves along it. */}
      <path
        ref={pathRef}
        d={d}
        pathLength={1}
        strokeDasharray="1 1"
        fill="none"
        stroke={hue}
        strokeWidth={width}
        strokeLinecap="round"
        opacity={phase === "arrived" ? 0 : 1}
      />
      <g ref={dotRef} opacity={phase === "travelling" ? 1 : 0} style={{ transform: `translate(${from.x}px, ${from.y}px)` }}>
        <circle r={12} fill={hue} opacity={0.18} />
        <circle r={7} fill={hue} stroke="var(--surface)" strokeWidth={2.5} />
      </g>
      {phase === "arrived" ? (
        <circle
          ref={ringRef}
          cx={to.x}
          cy={to.y}
          r={DOT}
          fill="none"
          stroke={hue}
          strokeWidth={2}
          opacity={0}
          style={{ transformBox: "fill-box", transformOrigin: "center" }}
        />
      ) : null}
      {phase === "arrived" && cleared ? <Paid ref={paidRef} at={to} /> : null}
    </g>
  );
}

/**
 * The paid drawing, centred on the payee. Everything inside is placed around
 * (0, 0), so the pop and the sparks scale and fly from the person's centre
 * without needing a transform origin.
 */
function Paid({ ref, at }: { ref: React.Ref<SVGGElement>; at: Point }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      <g ref={ref} opacity={0}>
        {Array.from({ length: SPARKS }, (_, index) => (
          <g key={index} transform={`rotate(${(360 / SPARKS) * index + 30})`}>
            <circle
              data-spark
              r={2.5}
              fill={index % 2 === 0 ? "var(--positive)" : "var(--person-sand)"}
              opacity={0}
            />
          </g>
        ))}
        <g data-disc>
          <circle r={DOT + 2} fill="var(--positive)" stroke="var(--surface)" strokeWidth={2} />
          <path
            data-tick
            d="M -7 0.5 L -2 5.5 L 7.5 -5"
            pathLength={1}
            strokeDasharray="1 1"
            strokeDashoffset={1}
            fill="none"
            stroke="var(--text-inverse)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </g>
  );
}

/** Plays the paid drawing once, as browser animations, and returns them. */
function playPaid(root: SVGGElement): Animation[] {
  const enter = `cubic-bezier(${EASE_ENTER.join(", ")})`;
  const animations = [
    root.animate(
      [
        { opacity: 0 },
        { opacity: 1, offset: 100 / PAID_MS },
        { opacity: 1, offset: 1 - PAID_FADE_MS / PAID_MS },
        { opacity: 0 },
      ],
      { duration: PAID_MS, fill: "forwards" },
    ),
  ];
  const disc = root.querySelector<SVGGElement>("[data-disc]");
  if (disc) {
    animations.push(
      disc.animate(
        [
          { transform: "scale(0.5)", easing: enter },
          { transform: "scale(1.12)", offset: 0.65, easing: "cubic-bezier(0.2, 0, 0, 1)" },
          { transform: "scale(1)" },
        ],
        { duration: 400, fill: "both" },
      ),
    );
  }
  const tick = root.querySelector<SVGPathElement>("[data-tick]");
  if (tick) {
    animations.push(
      tick.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: 300,
        delay: 180,
        easing: enter,
        fill: "both",
      }),
    );
  }
  // Eased in two halves, not as a whole: eased as a whole, a spark was at full
  // strength for 11ms and spent the rest fading, which read as grey dots at
  // Night. Now it bursts out bright, then drifts, shrinks and fades.
  root.querySelectorAll<SVGCircleElement>("[data-spark]").forEach((spark, index) => {
    animations.push(
      spark.animate(
        [
          { transform: `translateY(-${DOT + 4}px) scale(1)`, opacity: 0, easing: enter },
          { transform: `translateY(-${DOT + 12}px) scale(1)`, opacity: 1, offset: 0.5, easing: "cubic-bezier(0.4, 0, 1, 1)" },
          { transform: `translateY(-${DOT + 16}px) scale(0.4)`, opacity: 0 },
        ],
        { duration: 520, delay: 220 + (index % 2) * 50, fill: "both" },
      ),
    );
  });
  return animations;
}
