/**
 * Matcher für das `vscode`-Modul in `to.path`.
 *
 * ACHTUNG: `to.path` matcht den AUFGELÖSTEN Pfad. `import … from 'vscode'` löst über
 * `@types/vscode` nach `node_modules/@types/vscode/index.d.ts` auf — ein naives
 * `to: { path: '^vscode$' }` greift deshalb NIE. Genau so waren `webview-no-vscode` und
 * `tm1rest-no-vscode` seit Hebel 14 stille Dead Rules (verifiziert + gefixt 2026-07-26:
 * ein probeweiser `import * as vscode` in `src/tm1Rest/parseRest.ts` lief glatt durch).
 * Der Alternativ-Zweig `^vscode$` deckt den Fall ab, dass `@types/vscode` fehlt und der
 * Import unresolved bleibt.
 */
const VSCODE_MODULE = '^vscode$|(?:^|/)node_modules/@types/vscode(?:/|$)';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ─── Layer Rules (project-specific, Hebel 14) ─────────────────────────
    {
      name: 'webview-no-vscode',
      severity: 'error',
      comment:
        'webviewClient/ läuft im Webview-Sandbox-Renderer ohne vscode-Modul. ' +
        'Import von "vscode" bricht zur Laufzeit. Nutze postMessage über vscodeApi-Wrapper.',
      from: { path: '^src/webviewClient/' },
      // reachable: an innocent `*Pure.ts` the webview imports must not pull vscode in
      // through a second hop either (the webview esbuild has no `external`).
      to: { path: VSCODE_MODULE, reachable: true },
    },
    {
      name: 'webview-no-tm1rest',
      severity: 'error',
      comment:
        'webviewClient/ darf tm1Rest/ + tm1Client.ts nicht direkt nutzen — kein REST-Call im Sandbox. ' +
        'Daten über Extension-Host via postMessage holen.',
      from: { path: '^src/webviewClient/' },
      to: { path: '^src/(tm1Rest|tm1Client)' },
    },
    {
      name: 'webview-no-commands',
      severity: 'error',
      comment:
        'webviewClient/ darf nicht in commands/ greifen — die laufen im Extension-Host.',
      from: { path: '^src/webviewClient/' },
      to: { path: '^src/commands/' },
    },
    {
      name: 'tm1rest-no-vscode',
      severity: 'error',
      comment:
        'tm1Rest/ ist transport-only und soll vscode-frei bleiben (für unit-testbar). ' +
        'Workspace-Config-Reads gehören in tm1Client.ts (facade) oder commands/. ' +
        'AUSNAHMEN (2026-07-26, dokumentierte Altlast — NICHT erweitern): Solange die Regel ' +
        'wegen des `^vscode$`-Matcher-Bugs (s.o. VSCODE_MODULE) tot war, sind zwei echte ' +
        'Verstöße reingerutscht, die beide `vscode.workspace.getConfiguration` lesen: ' +
        'client.ts#getConfig/#getTimeout (Legacy-Workspace-Settings-Fallback) und ' +
        'transport/agent.ts (VS-Code http.*-Proxy-Settings für resolveAgent). Beide sauber ' +
        'rauszuziehen ist ein eigener Umbau (Config müsste durchgereicht werden), kein ' +
        'Drive-by-Fix — darum hier explizit ausgenommen statt die Regel zu verwässern. ' +
        'Jede WEITERE tm1Rest-Datei mit vscode-Import bricht den Build, wie vorgesehen.',
      from: {
        path: '^src/tm1Rest/',
        pathNot: [
          '^src/tm1Rest/client\\.ts$',
          '^src/tm1Rest/transport/agent\\.ts$',
        ],
      },
      to: { path: VSCODE_MODULE },
    },
    {
      name: 'tm1rest-no-commands',
      severity: 'error',
      comment:
        'tm1Rest/ ist die unterste Schicht und darf nicht nach oben in commands/ greifen. ' +
        'Bis 2026-10-04 taten es vier Kanten (reorderDimsPure, defaultMemberPure, ' +
        'elementQuery, sandboxTracker) — die Module liegen jetzt selbst in tm1Rest/ (Review E2).',
      from: { path: '^src/tm1Rest/' },
      to: { path: '^src/commands/' },
    },
    {
      name: 'pure-no-vscode',
      severity: 'error',
      comment:
        '*Pure.ts ist per Konvention ein reines, vscode-freies, unit-testbares Modul ' +
        '(processParamsPure, asciiPreviewPure, keepOnlyPure, messageLogAnalysisPure, …). ' +
        'vscode-abhängige Logik gehört in das aufrufende commands/- bzw. providers/-Modul, ' +
        'das dem Pure-Modul plain Daten reinreicht. Direkte Prüfung (wie tm1rest-no-vscode), ' +
        'NICHT transitiv: mit `tsPreCompilationDeps: true` zählen auch `import type`-Kanten, ' +
        'und ein `reachable: true` würde deshalb jedes *Pure.ts anmeckern, das bloß einen ' +
        'Typ aus tm1Rest/ importiert (Kante zur Laufzeit wegkompiliert) — 7 False Positives, ' +
        'gemessen 2026-07-26. Stand 2026-07-26: alle 52 *Pure.ts sind sauber, KEINE Ausnahmen.',
      from: { path: '^src/.*Pure\\.ts$' },
      to: { path: VSCODE_MODULE },
    },
    {
      name: 'cubeviewer-no-vscode',
      severity: 'error',
      comment:
        'src/cubeViewer/ (cellWrite.ts, cellPicklistMdxPure.ts, cubeSpreadApi.ts, ' +
        'cubeWriteApi.ts, picklistPure.ts, picklistRulePure.ts, spreadMethods.ts, ' +
        'spreadTokenParser.ts, undoStack.ts) wird über ' +
        'pureBridge.ts UNVERÄNDERT ins Webview-Bundle re-exportiert — derselbe Quelltext läuft ' +
        'im Extension-Host UND im vscode-freien Webview-Sandbox. Ein vscode-Import bricht dort ' +
        'zur Laufzeit (Task 11, 2026-08-13). Bisher nur Konvention, nicht maschinell geprüft — ' +
        'Verzeichnis war bei Einführung der Regel bereits sauber, keine Ausnahmen nötig. ' +
        'vscode-abhängige Anreicherung (z.B. l10n-Meldungstexte) gehört ins aufrufende ' +
        'commands/-Modul (siehe commands/cubeViewer/picklistWriteError.ts).',
      from: { path: '^src/cubeViewer/' },
      to: { path: VSCODE_MODULE },
    },
    {
      name: 'no-tm1client-in-deep-layers',
      severity: 'error',
      comment:
        'Hebel 15 + P2-16 (2026-05-27) + Fix#9 (2026-07-12, invertiert): Die tm1Client-' +
        'Facade ist NUR für die App-Layer commands/, providers/, activation/ + extension.ts ' +
        'erlaubt (Legacy). ALLE anderen (Domain-)Layer — tm1Rest/, cubeViewer/, mdx/, ' +
        'security/, tiLogicVisualizer/, tiTestFramework/, git/, dimensionEditor/, ' +
        'serverConfig/, references/, debug/, monitoring/, bedrock/, cubeMaintenance/, ' +
        'processTemplates/, usageCheck/, elementQualifier/, tiSimulator/, … — MÜSSEN ' +
        'Transport-Helpers DIREKT aus src/tm1Rest/transport/* + src/tm1Rest/client.ts ' +
        'importieren. Als Allowlist invertiert (statt fixe Deep-Layer-Liste), damit neue ' +
        'Domain-Dirs nicht mehr am Guard vorbei die Facade nutzen können. Tests + Facade ' +
        'selbst ausgenommen. Neue Verstöße sind Build-Breaker.',
      from: {
        path: '^src/',
        pathNot: [
          // Legit facade-Layer (App-Layer)
          '^src/commands/',
          '^src/providers/',
          '^src/activation/',
          '^src/extension\\.ts$',
          // Facade selbst (re-exportiert transport)
          '^src/tm1Client\\.ts$',
          // Tests dürfen die Facade importieren
          '^src/test/',
          '^src/test-integration/',
          '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
        ],
      },
      to: { path: '^src/tm1Client\\.ts$' },
    },
    {
      name: 'workbench-registry-no-commands',
      severity: 'error',
      comment:
        'Das Fensterverzeichnis muss aus webviews/webviewPanelHost.ts heraus anmeldbar ' +
        'bleiben, ohne die Kindtabelle (und damit alle Manager) mitzuziehen. ' +
        'Deutung gehört nach src/commands/workbench/, nicht hierher.',
      from: { path: '^src/workbench/' },
      to: { path: '^src/commands/' },
    },
    {
      name: 'serverstate-no-commands',
      severity: 'error',
      comment:
        'Connection state was moved out of commands/ so providers, notebook and ' +
        'tests can read it without pulling in the server manager commands.',
      from: { path: '^src/serverState/' },
      to: { path: '^src/commands/' },
    },
    {
      name: 'activation-only-from-extension',
      severity: 'error',
      comment:
        'activation/ is the wiring layer: register* functions called from extension.ts. ' +
        'Runtime services that commands/ needed used to live here (serverDisposeRegistry, ' +
        'confirmAndRun — 6 commands->activation edges until review A5, 2026-10-05); they ' +
        'now sit in serverState/ and commands/. Anything shared belongs below activation/.',
      from: {
        path: '^src/',
        pathNot: ['^src/activation/', '^src/extension\\.ts$', '^src/test/', '^src/test-integration/'],
      },
      to: { path: '^src/activation/' },
    },
    {
      name: 'providers-no-commands',
      severity: 'error',
      comment:
        'providers/ (tree, completion, diagnostics, formatting) sit below commands/. ' +
        'Until review A5 (2026-10-05) 11 edges went up: profile/admin-server stores and ' +
        'stateKeys moved to serverState/, serverConfigForFile, adminDiscovery/adminInstances, ' +
        'picklistCubePure and the format config stores to providers/, the .pro parameter ' +
        'parser to utils/proFile.ts. The tree reads the workbench store through a local ' +
        'interface. commands/ may import providers/, not the other way round.',
      from: { path: '^src/providers/' },
      to: { path: '^src/commands/' },
    },
    {
      name: 'notebook-references-no-commands',
      severity: 'error',
      comment:
        'notebook/ and references/ are domain layers below commands/ (0 edges since ' +
        'review A5, 2026-10-05: runCancellableProcess moved to runState/, ' +
        'requireServerConfig to serverState/).',
      from: { path: '^src/(notebook|references)/' },
      to: { path: '^src/commands/' },
    },

    // ─── Baseline Rules (default preset, tweaked) ─────────────────────────
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependency detected. Dependency-Inversion oder Type-only-Imports erwägen.' +
        ' Ausnahme: processEditor/debug.ts — alle drei Cycle-Edges sind dynamic imports' +
        ' (kein Init-Order-Problem). Intentionell so belassen.',
      from: {
        pathNot: [
          '^src/tiLogicVisualizer/tiSignatures(\\.generated)?\\.ts$',
          '^src/commands/processEditor/(debug|openPanel|messaging)\\.ts$',
        ],
      },
      to: {
        circular: true,
        dependencyTypesNot: ['type-only'],
        pathNot: '^src/tiLogicVisualizer/tiSignatures(\\.generated)?\\.ts$',
      },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment:
        'Fix#8 (2026-07-12): Dead-Code-/Orphan-Guard (Projekt hat kein knip/ts-prune). ' +
        'severity=warn (advisory, kein Build-Breaker): echte tote Module werden ' +
        'gemeldet statt via pathNot versteckt; Löschung bleibt manuell. ' +
        'Ein Modul, das nichts importiert UND von nichts importiert wird, ist entweder ' +
        'toter Code oder ein neuer Entry-Point, der hier als Ausnahme deklariert werden ' +
        'muss. Ausgenommen: extension.ts (Extension-Entry), webviewClient/*/index.ts ' +
        '(esbuild-Bundle-Entries), *.d.ts, Config-/Dotfiles und Test-Dateien.',
      from: {
        orphan: true,
        pathNot: [
          // Dotfiles (.eslintrc.js etc.)
          '(^|/)[.][^/]+[.](?:js|cjs|mjs|ts|cts|mts|json)$',
          // TypeScript declaration files
          '[.]d[.]ts$',
          // (typescript) config files
          '(^|/)tsconfig[.]json$',
          '(^|/)(?:babel|webpack)[.]config[.](?:js|cjs|mjs|ts|json)$',
          // Extension-Host-Entry
          '^src/extension\\.ts$',
          // esbuild webviewClient-Bundle-Entries (siehe esbuild.config.mjs#entryPoints)
          '^src/webviewClient/[^/]+/index\\.ts$',
          // Test-Dateien (nur via vitest geladen, keine statischen Importer)
          '^src/test/',
          '^src/test-integration/',
          '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
        ],
      },
      to: {},
    },
    {
      name: 'no-deprecated-core',
      severity: 'warn',
      from: {},
      to: {
        dependencyTypes: ['core'],
        // async_hooks is not on the list: its AsyncLocalStorage is stable API
        // (tm1Rest/transport/abortScope.ts); only createHook is discouraged.
        path: [
          '^punycode$', '^domain$', '^constants$', '^sys$',
          '^_linklist$', '^_stream_wrap$',
        ],
      },
    },
    {
      name: 'not-to-deprecated',
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['deprecated'] },
    },
    {
      name: 'no-non-package-json',
      severity: 'error',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] },
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-duplicate-dep-types',
      severity: 'warn',
      from: {},
      to: { moreThanOneDependencyType: true, dependencyTypesNot: ['type-only'] },
    },
    {
      name: 'not-to-spec',
      severity: 'error',
      comment:
        'Test-File-Imports gehören in __mocks__/, nicht in produktive Module.',
      from: {
        pathNot: [
          '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
          '^src/test/',
        ],
      },
      to: { path: '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$' },
    },
    {
      name: 'not-to-dev-dep',
      severity: 'error',
      comment:
        "Produktiv-Code importiert devDep. Ausnahme: webviewClient/* — wird per esbuild ins Webview-Bundle gepackt (monaco-editor, etc.), devDep ist hier korrekt.",
      from: {
        path: '^src',
        pathNot: [
          '[.](?:spec|test)[.](?:js|mjs|cjs|jsx|ts|mts|cts|tsx)$',
          '^src/test/',
          '^src/webviewClient/',
        ],
      },
      to: {
        dependencyTypes: ['npm-dev'],
        dependencyTypesNot: ['type-only'],
        pathNot: ['node_modules/@types/'],
      },
    },
    {
      name: 'optional-deps-used',
      severity: 'info',
      from: {},
      to: { dependencyTypes: ['npm-optional'] },
    },
    {
      name: 'peer-deps-used',
      severity: 'warn',
      from: {},
      to: { dependencyTypes: ['npm-peer'] },
    },
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: {
      path: [
        '^src/tiLogicVisualizer/tiSignatures\\.generated\\.ts$',
        '^src/test/__mocks__/',
      ],
    },
    detectProcessBuiltinModuleCalls: true,
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts'],
      mainFields: ['main', 'types', 'typings'],
    },
    skipAnalysisNotInRules: true,
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
      archi: {
        collapsePattern:
          '^(?:packages|src|lib(s?)|app(s?)|bin|test(s?)|spec(s?))/[^/]+|node_modules/(?:@[^/]+/[^/]+|[^/]+)',
      },
      text: { highlightFocused: true },
    },
  },
};
