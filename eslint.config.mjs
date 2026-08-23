import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import next from "@next/eslint-plugin-next";

/**
 * Lint configuration.
 *
 * There was none before this: `package.json` carried a `lint` script pointing at
 * `next lint`, which has no config to read and is itself removed in Next 16, so
 * the command had never once run. The `eslint-disable` comments scattered
 * through the source were suppressing nothing.
 *
 * Two rules earn their place here more than the rest, because both catch classes
 * of bug this codebase has actually shipped:
 *
 *   - `react-hooks/exhaustive-deps`, as a warning rather than an error. Several
 *     effects here deliberately omit dependencies to avoid fighting a user
 *     mid-keystroke, and each one says so in a comment above its disable
 *     directive. A warning keeps those visible without failing the build, and
 *     still flags the accidental omissions.
 *   - `@typescript-eslint/no-floating-promises`, which needs type information
 *     and is therefore worth the slower typed lint. A dropped `await` on a
 *     Prisma write is a data-loss bug that typechecks perfectly.
 */
export default tseslint.config(
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "public/sw.js",
      "src/generated/**",
      "next-env.d.ts",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Config files live outside `tsconfig.json`'s `include`, so the
          // project service has no program for them. Linting them with the
          // default project keeps the typed rules working there instead of
          // failing to parse.
          // `*.ts` is deliberately absent: `next.config.ts` is already in the
          // tsconfig, and listing a file in both places is an error.
          allowDefaultProject: ["*.mts", "*.mjs"],
        },
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": next,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...next.configs.recommended.rules,

      // An unused parameter is often deliberate - a destructured rest, or a
      // positional argument a signature requires. Leading underscore is the
      // convention for saying so.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],

      // See the note above: deliberate omissions are commented, accidental ones
      // are what this is for.
      "react-hooks/exhaustive-deps": "warn",

      // A warning rather than an error, after reading every site it flags.
      //
      // The first pass through these dismissed them all as deliberate. That was
      // wrong about one group: the sheets that reset their draft in an effect
      // when they open. Rebuilding state in an effect means the rebuild is
      // keyed on the effect's dependencies, and the composer's included the
      // dashboard query result - so a refetch while the sheet was open (a
      // groupmate adds an expense, the connection blips) rebuilt the draft and
      // wiped whatever was half-typed. Measured, then fixed: those now reset
      // during render via `useResetOnOpen`, which is React's documented answer.
      //
      // What is left is genuinely deliberate:
      //
      //   - reads of browser-only state (localStorage, `mounted` flags before a
      //     portal renders), which cannot move into render without breaking
      //     server rendering;
      //   - resets that run on *close* rather than open, where nothing is
      //     painted in between;
      //   - reconciling a locally-edited string with an external value, in the
      //     amount field, the keypad and the split editor. Each is commented in
      //     place and was tuned against a real browser so it does not fight a
      //     user mid-keystroke.
      //
      // Left visible rather than switched off. It earned that.
      "react-hooks/set-state-in-effect": "warn",
    },
  },

  // Scripts are plain Node ESM, run by hand and in CI. They are outside the
  // tsconfig, so typed rules cannot apply to them.
  {
    files: ["**/*.mjs", "**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: globals.node },
  },
);
