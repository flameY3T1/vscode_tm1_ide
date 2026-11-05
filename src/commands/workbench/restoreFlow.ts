import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { errMsg } from '../../utils/errMsg';
import { kindOf, type ReopenContext, type WindowKind } from './windowKinds';
import { buildRestoreSummary, type RestoreResult } from './restoreSummaryPure';
import type { Workbench } from './workbenchStore';
import { listWindows } from '../../workbench/windowRegistry';

/**
 * Best-effort handle on the panel that `reopen` just opened (or revealed) —
 * no manager passes its panel through as a return value (`reopen` returns
 * `Promise<void>`), so the directory that every manager fills anyway when
 * opening is the only place where it can be found again afterward.
 * `serverId` is checked against BOTH identities — profile id
 * (`rctx.serverId`, the way the MDX runner registers) and server URL
 * (`cfg.serverUrl`, the way the other managers register) — for the same
 * reason as in `collectWindows.ts#collectCandidates`.
 */
function _findJustOpenedPanel(kind: string, target: string | undefined, cfg: Tm1Config, rctx: ReopenContext): vscode.WebviewPanel | undefined {
  const matches = listWindows().filter(w =>
    w.kind === kind && w.target === target && (w.serverId === cfg.serverUrl || w.serverId === rctx.serverId),
  );
  return matches.length > 0 ? (matches[matches.length - 1].panel as vscode.WebviewPanel) : undefined;
}

/**
 * Opens the windows ONE AFTER ANOTHER.
 *
 * Not in parallel: every window triggers REST calls, and according to
 * `docs/architecture/thread-stability.md`, TM1 binds every worker thread to
 * one connection — twelve simultaneous openings are exactly the pattern
 * that produced the thread proliferation. The request cap `tm1.maxSockets`
 * would serialize them anyway, just without a progress indicator.
 *
 * An error does NOT abort the run: that one window is missing, the rest
 * still open.
 */
export async function restoreWorkbench(wb: Workbench, cfg: Tm1Config, rctx: ReopenContext): Promise<void> {
  const results: RestoreResult[] = [];
  // The first successfully restored window is brought to the front at the
  // end (spec: "the first window is brought to the front at the end") —
  // otherwise the user ends up on the tree after restoring instead of in
  // one of the windows.
  let firstPanel: vscode.WebviewPanel | undefined;
  await vscode.window.withProgress(
    // `cancellable`: up to `MAX_WINDOWS` windows one after another, each
    // with its own REST traffic — without a cancel option, all the user
    // could do is watch.
    { location: vscode.ProgressLocation.Notification, cancellable: true, title: vscode.l10n.t('Restoring workbench "{0}"', wb.name) },
    async (progress, token) => {
      let n = 0;
      for (const w of wb.windows) {
        n++;
        // Kind and label come from a SAVED entry, i.e. from `globalState` —
        // arbitrary data, not program state. Until 2026-08-25, both lines
        // stood BEFORE the `try`, and a malformed entry let the TypeError
        // run all the way up into the `withProgress` chain: the run
        // aborted, the remaining windows never even opened, and the
        // summary message that exists exactly for this case never came
        // (review 2026-08-24, H4).
        //
        // Storage now filters such entries (`_isValidWindow`). This here is
        // the second layer: it also catches entries that get in past
        // storage, and a `label` function that throws for its own
        // reasons.
        let kind: WindowKind;
        let label: string;
        try {
          kind = kindOf(w.kind);
          label = kind.label(w);
        } catch (err) {
          results.push({
            label: vscode.l10n.t('(unreadable entry)'),
            ok: false,
            reason: vscode.l10n.t('the stored entry is malformed: {0}', errMsg(err)),
          });
          continue;
        }
        // Cancellation is checked at the top of the loop: the window
        // currently in progress is allowed to finish (a half-opened window
        // would be worse than one too many), the remaining ones are never
        // even started. They do NOT fall through the cracks, but appear as
        // their own category in the summary message — cancelled is not a
        // failure, but also not a success.
        if (token.isCancellationRequested) {
          results.push({ label, ok: false, cancelled: true });
          continue;
        }
        progress.report({ message: vscode.l10n.t('{0} of {1} — {2}', n, wb.windows.length, label) });
        if (typeof kind.reopen !== 'function') {
          results.push({ label, ok: false, reason: vscode.l10n.t('window type unknown in this version') });
          continue;
        }
        try {
          await kind.reopen(w, cfg, rctx);
          const panel = _findJustOpenedPanel(w.kind, w.target, cfg, rctx);
          // Apply the saved state if the kind has a contract for it. If
          // that fails, the window is still open — the state is a bonus,
          // not part of opening.
          if (panel && typeof kind.applyState === 'function') {
            try { kind.applyState(panel, w); } catch { /* window is up, state isn't */ }
          }
          results.push({ label, ok: true });
          if (!firstPanel) { firstPanel = panel; }
        } catch (e) {
          results.push({ label, ok: false, reason: errMsg(e) });
        }
      }
    },
  );
  // `reveal()` without an argument, not `One`/`Beside` — a restored window
  // is meant to keep its own manager's column preset (ViewColumn rule, see
  // `webviewPanelHost.ts`), not move.
  //
  // The `?.` guards against MISSING, not against DISPOSED: `reveal()` on a
  // disposed panel throws. Anyone who immediately closes the first window
  // again while restoring triggers exactly that — and it used to take the
  // summary that comes after it down with it.
  try { firstPanel?.reveal(); } catch { /* window is already closed again */ }
  const text = buildRestoreSummary(wb.name, results, {
    restored: vscode.l10n.t('Workbench "{0}" restored — {1} of {2} windows.'),
    notOpened: vscode.l10n.t('Not opened: {0}'),
    cancelled: vscode.l10n.t('Cancelled, not opened: {0}'),
    entry: vscode.l10n.t('{0} ({1})'),
  });
  // Cancelled counts as failed here: the workbench is incomplete, and that
  // should not pass as a cheerful success message.
  const incomplete = results.some(r => !r.ok);
  if (incomplete) { void vscode.window.showWarningMessage(text); }
  else { void vscode.window.showInformationMessage(text); }
}
