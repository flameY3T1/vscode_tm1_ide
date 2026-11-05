// Dedicated type-checked ESLint pass for the async gate only.
// Unhandled promise rejections are the costliest unguarded failure class in the
// extension host, and `no-floating-promises` needs the type graph — which the
// fast base config (eslint.config.mjs) deliberately omits. Run separately via
// `npm run lint:promises`; host code against tsconfig.json, webviewClient against its own tsconfig
// (test/test-integration excluded).
import tseslint from 'typescript-eslint';

const RULES = {
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  // A new message type must not fall through a `switch` silently. Unions only;
  // a `default:` still counts as handled.
  '@typescript-eslint/switch-exhaustiveness-check': ['error', { considerDefaultExhaustiveForUnions: true }],
};

export default tseslint.config(
  {
    // This pass enables exactly two rules, so every `eslint-disable` written for the
    // base config (eslint.config.mjs) looks unused here — it reported the two legitimate
    // `prefer-const` directives as dead, and removing them broke `npm run lint`
    // (2026-08-30). A pass with a partial rule set must not judge other passes' directives.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
  {
    ignores: [
      'out/**',
      'node_modules/**',
      'media/**',
      'coverage/**',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.d.ts',
    ],
  },
  tseslint.configs.base,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/test/**', 'src/test-integration/**', 'src/webviewClient/**'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: RULES,
  },
  {
    // The webview is where a rejected promise leaves no trace at all (no host
    // log), so it gets the same gate on its own tsconfig.
    files: ['src/webviewClient/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './src/webviewClient/tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: RULES,
  },
);
