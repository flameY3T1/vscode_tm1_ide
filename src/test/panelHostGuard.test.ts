// Guard for the panel lifecycle (lever B, 2026-08-30, source scan).
//
// `WebviewPanelHost` encapsulates what previously stood by hand in every panel module:
// the map, `reveal`, cleanup on close, fixed panel options, the
// registration in the window directory — and, the actual point,
// `disposePanelsForServer`. Twelve modules built this themselves; ten of them had
// no way to close their windows on disconnect, and therefore held on to
// a `Tm1Config` in the closure that outlived the server.
//
// The scan pins the current state: whoever calls `vscode.window.createWebviewPanel`
// directly needs a reason for it IN THIS LIST. A file list instead of
// a mere counter, because the number alone says nothing — it would stay the same
// if one migrated module falls back and another one moves forward.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

/** All production sources — `src/test` is not part of them. */
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

/** The call itself, not the word — comments do not count. */
const AUFRUF = /vscode\.window\.createWebviewPanel\s*\(/;

/**
 * Who may build without the host, and why.
 *
 * Every line is a decision, not a tolerance. Whoever writes a new panel module
 * uses `WebviewPanelHost` — or adds themselves here with a justification.
 */
const ERLAUBT: ReadonlyArray<{ file: string; grund: string }> = [
  { file: 'src/webviews/webviewPanelHost.ts', grund: 'Der Host selbst.' },

  // Own lifecycles, deliberately not migrated (see docs/architecture/webview-templates.md → Panel-Lebenslauf).
  { file: 'src/commands/chore/choreEditor.ts', grund: 'Panel-Rekeying: der Schlüssel ändert sich, während das Panel steht.' },
  { file: 'src/commands/mdx/mdxRunner.ts', grund: 'Rundruf über die eigene `_panels`-Liste.' },
  { file: 'src/commands/cubeViewer/manager.ts', grund: 'Eigener Zustands-Lebenslauf (Sicht, Achsen, Schreibpuffer).' },
  { file: 'src/commands/processEditor/openPanel.ts', grund: 'Eigener Zustands-Lebenslauf (Entwurf, Haltepunkte, Debug).' },
  { file: 'src/commands/rule/ruleEditor.ts', grund: 'Eigener Zustands-Lebenslauf (Entwurf, Monaco-Modelle).' },
  { file: 'src/commands/dimension/dimensionEditor.ts', grund: 'Eigener Zustands-Lebenslauf (nachgeladene Hierarchien).' },

  // Fixed columns + own cleanup; see `viewColumnDeliberateGuard`.
  { file: 'src/commands/messageLog.ts', grund: 'Side-by-side-Anordnung mit dem Fehlerprotokoll.' },
  { file: 'src/commands/threads.ts', grund: 'Feste Spalte Zwei, eigener Auffrisch-Takt.' },
  { file: 'src/commands/tm1Top.ts', grund: 'Feste Spalte Zwei, eigener nativer Helper und Auffrisch-Takt mit Disconnect-Trenner.' },
  { file: 'src/commands/cubeViewer/cellTracePanel.ts', grund: 'Feste Spalte Beside, Rennschutz beim Nachladen.' },

  // Built by hand, but WITH `disposePanelsForServer` — not a bug, just duplication.
  { file: 'src/commands/chore/choreOverview.ts', grund: 'Hat eigenes disposePanelsForServer; retainContextWhenHidden bewusst false.' },
  { file: 'src/commands/cubeViewer/cubeStatsDashboard.ts', grund: 'Hat eigenes disposePanelsForServer.' },
  { file: 'src/webviews/objectOverview/overviewManager.ts', grund: 'Hat eigenes disposePanelsForServer; generisches Gerüst für drei Übersichten.' },

  // No server reference, a single panel.
  { file: 'src/webviews/releaseNotesWebview.ts', grund: 'Ein statisches Panel, hält keine Tm1Config.' },
];

describe('panel lifecycle — whoever builds without WebviewPanelHost is on the list', () => {
  it('no unauthorized createWebviewPanel anywhere in src/', () => {
    const erlaubt = new Set(ERLAUBT.map(e => e.file));
    const verstoesse = produktivDateien().filter(f => !erlaubt.has(f) && AUFRUF.test(read(f)));
    expect(
      verstoesse,
      'Panel von Hand gebaut. `WebviewPanelHost` benutzen — er bringt Map, reveal,\n'
      + 'Aufräumen, feste Einstellungen, die Anmeldung im Fensterverzeichnis und vor\n'
      + 'allem `disposePanelsForServer` mit. Geht es wirklich nicht, hier eintragen\n'
      + `mit Begründung:\n${verstoesse.join('\n')}`,
    ).toEqual([]);
  });

  it('every panel without the host calls muteWebviewOnDispose — otherwise a running handler throws after close', () => {
    // On close the host swaps `panel.webview` for `deadWebview`;
    // hand-built panels must do the same (review 2026-09-27, W1/W2: cubeViewer and
    // mdxRunner posted to the closed panel after an `await`).
    const ohne = ERLAUBT
      .filter(e => e.file !== 'src/webviews/webviewPanelHost.ts')
      .filter(e => !/\bmuteWebviewOnDispose\(/.test(read(e.file)))
      .map(e => e.file);
    expect(ohne, `muteWebviewOnDispose(panel) direkt nach createWebviewPanel ergänzen:\n${ohne.join('\n')}`).toEqual([]);
  });

  it('the list is not neglected — every entry still builds a panel', () => {
    const tot = ERLAUBT.filter(e => !AUFRUF.test(read(e.file))).map(e => e.file);
    expect(tot, `Eintrag ohne createWebviewPanel — Zeile streichen:\n${tot.join('\n')}`).toEqual([]);
  });

  it('the guard distinguishes a call from a mention', () => {
    // Proof of sharpness: a header comment can NAME `createWebviewPanel`
    // without calling it — exactly that is where a plain word scan got stuck
    // while this guard was being built (back then `datasource/wizard.ts`,
    // deleted since 2026-08-30).
    expect(AUFRUF.test('const p = vscode.window.createWebviewPanel(id, t, col, o);')).toBe(true);
    expect(AUFRUF.test(' * `createWebviewPanel`-Stellen. Es hatte dieselbe Lücke:')).toBe(false);
  });
});
