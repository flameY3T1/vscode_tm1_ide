// Guard: every panel that is tied to a server must close on disconnect.
//
// Occasion, 2026-08-30: the user clicked once and found "Reorder Dimensions"
// still open after disconnecting. At that point the module already sat on
// `WebviewPanelHost` — so it was not the blueprint that was missing, but the
// path. A recount found FIVE windows with the same gap (reorder, the cell
// security builder, the two log analyses; plus the Git dialog, which stays on
// purpose).
//
// `panelHostGuard` does NOT cover this: it checks who builds a panel by hand.
// A module can sit on the host perfectly well and still have no disposer —
// that is the quieter half of the same bug.
//
// Two conditions, because one alone is of no use:
//   (a) the module must call `disposePanelsForServer` at all, and
//   (b) its key must start with a server identifier. The host only
//       closes what matches `serverId` or starts with `${serverId}::` —
//       a key like `cubeName` is never hit, not even by a correctly
//       registered guard. That is exactly how "Reorder Dimensions" was.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function produktivDateien(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (path.relative(SRC, full) === 'test') { continue; }
        walk(full);
      } else if (e.isFile() && full.endsWith('.ts')) {
        out.push(path.relative(ROOT, full).split(path.sep).join('/'));
      }
    }
  };
  walk(SRC);
  return out;
}

/** Whoever builds a host keeps panels — and must get rid of them on disconnect. */
const BAUT_HOST = /new WebviewPanelHost/;
// The CALL, not the mention: the header comments of these modules like to
// explain what `disposePanelsForServer` does. While this guard was being built,
// exactly that let a planted violation through — the guard had been removed,
// the explanatory sentence above it had stayed, and the scan took that as clean.
const HAT_TRENNER = /disposePanelsForServer\s*\(/;

/**
 * Panels without a server binding. Every line is a decision with a reason, not
 * a tolerance — whatever is listed here may survive a disconnect.
 */
const OHNE_SERVERBEZUG: ReadonlyArray<{ file: string; grund: string }> = [
  {
    file: 'src/commands/serverConfig/addServerPanel.ts',
    grund: 'Die Maske zum Anlegen/Bearbeiten eines Profils. Sie hängt an keiner '
         + 'Verbindung — beim Trennen zuzugehen wäre der Fehler, nicht das Ziel.',
  },
  {
    file: 'src/commands/workbench/saveFlow.ts',
    grund: 'Auswahlfenster des Fensterspeichers; kurzlebig, hält keine Tm1Config.',
  },
  {
    file: 'src/commands/git/gitConfigPanel.ts',
    grund: 'Git-Einstellungen eines PROFILS. Hält keine Tm1Config (schlägt Profil '
         + 'und Git-Satz bei jeder Nachricht frisch nach), und die Einstellungen '
         + 'zu bearbeiten setzt keine offene Verbindung voraus.',
  },
  {
    file: 'src/webviews/tiTestDiffWebview.ts',
    grund: 'Schlüssel ist ein Prüfordner auf der Platte. Ein aufgezeichneter Lauf '
         + 'gehört keinem Server.',
  },
  {
    file: 'src/webviews/tiTestSummaryWebview.ts',
    grund: 'Wie die Diff-Ansicht: Ordner statt Server.',
  },
  {
    file: 'src/snippets/snippetEditor.ts',
    grund: 'Snippets liegen im globalState; Schlüssel ist die Snippet-Id.',
  },
  {
    file: 'src/processTemplates/processTemplateEditor.ts',
    grund: 'Vorlagen liegen im globalState; Schlüssel ist die Vorlagen-Id.',
  },
];

/**
 * A key is fine if it STARTS with a server identifier.
 *
 * Both forms occur and both are correct: the server URL (then the disposer
 * clears directly) and the `serverId` (then the disposer resolves URL→Id,
 * which is how the five security matrices do it). Names coming from a variable
 * (`key: panelKey`, `key: key`) cannot be interpreted by the scan — those are
 * listed by name below, together with the place where they are built.
 */
const SCHLUESSEL_OK = /^(`\$\{[A-Za-z_$][\w$.]*\.serverUrl\}|`\$\{serverUrl\}|serverId\b)/;

/** Keys that come from a variable — checked by hand. */
const GEPRUEFTE_VARIABLEN: ReadonlyArray<{ file: string; ausdruck: string; gebildet: string }> = [
  { file: 'src/commands/dimension/dimensionBrowser.ts', ausdruck: 'panelKey',
    gebildet: '`${cfg.serverUrl}::dim#…` bzw. `::sel#<n>`' },
  { file: 'src/webviews/consolidationCompareWebview.ts', ausdruck: 'key',
    gebildet: 'const key = `${cfg.serverUrl}::cc#${dim}`' },
  { file: 'src/commands/messageLogAnalysis.ts', ausdruck: 'key',
    gebildet: 'const key = serverCfg.serverUrl' },
  { file: 'src/commands/messageLogStartup.ts', ausdruck: 'key',
    gebildet: 'const key = serverCfg.serverUrl' },
  { file: 'src/commands/security/elementSecurity.ts', ausdruck: 'key',
    gebildet: 'panelKey(serverId, dimName)' },
  { file: 'src/commands/serverConfig/serverConfigEditor.ts', ausdruck: 'key',
    gebildet: 'keyOf(cfg) = `${cfg.serverUrl}::${benutzer}|…`' },
  { file: 'src/references/showUsageGraph.ts', ausdruck: 'key',
    gebildet: 'panelKey(cfg.serverUrl, art, name) = `${url}::${art}::${name}`' },
  { file: 'src/webviews/feederAuditWebview.ts', ausdruck: 'key',
    gebildet: 'keyOf(serverUrl, cube, art) = `${serverUrl}::feeder#<art>#<cube>`' },
  { file: 'src/webviews/findReplaceWebview.ts', ausdruck: 'key',
    gebildet: 'keyOf(cfg) = `${cfg.serverUrl}::@<identityTag>`' },
  { file: 'src/webviews/tiConsistencyWebview.ts', ausdruck: 'key',
    gebildet: 'const key = cfg.serverUrl' },
  { file: 'src/commands/v12Readiness/panel.ts', ausdruck: 'key',
    gebildet: 'const key = entry.cfg.serverUrl' },
  { file: 'src/webviews/tiValueNamingWebview.ts', ausdruck: 'key',
    gebildet: 'const key = cfg.serverUrl' },
  { file: 'src/webviews/tiConsoleWebview.ts', ausdruck: 'key',
    gebildet: '`${cfg.serverUrl}::ti#<serverId>`' },
  { file: 'src/webviews/processGroupingWebview.ts', ausdruck: 'key',
    gebildet: 'const key = args.serverId' },
  { file: 'src/webviews/bulkDeleteWebview.ts', ausdruck: 'key',
    gebildet: '`${cfg.serverUrl}::bulk#<serverId>`' },
  { file: 'src/webviews/bulkDeployWebview.ts', ausdruck: 'key',
    gebildet: '`${cfg.serverUrl}::deploy#<serverId>`' },
  { file: 'src/commands/processCoverage.ts', ausdruck: 'key',
    gebildet: '`${cfg.serverUrl}::@<identityTag>:coverage#<prozess>`' },
];

/**
 * All `key` arguments of a module, as text.
 *
 * Two spellings, both common: written out (`key: ausdruck,`) and the
 * shorthand (`key,`) when the variable already has that name. Overlooking the
 * shorthand alone cost a full pass while this guard was being built — three
 * modules then yielded no key at all, and the scan silently took them as
 * clean.
 */
function schluessel(text: string): string[] {
  const out: string[] = [];
  const re = /^\s*key:\s*(.+?),\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) { out.push(m[1]); }
  const kurz = /^\s*key,\s*$/gm;
  while (kurz.exec(text) !== null) { out.push('key'); }
  return out;
}

describe('Panel disposer — whatever is tied to the server closes on disconnect', () => {
  it('registers the native TM1 Top disposer in the server disconnect path', () => {
    const tm1Top = read('src/commands/tm1Top.ts');
    expect(tm1Top).toContain("registerServerDisposer('tm1TopPanel', (url) => disposeTm1TopPanelForServer(url))");
    expect(tm1Top).toMatch(/export function disposeTm1TopPanelForServer\s*\(/);
  });

  // Review A4 (2026-10-05): disposers are registered by the module that owns
  // the panels or cache, not collected in extension.ts. Every module that
  // registers is statically imported from extension.ts, so the registration
  // still happens at activation, as before.
  it('extension.ts registers no disposer itself', () => {
    expect(read('src/extension.ts')).not.toMatch(/registerServerDisposer\s*\(/);
  });

  it('every exported dispose*ForServer is wired into a registerServerDisposer call', () => {
    // Full text of every registerServerDisposer(...) call, balanced parentheses.
    const calls: string[] = [];
    for (const f of produktivDateien()) {
      const text = read(f);
      const re = /registerServerDisposer\s*\(/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        let depth = 0;
        let i = m.index + m[0].length - 1;
        for (; i < text.length; i++) {
          if (text[i] === '(') { depth++; } else if (text[i] === ')' && --depth === 0) { break; }
        }
        calls.push(text.slice(m.index, i + 1));
      }
    }
    // Called from a registered disposer, not registered on its own.
    const reachedIndirectly = new Set([
      'disposeAllForServer',              // the registry itself
      'disposePicklistCachesForServer',   // via disposePicklistStateForServer (picklistWiring.ts)
    ]);
    const unwired: string[] = [];
    for (const f of produktivDateien()) {
      for (const m of read(f).matchAll(/export (?:async )?function (dispose\w*ForServer)\s*\(/g)) {
        const name = m[1];
        if (reachedIndirectly.has(name)) { continue; }
        if (!calls.some(c => new RegExp(`\\b${name}\\s*\\(`).test(c))) { unwired.push(`${f}: ${name}`); }
      }
    }
    expect(calls.length).toBeGreaterThan(30);
    expect(unwired, `Disposer never registered — add registerServerDisposer next to it:\n${unwired.join('\n')}`).toEqual([]);
  });
  const hosts = produktivDateien().filter(f => BAUT_HOST.test(read(f)));

  it('there are host modules to check at all', () => {
    // Without this, a scan that finds nothing could not be told apart from a
    // broken scan.
    expect(hosts.length).toBeGreaterThan(20);
  });

  it('every host module has a disposer or a reason', () => {
    const ausgenommen = new Set(OHNE_SERVERBEZUG.map(e => e.file));
    const ohne = hosts.filter(f => !ausgenommen.has(f) && !HAT_TRENNER.test(read(f)));
    expect(
      ohne,
      'Host-Modul ohne `disposePanelsForServer`. Beim Trennen bleibt das Fenster\n'
      + 'stehen und hält seine Tm1Config fest. Trenner ergänzen UND im eigenen\n'
      + 'Modul per `registerServerDisposer` anmelden —\n'
      + `oder hier mit Grund eintragen:\n${ohne.join('\n')}`,
    ).toEqual([]);
  });

  it('the exception list has not gone stale', () => {
    const tot = OHNE_SERVERBEZUG.filter(e => !BAUT_HOST.test(read(e.file))).map(e => e.file);
    expect(tot, `Eintrag ohne WebviewPanelHost — Zeile streichen:\n${tot.join('\n')}`).toEqual([]);
  });

  it('server-bound keys start with the server identifier', () => {
    const ausgenommen = new Set(OHNE_SERVERBEZUG.map(e => e.file));
    const perHand = new Set(GEPRUEFTE_VARIABLEN.map(e => `${e.file}|${e.ausdruck}`));
    const schlecht: string[] = [];
    for (const f of hosts) {
      if (ausgenommen.has(f)) { continue; }
      for (const k of schluessel(read(f))) {
        if (perHand.has(`${f}|${k}`)) { continue; }
        if (!SCHLUESSEL_OK.test(k)) { schlecht.push(`${f}  →  key: ${k}`); }
      }
    }
    expect(
      schlecht,
      'Schlüssel ohne Serverbezeichner am Anfang. `disposePanelsForServer` trifft\n'
      + 'nur, was der serverId GLEICH ist oder mit `${serverId}::` BEGINNT — ein\n'
      + 'Schlüssel wie `cubeName` wird auch von einer angemeldeten Wache nie\n'
      + `getroffen:\n${schlecht.join('\n')}`,
    ).toEqual([]);
  });

  it('the hand-checked variable keys are still written that way', () => {
    const fehlend = GEPRUEFTE_VARIABLEN
      .filter(e => !schluessel(read(e.file)).includes(e.ausdruck))
      .map(e => `${e.file}: key: ${e.ausdruck}`);
    expect(
      fehlend,
      `Eintrag passt nicht mehr — nachsehen und Zeile berichtigen:\n${fehlend.join('\n')}`,
    ).toEqual([]);
  });

  it('the guard detects a planted violation', () => {
    // Proof of sharpness against the real failure pattern of 2026-08-30.
    expect(HAT_TRENNER.test('  host.disposePanelsForServer(serverUrl);')).toBe(true);
    expect(HAT_TRENNER.test(' * `disposePanelsForServer` findet ein Panel nur,')).toBe(false);
    expect(SCHLUESSEL_OK.test('cubeName')).toBe(false);
    expect(SCHLUESSEL_OK.test('`${cfg.serverUrl}::${cubeName}`')).toBe(true);
    expect(SCHLUESSEL_OK.test('serverId')).toBe(true);
  });
});
