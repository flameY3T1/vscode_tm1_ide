import { defineConfig } from 'vitest/config';
import path from 'path';

// vmForks @ 6: ~3.2s wall vs 6.1s default forks (~48% faster). Sweep 4/6/8/12 → 4-6 tied; 12 oversubscribes WSL2.
// vitest 4: `pool` / `poolOptions` are top-level (moved out of `test`).
export default defineConfig({
  pool: 'vmForks',
  poolOptions: {
    vmForks: {
      minForks: 6,
      maxForks: 6,
    },
  },
  test: {
    globals: true,
    include: ['src/test/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    // Dauerhaft gemischte Reihenfolge (Review 2026-08-24, H3).
    //
    // Vier Testdateien waren nur wegen der festen DATEIREIHENFOLGE gruen: sie
    // erbten Zustand voneinander (`vi.mock`-Doubles ohne `resetAllMocks`, ein
    // stehengebliebener V12-Modus). Bei Seed 4711 fielen sie um. Ohne Mischen
    // ist die Testfolge ein stiller Teil des Vertrags — und sie stimmt genau
    // so lange, bis jemand eine Datei umbenennt.
    //
    // `shuffle.files` mischt die Dateien, `shuffle.tests` seit 2026-09-19 auch
    // die Reihenfolge INNERHALB einer Datei. Vorher stand hier, ein `beforeEach`,
    // das aufeinander aufbaut, sei eine legitime Bauform — das stimmt, nur
    // versteckten sich hinter der Ausnahme drei Dateien, die ihren Vorgaenger
    // mitlasen: die Attrappen des vscode-Mocks sind modulweit, ein zweites
    // `vi.spyOn` auf dieselbe Methode liefert DIESELBE Attrappe samt
    // Aufrufzaehler, und `mock.calls[0]` war dann der Aufruf eines frueheren
    // Tests (`adminServerCommands`, `serverDeleteCommand`, Befund E1 vom
    // 2026-09-19; `dimBrowserDrillActions` startete gar keine eigene Sicht, E2).
    // Ein `beforeEach` bleibt erlaubt — er laeuft vor JEDEM Test. Was nicht mehr
    // durchgeht, ist ein `it`, das den Zustand seines Vorgaengers braucht.
    //
    // Ohne festen `seed`: jeder Lauf zieht eine neue Folge, damit die Wand
    // ueber viele Laeufe breiter wird statt bei einer Folge zu verharren. Die
    // Folge steht in der vitest-Ausgabe und ist ueber `--sequence.seed=<n>`
    // wiederholbar. Zuletzt gruen gemessen (mit `tests: true`, 2026-09-19):
    // 1, 42, 777, 4711, 31337, 20260919.
    sequence: {
      shuffle: { files: true, tests: true },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.generated.ts',
        'src/tiLogicVisualizer/signatures/**',
        'src/webviews/**/*Webview.ts',
        'src/webviewClient/cubeViewerMonaco/**',
        'src/webviewClient/mdxRunnerMonaco/**',
        'src/webviewClient/processEditorMonaco/**',
        'src/webviewClient/ruleEditorMonaco/**',
        'src/webviewClient/processTemplateEditorMonaco/**',
        'src/webviewClient/monacoVendor/**',
        'src/activation/**',
        'src/snippets/**',
        'src/debug/**',
        'src/extension.ts',
      ],
      // Regression gate (ratchet): each value = measured global, floored, minus 1pt of
      // slack. Measured 2026-07-26: lines 58.91 / funcs 58.62 / stmts 57.22 / branches
      // 52.14. Trips only on a real drop, not on rounding noise. Ratchet these up again
      // whenever coverage climbs — do NOT set per-file thresholds.
      thresholds: {
        lines: 57,
        functions: 57,
        statements: 56,
        branches: 51,
      },
    },
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'src/test/__mocks__/vscode.ts'),
    },
  },
});
