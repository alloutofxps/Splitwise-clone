"use client";

import * as React from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { edgeKey, edgePath, ringPositions, strokeFor, type FlowEdge, type Point } from "@/lib/flow";
import { formatMoney } from "@/lib/money";
import { initials } from "@/lib/avatar";
import type { PersonDto } from "@/lib/types";
import { usePersonHue } from "../ui/avatar";
import { cn } from "../ui/primitives";
import { EASE_ENTER } from "../ui/motion";
import { untilClear, useStage } from "../ui/stage";

const EASE = [0.2, 0, 0, 1] as const;
const DOT = 18;

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
/** The paid tick: drawn, held, then gone. Stands in for the Rive "paid" moment. */
const TICK_MS = { draw: 350, hold: 500, fade: 250 };
const TICK_TOTAL = TICK_MS.draw + TICK_MS.hold + TICK_MS.fade;

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
                label={labels ? formatMoney(edge.amount, currency) : null}
                reduce={Boolean(reduce)}
              />
            );
          })}
        </AnimatePresence>

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
  label,
  reduce,
}: {
  payer: PersonDto;
  from: Point;
  to: Point;
  width: number;
  label: string | null;
  reduce: boolean;
}) {
  const hue = usePersonHue(payer);
  const { d, mid, end, angle } = edgePath(from, to, DOT + 4);
  const draw = reduce
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 }, exit: { pathLength: 0, opacity: 0 } };
  const labelWidth = (label?.length ?? 0) * 7 + 12;

  return (
    <motion.g>
      <motion.path
        d={d}
        fill="none"
        stroke={hue}
        strokeWidth={width}
        strokeLinecap="round"
        {...draw}
        transition={{ duration: 0.32, ease: EASE }}
      />
      <motion.g
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.24, ease: EASE, delay: reduce ? 0 : 0.18 }}
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
        {label ? (
        <>
        <rect
          x={mid.x - labelWidth / 2}
          y={mid.y - 10}
          width={labelWidth}
          height={20}
          rx={10}
          fill="var(--surface)"
          stroke="var(--border)"
        />
        <text
          x={mid.x}
          y={mid.y + 4}
          textAnchor="middle"
          className="tabular"
          fill="var(--text)"
          fontSize={11.5}
          fontWeight={500}
        >
          {label}
        </text>
        </>
        ) : null}
      </motion.g>
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
  const first = isMe ? "You" : person.displayName.split(" ")[0];
  // The name sits on the outside of the ring, away from the lines, which all
  // run inwards. Someone alone in the middle gets it underneath.
  const dx = at.x - centre;
  const dy = at.y - centre;
  const away = Math.hypot(dx, dy);
  const ux = away < 1 ? 0 : dx / away;
  const uy = away < 1 ? 1 : dy / away;
  const nameX = at.x + ux * (DOT + 12);
  const nameY = at.y + uy * (DOT + 12) + 4;
  const anchor = ux > 0.35 ? "start" : ux < -0.35 ? "end" : "middle";
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
      <text x={nameX} y={nameY} textAnchor={anchor} fontSize={12} fill="var(--text-muted)">
        {first.length > 10 ? `${first.slice(0, 9)}…` : first}
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
 * and if the payment cleared the line entirely, a tick covers them for a moment. The balances
 * count while the ring plays (the stage's beat is set to the travel time).
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
  const progress = useMotionValue(0);
  const pathRef = React.useRef<SVGPathElement>(null);
  const [phase, setPhase] = React.useState<"waiting" | "travelling" | "arrived">("waiting");
  const done = React.useRef(onDone);
  React.useEffect(() => {
    done.current = onDone;
  });

  // The erased part of the line runs from the payer's end; the dot rides the
  // front of what is left.
  const remaining = useTransform(progress, (p) => 1 - p);
  // One position per frame, shared by both coordinates: measuring a curve is
  // the costly part, and doing it twice a frame showed up on a slow phone.
  const lengthRef = React.useRef(0);
  const point = useTransform(progress, (p) => pointAt(pathRef.current, lengthRef, p) ?? from ?? { x: 0, y: 0 });
  const dotX = useTransform(point, (at) => at.x);
  const dotY = useTransform(point, (at) => at.y);

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

  // The journey itself depends on nothing but having started: the saved
  // payment comes back from the server while the dot is moving and redraws
  // the map, and that must not stop it halfway.
  React.useEffect(() => {
    if (phase !== "travelling") return;
    const controls = animate(progress, 1, {
      duration: TRAVEL_MS / 1000,
      ease: TRAVEL_EASE,
      onComplete: () => setPhase("arrived"),
    });
    return () => controls.stop();
  }, [phase, progress]);

  React.useEffect(() => {
    if (phase !== "arrived") return;
    const timer = window.setTimeout(() => done.current?.(), cleared ? TICK_TOTAL : RING_MS);
    return () => window.clearTimeout(timer);
  }, [phase, cleared]);

  if (!from || !to || !payer || reduce) return null;
  const { d } = edgePath(from, to, DOT + 4);

  return (
    <g>
      {/* The line itself: still whole while the panel leaves, then erased
          from the payer's end as the money moves along it. */}
      <motion.path
        ref={pathRef}
        d={d}
        fill="none"
        stroke={hue}
        strokeWidth={width}
        strokeLinecap="round"
        style={{ pathLength: remaining, pathOffset: progress }}
        opacity={phase === "arrived" ? 0 : 1}
      />
      {phase === "travelling" ? (
        <>
          <motion.circle cx={dotX} cy={dotY} r={12} fill={hue} opacity={0.18} />
          <motion.circle cx={dotX} cy={dotY} r={7} fill={hue} stroke="var(--surface)" strokeWidth={2.5} />
        </>
      ) : null}
      {phase === "arrived" ? (
        <motion.circle
          cx={to.x}
          cy={to.y}
          fill="none"
          stroke={hue}
          strokeWidth={2}
          initial={{ r: DOT, opacity: 0.6 }}
          animate={{ r: DOT + 12, opacity: 0 }}
          transition={{ duration: RING_MS / 1000, ease: EASE_ENTER }}
        />
      ) : null}
      {phase === "arrived" && cleared ? (
        <motion.g
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 1, 1, 0] }}
          transition={{
            duration: TICK_TOTAL / 1000,
            times: [0, TICK_MS.draw / TICK_TOTAL, 1 - TICK_MS.fade / TICK_TOTAL, 1],
            ease: EASE_ENTER,
          }}
        >
          <circle cx={to.x} cy={to.y} r={DOT + 2} fill="var(--positive)" stroke="var(--surface)" strokeWidth={2} />
          <motion.path
            d={`M ${to.x - 7} ${to.y + 0.5} L ${to.x - 2} ${to.y + 5.5} L ${to.x + 7.5} ${to.y - 5}`}
            fill="none"
            stroke="var(--text-inverse)"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: TICK_MS.draw / 1000, ease: EASE_ENTER, delay: 0.08 }}
          />
        </motion.g>
      ) : null}
    </g>
  );
}

/** The point a share of the way along a drawn path, by length. */
function pointAt(path: SVGPathElement | null, length: { current: number }, share: number): Point | null {
  if (!path) return null;
  try {
    // The line never changes shape while it plays, so its length is measured once.
    if (!length.current) length.current = path.getTotalLength();
    return path.getPointAtLength(length.current * share);
  } catch {
    return null;
  }
}
