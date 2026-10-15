import { hueVar } from "@/lib/avatar";
import type { GroupSummaryDto } from "@/lib/types";
import { cn } from "../ui/primitives";

/**
 * A group, drawn small: its emoji on a grey square, with the group's colour as
 * a little disc in the corner (DESIGN-PLAN 1.1). The emoji is the person's own
 * choice and stays; the colour is how the group shows up in charts and lines.
 */
export function GroupMark({
  group,
  className,
}: {
  group: Pick<GroupSummaryDto, "emoji" | "color">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-surface-2 text-title",
        className,
      )}
    >
      {group.emoji}
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full ring-2 ring-surface"
        style={{ background: hueVar(group.color) }}
      />
    </span>
  );
}
