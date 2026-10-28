/**
 * Runs scripts/db-check.mjs inside the live server, read-only (RULES.md D1
 * to D4, B1). Needs the Railway CLI signed in and linked to the project.
 *
 *   node scripts/db-check-live.mjs
 *
 * The check is sent compressed and run from the server's /app folder, where
 * the database library is installed. Nothing is written there. It prints the
 * same counts as the local check, and exits 1 if any problem count is not 0.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const code = gzipSync(readFileSync(new URL("./db-check.mjs", import.meta.url))).toString("base64");
const remote = `cd /app && echo ${code} | base64 -d | gunzip | node --input-type=module`;
const result = spawnSync("npx", ["-y", "@railway/cli@5.68.0", "ssh", "--", `"${remote}"`], {
  shell: true,
  encoding: "utf8",
});
// The CLI adds a few lines of its own (which key it used, a setup tip).
const out = result.stdout ?? "";
const json = out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1);
if (!json) {
  console.error((result.stderr || out).trim() || "no output from the live server");
  process.exit(2);
}
console.log(json);
process.exit(JSON.parse(json).verdict === "no problems" ? 0 : 1);
