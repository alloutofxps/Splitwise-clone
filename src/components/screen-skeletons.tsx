import { ChevronLeft } from "lucide-react";
import { AppMark } from "./app-mark";
import { Skeleton, cn } from "./ui/primitives";
import { Standing, type StandingData } from "./home-standing";

/**
 * Still outlines shaped like the screen that's coming (MOTION-SPEC 1).
 *
 * The app used to show three different loading layouts in a row on the way
 * into a group - a generic one, the same with a tab bar, then the group's own -
 * and none looked like the group. Each screen now has one outline, drawn to
 * its real proportions, used both when the app opens on that screen and when
 * you move to it; the content then fades in over it without anything jumping.
 *
 * `late` holds the outline back for 300ms, for screens reached from inside the
 * app: most arrive before that, and should never flash an outline first.
 *
 * `opening` is the app opening on Home: the real logo sits where it will be,
 * drawing itself while the first screen loads.
 */

function Rows({ count, avatar = "square" }: { count: number; avatar?: "square" | "round" }) {
  return (
    <div className="divide-y divide-line overflow-hidden rounded-[var(--radius-lg)] border border-line bg-surface shadow-card">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className={cn("size-10 shrink-0", avatar === "round" ? "rounded-full" : "rounded-[var(--radius-md)]")} />
          <span className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </span>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

/**
 * The app opening for someone who hasn't got an account yet: the welcome
 * screen's shape rather than Home's, in the welcome's own frame, with the
 * logo drawing itself where the welcome's logo will be. A newcomer used to see
 * Home's lists and tab bar first, then the welcome replacing them.
 */
export function WelcomeSkeleton() {
  return (
    <div
      aria-hidden
      className="relative mx-auto flex min-h-[100dvh] w-full max-w-[440px] flex-col px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,var(--top-safe))]"
    >
      <div className="flex flex-1 flex-col justify-center py-4">
        <span className="mb-2 flex items-center gap-2">
          <AppMark draw />
          <span className="text-title-lg font-semibold tracking-[-0.03em] text-text">Divvy</span>
        </span>
        {/* Where the drawing of the four friends goes: left empty, not outlined. */}
        <div className="mx-auto -my-2 aspect-square w-full max-w-[360px]" />
        <Skeleton className="mt-2 h-10 w-4/5" />
        <Skeleton className="mt-4 h-5 w-full" />
        <Skeleton className="mt-2 h-5 w-3/5" />
        <div className="mt-5 flex flex-wrap gap-2">
          <Skeleton className="h-8 w-44 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
          <Skeleton className="h-8 w-32 rounded-full" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-[52px] w-full rounded-[var(--radius-lg)]" />
        <div className="h-11" />
      </div>
    </div>
  );
}

function HomeSkeleton({
  late,
  opening,
  standing,
}: {
  late?: boolean;
  opening?: boolean;
  standing?: StandingData;
}) {
  // Grey lines where the balance goes, unless the page brought the numbers.
  const lines = (
    <>
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-11 w-44" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-11 w-40" />
        </div>
      </div>
      <Skeleton className="mb-10 mt-4 h-2 w-full rounded-full" />
    </>
  );
  return (
    <div aria-hidden className={cn("pt-[max(1rem,var(--top-safe))]", late && "appear-late")}>
      <div className="mb-5 flex h-10 items-center justify-between">
        {opening ? (
          <span className="flex items-center gap-2 lg:invisible">
            <AppMark draw />
            <span className="text-title-lg font-semibold tracking-[-0.03em] text-text">Divvy</span>
          </span>
        ) : (
          <Skeleton className="h-7 w-24" />
        )}
        <Skeleton className="size-9 rounded-full" />
      </div>
      {/* Home's own columns, so the balance stays where Home then draws it. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start lg:gap-10">
        <div className="min-w-0 lg:order-2">
          {standing ? (
            <>
              {/* A copy of the page kept for offline use shows the lines
                  instead: its numbers are from whenever it was kept. */}
              <div className="offline-copy:hidden">
                <Standing
                  data={standing}
                  bar={(line) => (line.entries.length > 0 ? <Skeleton className="mt-3 h-2.5 w-full rounded-full" /> : null)}
                />
              </div>
              <div className="hidden offline-copy:block">{lines}</div>
            </>
          ) : (
            lines
          )}
        </div>
        <div className="min-w-0 lg:order-1">
          <Skeleton className="mb-3 h-5 w-24" />
          <Rows count={3} avatar="round" />
          <Skeleton className="mb-3 mt-10 h-5 w-20" />
          <Rows count={2} />
        </div>
      </div>
    </div>
  );
}

export function GroupSkeleton({ late }: { late?: boolean }) {
  return (
    <div aria-hidden className={cn("pt-[max(0.5rem,var(--top-safe))]", late && "appear-late")}>
      <div className="-mx-1 flex h-14 items-center gap-2">
        <span className="flex size-10 items-center justify-center text-subtle">
          <ChevronLeft className="size-6" strokeWidth={1.75} />
        </span>
        <Skeleton className="h-6 w-40" />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Skeleton className="h-8 w-28 rounded-full" />
      </div>
      <Skeleton className="mt-4 h-2 w-full rounded-full" />
      <div className="mt-4 flex items-end justify-between">
        <span className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-36" />
        </span>
        <Skeleton className="h-11 w-28 rounded-[var(--radius-md)]" />
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-[var(--radius-md)]" />
      <Skeleton className="mb-2 mt-12 h-3 w-12" />
      <Rows count={4} />
    </div>
  );
}

export function FriendSkeleton({ name, late }: { name?: string; late?: boolean }) {
  return (
    <div aria-hidden className={cn("pt-[max(0.5rem,var(--top-safe))]", late && "appear-late")}>
      <div className="-mx-1 flex h-14 items-center gap-2">
        <span className="flex size-10 items-center justify-center text-subtle">
          <ChevronLeft className="size-6" />
        </span>
        {/* The name is known before the page is: it comes from the list you
            tapped, so the header is real from the first frame. */}
        {name ? (
          <span className="truncate px-1 text-title font-semibold tracking-[-0.02em] text-text">{name}</span>
        ) : (
          <Skeleton className="h-6 w-36" />
        )}
      </div>
      <div className="mt-3 flex items-center gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <span className="flex-1 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-32" />
        </span>
      </div>
      <Skeleton className="mt-6 h-11 w-full rounded-[var(--radius-md)]" />
      <Skeleton className="mb-3 mt-10 h-5 w-24" />
      <Rows count={3} />
    </div>
  );
}

function ListSkeleton({ late, title = true }: { late?: boolean; title?: boolean }) {
  return (
    <div aria-hidden className={cn("pt-[max(1.5rem,var(--top-safe))]", late && "appear-late")}>
      {title ? <Skeleton className="mb-6 h-8 w-32" /> : null}
      <Rows count={5} avatar="round" />
    </div>
  );
}

/** The outline for whichever screen a path leads to. */
export function SkeletonFor({
  pathname,
  late,
  opening,
  standing,
}: {
  pathname: string;
  late?: boolean;
  opening?: boolean;
  /** Home's numbers, when the page arrived with them. */
  standing?: StandingData;
}) {
  if (pathname === "/") return <HomeSkeleton late={late} opening={opening} standing={standing} />;
  if (pathname.startsWith("/groups/")) return <GroupSkeleton late={late} />;
  if (/^\/friends\/[^/]+/.test(pathname)) return <FriendSkeleton late={late} />;
  return <ListSkeleton late={late} />;
}

/**
 * The sidebar's outline on a computer, for while the app opens: the screen
 * beside it starts where it will stay, rather than 260px to the left.
 */
export function SidebarFrame() {
  return (
    <div
      aria-hidden
      className="sticky top-0 hidden h-[100dvh] w-[260px] shrink-0 flex-col border-r border-line bg-surface px-4 py-6 lg:flex"
    >
      <Skeleton className="mb-7 ml-2 h-7 w-24" />
      <span className="mb-6 h-11 rounded-[var(--radius-md)] bg-brand" />
      <div className="space-y-3 px-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-5 w-28" />
        ))}
      </div>
    </div>
  );
}

/**
 * The tab bar's outline, for while the app opens: the frame is there from
 * the first frame, so the real bar arrives in place instead of popping in.
 */
export function TabBarFrame() {
  return (
    <div
      aria-hidden
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised shadow-bar pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <div className="mx-auto flex h-16 max-w-[560px] items-center justify-around px-1.5">
        {/* A step above the bar, not the usual placeholder grey: at Night
            that is the bar's own colour, and the dots vanished. */}
        {[0, 1].map((index) => (
          <span key={index} className="size-6 rounded-full bg-surface-3" />
        ))}
        <span className="size-12 rounded-full bg-brand shadow-float" />
        {[2, 3].map((index) => (
          <span key={index} className="size-6 rounded-full bg-surface-3" />
        ))}
      </div>
    </div>
  );
}
