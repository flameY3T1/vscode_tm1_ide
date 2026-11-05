// src/commands/confirmAndRun.ts
// Shared flow of the object CRUD commands in the Explorer: optional modal
// confirmation, server config, REST call, success/error toast, tree refresh.
//
// The texts arrive fully localized from the caller — each command words its
// own sentence, only the flow is shared.
import * as vscode from 'vscode';
import { requireServerConfigOrThrow } from './serverManager';
import { invalidateCache } from '../providers/fetchNames';
import { errMsg } from '../utils/errMsg';
import type { Tm1Config } from '../tm1Rest/transport/types';

export interface ConfirmAndRunOptions {
  /** Modal confirmation. `undefined` = run without asking (create). */
  confirm?: string;
  /** Label of the confirming button. Default: "Delete". */
  confirmLabel?: string;
  serverId: string | undefined;
  run: (cfg: Tm1Config) => Promise<void>;
  /** Fully localized success text. */
  success: string;
  /** Builds the error text from the server message. */
  failure: (detail: string) => string;
  refresh: () => void;
  /**
   * `fetchNames` endpoints whose name list the call has changed
   * (e.g. `['Dimensions', 'Hierarchies']`). After success the 5-minute
   * cache for them is discarded, per server — otherwise autocomplete keeps
   * offering deleted objects and the linter considers them present.
   */
  invalidate?: string[];
  /**
   * Cleanup that may only happen after a successful call — for example
   * closing an editor on the deleted object. Runs with the resolved
   * config (the handlers only know the `serverId`, not the `serverUrl`). A
   * throw here does not turn the success into a failure.
   */
  afterSuccess?: (cfg: Tm1Config) => void;
}

/**
  * Runs `run` after the user has confirmed (if `confirm` is set).
 *
  * On failure the server message is passed through: TM1 itself rejects
  * referenced objects and states the reason — the whole design of these
  * commands hangs on that (spec §4.1).
 */
export async function confirmAndRun(o: ConfirmAndRunOptions): Promise<void> {
  if (o.confirm !== undefined) {
    const label = o.confirmLabel ?? vscode.l10n.t('Delete');
    const answer = await vscode.window.showWarningMessage(o.confirm, { modal: true }, label);
    if (answer !== label) { return; }
  }
  try {
    // Two different errors, two different sentences: a tree node without
    // `meta.serverId` is a wiring error on our side — the server may be
    // connected perfectly well. `getServerConfig` is a plain map lookup
    // and would simply find nothing for `undefined`, which would wrongly
    // make the user doubt their connection.
    const cfg = requireServerConfigOrThrow(o.serverId);
    await o.run(cfg);
    // Only after the successful call: on a failure the object still exists
    // on the server, so the cache is still correct.
    for (const endpoint of o.invalidate ?? []) {
      invalidateCache(endpoint, cfg.serverUrl);
    }
    try { o.afterSuccess?.(cfg); } catch { /* Cleanup is a side matter — the call itself succeeded. */ }
    vscode.window.showInformationMessage(o.success);
    try { o.refresh(); } catch { /* A failed tree refresh must not turn the success into an error. */ }
  } catch (err) {
    vscode.window.showErrorMessage(o.failure(errMsg(err)));
  }
}
