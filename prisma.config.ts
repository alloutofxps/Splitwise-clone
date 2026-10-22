import { defineConfig } from "prisma/config";

/**
 * How the Prisma CLI finds the schema, the migrations and the seed.
 *
 * This replaces the `prisma` section of `package.json`, which Prisma 7 drops,
 * and is the file Prisma 7 reads the database address from, so moving here on
 * Prisma 6 first keeps that upgrade to the client itself.
 *
 * With a config file present the CLI stops reading `.env` on its own, so it is
 * loaded here. Node's loader never replaces a variable that is already set, so
 * `DATABASE_URL=file:./design.db npx prisma ...` still wins over the file, and a
 * missing `.env` (CI, the Docker image) is fine: the environment provides it.
 */
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
});
