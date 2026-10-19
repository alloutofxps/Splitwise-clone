import { cn } from "./ui/primitives";

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
  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("size-8 shrink-0", draw && "mark-draw", className)}
      aria-hidden="true"
    >
      <rect width="512" height="512" rx="114" fill="#141412" />
      <path
        d="M150 318 C 196 160, 316 352, 362 194"
        fill="none"
        stroke="#fafaf8"
        strokeWidth="30"
        strokeLinecap="round"
        {...(draw ? { pathLength: 1, strokeDasharray: "1 1" } : {})}
      />
      <circle cx="146" cy="330" r="58" fill="#60b2f5" />
      <circle cx="366" cy="182" r="58" fill="#f0898a" />
    </svg>
  );
}
