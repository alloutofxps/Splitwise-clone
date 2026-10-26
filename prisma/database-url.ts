import path from "node:path";

/**
 * The SQLite file a `file:` DATABASE_URL names.
 *
 * Prisma 6 read a relative path such as `file:./dev.db` from the `prisma/`
 * folder, next to the schema. Prisma 7 reads it from wherever the command
 * runs, so the same `.env`, CI setting or `DATABASE_URL=file:./design.db`
 * would quietly open a new, empty database in the project root. Resolving
 * against `prisma/` here keeps every existing address meaning what it did.
 * Absolute paths (production's `file:/data/divvy.db`) pass through as they are.
 *
 * Anything after `?` is dropped: Prisma 6 read pool settings from there, and
 * the SQLite driver would take them as part of the file name.
 *
 * It lives in `prisma/` because `prisma.config.ts` needs it too, and the
 * Docker image's runtime stage has `prisma/` but not `src/`.
 */
export function databaseFile(url: string): string {
  const file = url.replace(/^file:/, "").split("?")[0];
  if (file === ":memory:" || path.isAbsolute(file)) return file;
  return path.join(process.cwd(), "prisma", file);
}
