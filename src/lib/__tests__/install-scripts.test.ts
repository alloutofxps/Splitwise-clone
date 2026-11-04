import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * npm is moving to running a package's install steps only when the project
 * has said yes to them (`allowScripts` in package.json; `npm ci
 * --strict-allow-scripts` already refuses the rest). CI's npm is older and
 * ignores the list, so this keeps it whole: a new dependency that brings an
 * install step fails here until it is approved (`npm approve-scripts`) or
 * turned off (`npm deny-scripts`), rather than on the day npm starts refusing.
 */
describe("install steps", () => {
  const root = process.cwd();
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    allowScripts?: Record<string, boolean>;
  };
  const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")) as {
    packages: Record<string, { hasInstallScript?: boolean }>;
  };

  const withSteps = Object.entries(lock.packages)
    .filter(([path, entry]) => path !== "" && entry.hasInstallScript)
    .map(([path]) => path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length));

  it("has a decision for every package with an install step", () => {
    const decided = Object.keys(pkg.allowScripts ?? {});
    expect(withSteps.filter((name) => !decided.includes(name))).toEqual([]);
  });

  it("lists no package that is gone", () => {
    const decided = Object.keys(pkg.allowScripts ?? {});
    expect(decided.filter((name) => !withSteps.includes(name))).toEqual([]);
  });
});
