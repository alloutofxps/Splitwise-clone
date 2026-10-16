import { ChevronLeft } from "lucide-react";
import { Skeleton, cn } from "./ui/primitives";

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

export function HomeSkeleton({ late }: { late?: boolean }) {
  return (
    <div aria-hidden className={cn("pt-[max(1rem,env(safe-area-inset-top))]", late && "appear-late")}>
      <div className="mb-5 flex h-10 items-center justify-between">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="size-9 rounded-full" />
      </div>
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
      <Skeleton className="mt-4 h-2 w-full rounded-full" />
      <Skeleton className="mb-3 mt-10 h-5 w-24" />
      <Rows count={3} avatar="round" />
      <Skeleton className="mb-3 mt-10 h-5 w-20" />
      <Rows count={2} />
    </div>
  );
}

export function GroupSkeleton({ late }: { late?: boolean }) {
  return (
    <div aria-hidden className={cn("pt-[max(0.5rem,env(safe-area-inset-top))]", late && "appear-late")}>
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
    <div aria-hidden className={cn("pt-[max(0.5rem,env(safe-area-inset-top))]", late && "appear-late")}>
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

export function ListSkeleton({ late, title = true }: { late?: boolean; title?: boolean }) {
  return (
    <div aria-hidden className={cn("pt-[max(1.5rem,env(safe-area-inset-top))]", late && "appear-late")}>
      {title ? <Skeleton className="mb-6 h-8 w-32" /> : null}
      <Rows count={5} avatar="round" />
    </div>
  );
}

/** The outline for whichever screen a path leads to. */
export function SkeletonFor({ pathname, late }: { pathname: string; late?: boolean }) {
  if (pathname === "/") return <HomeSkeleton late={late} />;
  if (pathname.startsWith("/groups/")) return <GroupSkeleton late={late} />;
  if (/^\/friends\/[^/]+/.test(pathname)) return <FriendSkeleton late={late} />;
  return <ListSkeleton late={late} />;
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
        {[0, 1].map((index) => (
          <Skeleton key={index} className="size-6 rounded-full" />
        ))}
        <span className="size-12 rounded-full bg-brand shadow-float" />
        {[2, 3].map((index) => (
          <Skeleton key={index} className="size-6 rounded-full" />
        ))}
      </div>
    </div>
  );
}
