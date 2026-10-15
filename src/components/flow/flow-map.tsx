"use client";

import * as React from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { edgeKey, edgePath, ringPositions, strokeFor, type FlowEdge, type Point } from "@/lib/flow";
import { formatMoney } from "@/lib/money";
import { initials } from "@/lib/avatar";
import type { PersonDto } from "@/lib/types";
import { usePersonHue } from "../ui/avatar";
import { cn } from "../ui/primitives";

const EASE = [0.2, 0, 0, 1] as const;
const DOT = 18;

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
  travel?: { fromPersonId: string; toPersonId: string; nonce: number } | null;
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

        {travel && !reduce ? (
          <Traveller
            key={travel.nonce}
            from={positions.get(travel.fromPersonId)}
            to={positions.get(travel.toPersonId)}
            payer={byId.get(travel.fromPersonId)}
          />
        ) : null}

        {people.map((person) => {
          const at = positions.get(person.id);
          return at ? (
            <PersonNode key={person.id} person={person} at={at} centre={size / 2} isMe={person.id === meId} />
          ) : null;
        })}
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

/** A payment on its way: a dot that runs from payer to payee, then fades. */
function Traveller({ from, to, payer }: { from?: Point; to?: Point; payer?: PersonDto }) {
  const hue = usePersonHue(payer ?? { avatarColor: "cobalt" });
  if (!from || !to || !payer) return null;
  const { d } = edgePath(from, to, DOT + 4);
  return (
    <motion.circle
      r={5}
      fill={hue}
      stroke="var(--surface)"
      strokeWidth={2}
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ delay: 0.9, duration: 0.24 }}
    >
      <animateMotion
        dur="0.9s"
        fill="freeze"
        path={d}
        keyPoints="0;1"
        keyTimes="0;1"
        calcMode="spline"
        keySplines="0.2 0 0 1"
      />
    </motion.circle>
  );
}
