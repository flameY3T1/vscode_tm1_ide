import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { WriteError } from '../../cubeViewer/cellWrite';
import { resolvePicklist } from './picklistApi';

/**
 * Translates a write error that `classifyWriteError` recognized as
 * `kind: 'picklist'` into a user message. `cellWrite.ts` stays vscode-free
 * (shared with the webview via `pureBridge`) and therefore only supplies the
 * category plus TM1's own, uninformative text — this translation belongs in
 * the host-side layer.
 *
 * Resolves the raw definition via the `resolvePicklist` cache that already
 * exists (cheap, cached) and appends the allowed values; for more than ten
 * entries, the first ten plus the total count. If the resolution fails
 * (network, dead reference — `resolvePicklist` then returns `null`), it
 * falls back to the base message without a value list, rather than
 * swallowing the cell rejection itself.
 */
export async function describePicklistRejection(
  cfg: Tm1Config, def: string | null,
): Promise<WriteError> {
  let values: string[] | null = null;
  if (def) {
    try {
      values = await resolvePicklist(cfg, def);
    } catch {
      values = null;
    }
  }
  return { kind: 'picklist', message: _picklistRejectionMessage(values) };
}

function _picklistRejectionMessage(values: string[] | null): string {
  if (!values || values.length === 0) {
    return vscode.l10n.t("This value is not on this cell's picklist.");
  }
  if (values.length > 10) {
    return vscode.l10n.t(
      "This value is not on this cell's picklist. Allowed values (first 10 of {0}): {1}",
      values.length,
      values.slice(0, 10).join(', '),
    );
  }
  return vscode.l10n.t(
    "This value is not on this cell's picklist. Allowed values: {0}",
    values.join(', '),
  );
}
