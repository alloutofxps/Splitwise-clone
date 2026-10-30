# Divvy: notes for Claude sessions

Divvy is a Splitwise-style app: Next.js 15 (app router), React 19, TanStack
Query 5, Motion (`motion/react`, formerly framer-motion), Tailwind v4, Prisma 7
on SQLite, hosted on Railway (deploys automatically from `main`).

## Read first, in this order

1. `HANDOFF.md`, if it exists: where the last session stopped. It is a local
   working note, not committed, and is the source of truth for current state
   and what's left.
2. `MOTION-SPEC.md`: the approved motion contract. Its rules are binding:
   - "Motion explains a change, or it doesn't happen."
   - Section 5, "What never moves".
   - Section 6, Reduce Motion: every slide, scale, travel and count becomes
     a 150ms fade or the end result.
   - Section 7, download limits: Home 312 KB, a group 333 KB of scripts,
     compressed, measured with `node scripts/size-report.mjs <url>`.
   - Section 8, smoothness: under 2% of frames over 25ms with the processor
     slowed 4x (`node scripts/motion-record.mjs <url> <out> timing`).
   A change to motion that the spec doesn't describe updates the spec in the
   same PR.
3. `PERF-BASELINE.md`: the size, smoothness, Lighthouse and trace numbers
   every change is compared against, and how to measure them fairly.
4. `DESIGN-PLAN.md` (the Flow x Quiet redesign), then the audits:
   `UX-AUDIT.md`, `DESIGN-AUDIT.md`, `FEATURE-AUDIT.md`, `PRODUCTION-AUDIT.md`.

## Browsers

Divvy's styling (Tailwind 4: OKLCH colours, color-mix, registered
properties) needs Safari 16.4, Chrome 111 or Firefox 128. Older browsers see
"Divvy needs a newer browser" (a tiny check in `src/app/layout.tsx`, which
fetches `public/unsupported.js` only when needed). Don't add a
`browserslist` to save size: it was measured, and saves 0.4 KB
(POLISH-AUDIT item 26).

## Working with the person

- They are not a developer. Use plain language, no em dashes.
- Plan first and wait for their OK before changing code.
- Fix everything found, in phases. Never offer a "top N" shortlist.
- One small PR per item, with recordings or numbers as proof. Merge only
  when CI (`verify` and `image`) is green, then confirm main's run on the
  merge commit.
- Ask before installing any new package, skill or tool.

## Standing rules

- Commit as `Pratik Parashar <123747164+alloutofxps@users.noreply.github.com>`
  with a `Co-Authored-By` trailer. PR bodies end with the Claude Code line.
- Never show secrets. Print Railway variable names only, never values.
- Never touch the R2 bucket `coherence-audio`; it belongs to another project.
- Never sign in to the person's own accounts.
- Never commit anything in `recordings/` (their screen recordings of other
  apps).

## Don'ts (already researched; don't spend time on them)

- iPhone haptics on the web: the hidden-switch trick was patched in iOS 26.5,
  and the Vibration API covers Android only. Leave the haptics in
  `src/components/ui/primitives.tsx` as they are.
- Vaul (unmaintained), Lenis smooth scroll and React Bits: they break
  "What never moves".
- Rive and Lottie: rejected for watermarks and size. The drawn moments are
  SVG moved by CSS or the browser's own animations (WAAPI).
- The Taste Skill (`design-taste-frontend`) is for websites. Use it only for
  a Divvy landing page, never for app screens.
- Animate UI and 21st.dev are reference only. Rebuild anything borrowed with
  Divvy's tokens and depth levels, with its licence and size checked first
  (MOTION-SPEC section 9).

## Prisma 7

- `prisma`, `@prisma/client` and `@prisma/adapter-better-sqlite3` are
  pinned to the same exact version and always move together. npm's "latest"
  `prisma` is a Prisma 8 test release, so never install `prisma@latest`,
  even when Prisma's "update available" box suggests it.
- The app's client doesn't read `.env`; Next.js and `prisma.config.ts` load
  it. A plain `tsx` script that uses the database needs `DATABASE_URL` set,
  or should run through `prisma db seed` as `npm run db:seed` does.
- The client is generated into `src/generated/prisma` (not in git). Import
  it from `@/generated/prisma/client`, never `@prisma/client`. `npm ci` and a
  plain `npm install` generate it; `npm install <package>` doesn't, so run
  `npx prisma generate` after that and after any schema change.
- `prisma migrate dev` no longer generates the client or loads demo data.
  Run `npx prisma generate`, then `npm run db:seed` if wanted.
- Use the one client in `src/lib/db.ts`; don't create another. It keeps two
  settings that protect real data:
  - `timestampFormat: "unixepoch-ms"`: dates are stored as numbers, as
    Prisma 6 stored them. Without it new dates are saved as text.
  - `oneAtATime`: database work takes turns. Without it a save can run
    inside another request's transaction and vanish if that one fails.
- A relative `file:` address still means a file in `prisma/`
  (`prisma/database-url.ts`), for the app and the CLI alike.
- A worktree with a `node_modules` junction to a Prisma 6 checkout won't
  build Prisma 7 code. Run `npm ci` in it instead.

## Checking work

Run from the repo root in Git Bash. `HANDOFF.md` section 6 has the full
detail.

- `npx tsc --noEmit -p .`, `npx eslint src scripts`, `npx vitest run`
- Build with `npm run build:app`, not `npm run build` (that one also
  migrates `.env`'s database).
- Serve on the test database: `DATABASE_URL=file:./design.db npx next start --port 3100`.
  `prisma/dev.db` is behind on migrations; don't migrate it without asking.
- Copy a test database only while no server is using it. A copy taken
  mid-write misses the newest pages (they sit in the `-wal` file) and comes
  out damaged: that is how `fix.db` ended up with 443 broken links on
  28 October, while every suite run on a fresh database leaves it sound. A
  fresh one: `DATABASE_URL=file:./clean.db npx prisma migrate deploy`.
- No Playwright Chromium on this machine. Use Edge:
  `export CHROMIUM_PATH="C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"`.
  Never run `msedge.exe --version`; it opens a window on the person's screen.
- Database health, read-only and counts only (bills whose shares don't add
  up, people outside their group, damaged file and more; every problem
  should be 0): `DATABASE_URL=file:./design.db node scripts/db-check.mjs`,
  or `node scripts/db-check-live.mjs` for the live database (needs the
  Railway CLI signed in).
- Permission table, every action as every kind of person (in CI):
  `node scripts/permissions.mjs <url>`.
- Bad input at every route (no 500s, nothing internal leaked; about 30,000
  calls, half an hour, by hand): serve a copy of the test database with
  `DIVVY_RATE_LIMIT_SCALE=1000`, then `node scripts/fuzz-routes.mjs <url>`,
  optionally with part of a path (no leading slash in Git Bash) to rerun one.
- Phones and accessibility (RULES R2 to R6, A1, A4; about ten minutes):
  `node scripts/phone-check.mjs <url> <out-dir>` reports real tap areas
  under 44 points, axe in Day and Night, 200% text and zoom, the notch and
  home bar, and the keyboard over every form. WebKit drops the app's
  Secure cookie over plain http, so to include Safari's engine put a local
  https relay in front of the server (this machine has one, not in git:
  `node perf-runs/tls/proxy.mjs 3443 3100`) and add
  `BASE_WEBKIT=https://localhost:3443`. Compare the totals before and
  after a change. It runs in CI with `STRICT=1 STRICT_SKIP=axe` (every total
  but axe must be 0; axe joins once the colour phase fixes item 9).
  `PARTS=screens` (or `forms`, `panels`) runs one part.
- Colour (RULES C1 to C7; in CI, no server needed):
  `node scripts/colour-check.mjs`. Contrast in Day and Night (WCAG 4.5 to 1
  and APCA), green and orange only beside money in the components, no text
  faded below its token, the off switch and field edges at 3 to 1, and the
  person colours apart under colour blindness. CI's `STRICT_SKIP` lists the
  rules not yet fixed; a fix takes its rule off the list.
- A slow connection, no connection and Reduce Motion (RULES R5, A5; in CI):
  `node scripts/network-check.mjs <url> <out-dir>`. With Reduce Motion on,
  nothing may change position or size over time; fades, colours and
  instant changes may.
- Browser suites: `node scripts/ui-check.mjs <url>`,
  `node scripts/ui-features.mjs <url>`, `node scripts/pwa-check.mjs <url>`.
  Many sign-ups from localhost hit a rate limit (429); restarting the server
  clears it.
- Accessibility and long-text reports (each takes `<url> <out-dir>`; compare
  before and after a change): `scripts/keyboard-check.mjs` (every panel by
  keyboard; `WIDTH=390` for the phone layout), `scripts/a11y-tree.mjs` (what a
  screen reader is told), `scripts/focus-rings.mjs` (Day and Night close-ups),
  `scripts/long-text.mjs` (40-letter names, 9,999,999.99 in five currencies,
  Arabic and Hebrew).
- A server started from a worktree needs `DIVVY_SECRET` (it has no `.env`);
  any 64 hex characters will do for a test database.
- Stopping a background shell doesn't stop the server. In PowerShell:
  `Get-NetTCPConnection -LocalPort 3100 -State Listen | % { Stop-Process -Id $_.OwningProcess -Force }`.
- Download size: compare before and after built in the same folder. The
  compressed figure can move by about 0.6 KB with no code change (the build
  numbers its pieces differently), so when a result is that close to a
  limit, check `ScriptRaw`, which only moves when code does
  (PERF-BASELINE 22).
- iPhone launch screens: after changing Home's outline, the tab bar or the
  colours, run `node scripts/launch-screens.mjs <url>` against a production
  build and commit `public/launch/` and `src/app/launch-screens.ts`.
- Motion videos are made frame by frame (`scripts/motion-record.mjs`,
  `motion-compare.mjs`, `motion-video.mjs`), never by recording the screen
  live. `SCHEME=dark` records at Night; flows `12-paid`, `13-arrive-hop` and
  `14-settled-hop` cover the drawings.

## Animation rules learned the hard way

- Never let Motion blend a transform from `none`: it starts at scale 0.
  Give every `initial` an explicit transform.
- Use WAAPI or CSS for anything that runs while React is busy.
- Count numbers by writing text directly (`useCountedText`), not through
  React state.
- Never re-check the clock after a timer without a fallback wake-up (timers
  can fire slightly early on CI).
- Before removing a worktree with a `node_modules` junction, delete the
  junction first: `(Get-Item <dir>\node_modules).Delete()` in PowerShell.
