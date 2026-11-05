import { defineConfig } from '@vscode/test-cli';

// Integration tests run in a real VS Code (Electron) host against the bundled
// extension (out/extension.js). Unit tests stay in src/test/** under vitest with
// a mocked `vscode`; these are the complementary "does it work in real VS Code"
// smoke layer. Compiled specs live in out/test-integration/ (see
// src/test-integration/tsconfig.json).
export default defineConfig({
  files: 'out/test-integration/**/*.test.js',
  version: 'stable',
  mocha: {
    ui: 'tdd',
    timeout: 60000,
  },
});
