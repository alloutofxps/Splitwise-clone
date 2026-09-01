import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The `@/` alias that tsconfig declares. Without it, any module under test
  // that reaches for `@/lib/...` fails to resolve, which quietly limits the
  // suite to the few files that import nothing.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
