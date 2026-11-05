// ESLint flat config (ESLint 9 / typescript-eslint 8).
// Quality gate for src/** — non-type-checked preset (fast, no project graph).
// TypeScript already enforces types via `npm run typecheck`; ESLint catches the
// lint-class issues tsc does not (unused vars, empty blocks, bad patterns).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'out/**',
      'node_modules/**',
      'media/**',
      'coverage/**',
      'deps.svg',
      '**/*.js',
      '**/*.mjs',
      '**/*.cjs',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // TS handles undefined-symbol resolution; no-undef double-reports DOM/Node globals.
      'no-undef': 'off',
      // Best-effort cleanup uses `catch {}` deliberately (see silent-failure audit).
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Intentional control-char stripping in name/regex sanitizers ([\x00-\x1f]).
      'no-control-regex': 'off',
      // `import JSZip = require('jszip')` is deliberate (no esModuleInterop).
      '@typescript-eslint/no-require-imports': 'off',
      // Stylistic only; auto-fix is unsafe inside regex-built-from-string / template
      // literals (backslash rules in docs/architecture/webview-templates.md). Keep visible as a warning, not a gate fail.
      'no-useless-escape': 'warn',
      // Off for the existing stock (~85 host, ~86 webviewClient — tm1Rest has only 16);
      // src/test/explicitAnyRatchet.test.ts keeps both counts from growing.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      // `_`-prefixed = deliberately unused; ignore caught errors (logged or rethrown).
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
