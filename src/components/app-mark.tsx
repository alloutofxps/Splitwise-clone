import { cn } from "./ui/primitives";

const INK = "#141412";
const LINE = "M150 318 C 196 160, 316 352, 362 194";

/**
 * The app's mark: two people and one line between them, the same drawing as
 * the app icon. Always on ink, so it looks the same on paper and at night.
 *
 * With `draw` it is the app opening (MOTION-SPEC 4): the first person, the
 * line drawing across, the second person, then a slow breath until the first
 * screen replaces it. The steps are in globals.css, and need no script, so it
 * moves from the very first frame.
 */
export function AppMark({ className, draw }: { className?: string; draw?: boolean }) {
  if (draw) return <DrawnMark className={className} />;
  return (
    <svg viewBox="0 0 512 512" className={cn("size-8 shrink-0", className)} aria-hidden="true">
      <rect width="512" height="512" rx="114" fill={INK} />
      <path d={LINE} fill="none" stroke="#fafaf8" strokeWidth="30" strokeLinecap="round" />
      <circle cx="146" cy="330" r="58" fill="#60b2f5" />
      <circle cx="366" cy="182" r="58" fill="#f0898a" />
    </svg>
  );
}

/*
 * The opening plays while the app is still starting, when the page is at its
 * busiest: reading its scripts and building the first screen take 100 to
 * 170ms at a time on a mid-range phone. So every moving part is its own layer
 * that moves only by transform and opacity, which the browser runs on its
 * own, apart from the page (MOTION-SPEC 8). A line drawn by its dash, or a
 * circle inside one SVG, would wait for the page and stop.
 *
 * The line is whole from the start, under an ink cover that slides off it to
 * the right. The line runs left to right all the way, so the cover uncovers
 * it in the order it is drawn, and the people sit on top of both.
 * Positions are the icon's own, in its 512-unit square.
 */
function DrawnMark({ className }: { className?: string }) {
  return (
    <span
      className={cn("mark-draw relative block size-8 shrink-0 overflow-hidden rounded-[22.27%]", className)}
      style={{ background: INK }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 512 512" className="absolute inset-0 size-full">
        <path d={LINE} fill="none" stroke="#fafaf8" strokeWidth="30" strokeLinecap="round" />
      </svg>
      {/* From x 135, the line's left end, to past its right end at 377. */}
      <span className="mark-cover absolute inset-y-[25%] left-[26.37%] right-0" style={{ background: INK }} />
      <Person className="left-[17.19%] top-[53.13%]" colour="#60b2f5" />
      <Person className="left-[60.16%] top-[24.22%]" colour="#f0898a" />
    </span>
  );
}

/*
 * A person: the outer layer pops in, the inner one breathes. One transform
 * animation each, because Chrome leaves an element with two of them to the
 * page, where it waits whenever the page is busy.
 */
function Person({ className, colour }: { className: string; colour: string }) {
  return (
    <span className={cn("mark-person absolute size-[22.66%]", className)}>
      <span className="mark-breath block size-full rounded-full" style={{ background: colour }} />
    </span>
  );
}
