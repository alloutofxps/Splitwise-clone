import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every route handler has to be reachable from the app.
 *
 * This exists because of a pattern rather than a bug. Eight separate features
 * in this codebase were built server-side and then never wired to anything:
 * the budget endpoints, the ledger's category and person filters, the
 * settlement delete route, the `?compose=1` shortcut, the lint config, a
 * constant-time compare, a whole push-subscription table, and an update toast
 * made unreachable by a `skipWaiting()` in the wrong place.
 *
 * Nothing in the toolchain notices. Types are fine — the handler is
 * well-typed, it is simply never called. Lint is fine — it is an export.
 * Worse, the API tests actively *hide* it: the settlement delete route passed
 * every server-side assertion while the row that should have called it was a
 * plain `<div>`, so the suite was green and the feature did not exist.
 *
 * So the check is per method, not per path. `/api/settlements/[id]` existing in
 * the client is not enough; something has to actually issue a DELETE at it.
 *
 * It is a static scan, so it proves reachability of the *call*, not that the
 * button works — `scripts/ui-check.mjs` is the one that clicks things. What it
 * does catch, mechanically and forever, is the whole class of "finished the
 * server, forgot the last wire".
 */

const ROOT = process.cwd();

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/**
 * Handlers with no caller in the app, and why that is correct.
 *
 * Every entry needs a reason. An endpoint nothing calls and nothing explains
 * is the exact thing this test is for, so the escape hatch is deliberately
 * uncomfortable to use.
 */
const DELIBERATELY_UNCALLED: Record<string, string> = {
  "GET /api/attachments/[id]":
    "Reached by the browser, not by the app. `read.ts` hands the client an `/api/attachments/<id>` URL and it lands in an `<img src>` or a download, so there is no fetch to find - the bytes are requested by the element.",
  "POST /api/recurrences/run":
    "Cron entry point. Recurrences also catch up whenever anyone opens the app, so the client has no reason to call it; the README documents pointing a scheduler here instead.",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** `src/app/api/groups/[id]/export/route.ts` -> `/api/groups/[id]/export` */
function routePath(file: string): string {
  return relative(join(ROOT, "src/app"), file)
    .replace(/\\/g, "/")
    .replace(/\/route\.tsx?$/, "")
    .replace(/^/, "/");
}

/**
 * A route path becomes a regex against the client's template literals.
 *
 * `[id]` matches an interpolation or a literal, so `/api/expenses/[id]` is
 * satisfied by `` `/api/expenses/${id}` `` and by `"/api/expenses/abc"`, but
 * not by `/api/expenses` — the segment has to be there.
 */
function matcher(path: string): RegExp {
  const source = path
    .split("/")
    .filter(Boolean)
    .map((segment) =>
      /^\[.+\]$/.test(segment) ? "(?:\\$\\{[^}]*\\}|[\\w.:-]+)" : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/");
  // Anchored so `/api/groups` does not match `/api/groups/${id}`, while still
  // allowing a query string or a trailing interpolation - several calls build
  // their filters as `` `/api/recurrences${suffix}` ``.
  return new RegExp(`/${source}(?:[?\`"']|\\$\\{|$)`);
}

interface CallSite {
  method: Method;
  target: string;
}

/**
 * Reads the argument list of a call, balanced.
 *
 * Naive matching on "a quote right after the paren" misses every call whose
 * path is conditional, and this codebase has several - the activity feed picks
 * between a cursor URL and a bare one inside the argument itself. Walking to
 * the matching parenthesis and then looking for `/api/...` anywhere inside
 * handles ternaries, `encodeURIComponent`, and line breaks, without the window
 * bleeding into the next call and inventing a caller that is not there.
 */
function callArguments(source: string, openParen: number): string {
  let depth = 0;
  for (let i = openParen; i < source.length; i += 1) {
    const c = source[i];
    if (c === "(") depth += 1;
    else if (c === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(openParen + 1, i);
    }
  }
  return source.slice(openParen + 1, openParen + 400);
}

const API_LITERAL = /[`"']([^`"'$]*\/api\/[^`"']*)/g;

function pathsIn(text: string): string[] {
  return [...text.matchAll(API_LITERAL)].map((m) => m[1]);
}

/** Every request the client can issue, as (method, path-ish string). */
function clientCallSites(): CallSite[] {
  const files = walk(join(ROOT, "src")).filter(
    (f) => /\.tsx?$/.test(f) && !f.includes(join("src", "app", "api")) && !f.includes("__tests__"),
  );

  const sites: CallSite[] = [];
  const verb: Record<string, Method> = {
    get: "GET",
    post: "POST",
    patch: "PATCH",
    put: "PUT",
    del: "DELETE",
  };

  for (const file of files) {
    const source = readFileSync(file, "utf8");

    // api.get(...) / api.post(...) / api.del(...), with or without a type arg.
    for (const m of source.matchAll(/\bapi\s*\.\s*(get|post|patch|put|del)\s*(?:<[\s\S]*?>)?\s*\(/g)) {
      const args = callArguments(source, m.index + m[0].length - 1);
      for (const path of pathsIn(args)) sites.push({ method: verb[m[1]], target: path });
    }

    // Raw fetch, for the few places that do not want the wrapper. The method
    // is in the init object, defaulting to GET when there is none.
    for (const m of source.matchAll(/\bfetch\s*\(/g)) {
      const args = callArguments(source, m.index + m[0].length - 1);
      const explicit = /method:\s*["'](GET|POST|PATCH|PUT|DELETE)["']/.exec(args);
      const method = (explicit?.[1] ?? "GET") as Method;
      for (const path of pathsIn(args)) sites.push({ method, target: path });
    }

    // The offline outbox replays by path and method rather than through `api`.
    for (const m of source.matchAll(
      /path:\s*[`"']([^`"']*)[\s\S]{0,120}?method:\s*["'](GET|POST|PATCH|PUT|DELETE)["']/g,
    )) {
      sites.push({ method: m[2] as Method, target: m[1] });
    }

    // A download is a plain navigation, which is a GET.
    for (const m of source.matchAll(/new URL\(\s*[`"'](\/api\/[^`"']*)/g)) {
      sites.push({ method: "GET", target: m[1] });
    }
  }

  return sites;
}

const routeFiles = walk(join(ROOT, "src/app/api")).filter((f) => /\/route\.tsx?$/.test(f));
const callSites = clientCallSites();

const handlers = routeFiles.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  const methods = [...source.matchAll(/export\s+(?:const|async function)\s+(GET|POST|PATCH|PUT|DELETE)\b/g)].map(
    (m) => m[1] as Method,
  );
  return methods.map((method) => ({ method, path: routePath(file), file }));
});

describe("every route handler is reachable from the app", () => {
  it("finds the routes and the call sites at all", () => {
    // A scan that silently matched nothing would pass every assertion below.
    expect(handlers.length).toBeGreaterThan(30);
    expect(callSites.length).toBeGreaterThan(30);
  });

  for (const handler of handlers) {
    const key = `${handler.method} ${handler.path}`;
    const reason = DELIBERATELY_UNCALLED[key];

    it(`${key}${reason ? " is deliberately uncalled" : ""}`, () => {
      const pattern = matcher(handler.path);
      const called = callSites.some(
        (site) => site.method === handler.method && pattern.test(site.target),
      );

      if (reason) {
        // Listed exceptions must stay true. One that gains a caller should be
        // taken off the list rather than left lying about the code.
        expect(called, `${key} now has a caller — remove it from DELIBERATELY_UNCALLED`).toBe(false);
        return;
      }

      expect(
        called,
        `${key} has a handler at ${relative(ROOT, handler.file)} that nothing in the app calls. ` +
          "Either wire it up, or add it to DELIBERATELY_UNCALLED with a reason.",
      ).toBe(true);
    });
  }
});
