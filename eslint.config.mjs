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

      // A warning, not an error, after reading all 25 of the sites it flags.
      // They fall into three groups and none is a bug:
      //
      //   - reads of browser-only state (localStorage, `mounted` flags before a
      //     portal renders). These cannot move into render without breaking
      //     server rendering, so the rule has no fix to offer;
      //   - resetting a sheet's draft when it opens. React would rather this
      //     were a `key` prop, which is a real improvement and a real refactor
      //     of every sheet in the app;
      //   - reconciling a locally-edited string with an external value, in the
      //     amount field and the keypad. Both are commented in place, and both
      //     were tuned against a real browser so they do not fight a user
      //     mid-keystroke; restructuring them for a lint rule would risk the
      //     behaviour for no defect.
      //
      // Left visible rather than switched off, so a *new* one gets noticed.
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
