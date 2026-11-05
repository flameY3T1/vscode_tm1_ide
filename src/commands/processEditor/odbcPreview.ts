/**
 * ODBC datasource preview — the vscode/REST half.
 *
 * Mechanics and the measurements behind them are in {@link ./odbcPreviewPure}.
 * This file only resolves the password, runs the shared preview choreography and
 * answers the webview.
 */

import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { DataSource } from '../../utils/dataSourceWire';
import { runInlinePreview } from './previewExec';
import { buildOdbcPreviewProcess, parseRejectRows, buildPreviewHeader, toPreviewWireDataSource } from './odbcPreviewPure';
import { fetchStoredOdbcPassword } from './save';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

/** Row counts the toolbar offers. */
const DEFAULT_ROWS = 10;

/**
 * Loosely typed like the ASCII preview message: the webview sends the live form
 * state, which the protocol models as an open record.
 */
export type OdbcPreviewMessage = Record<string, unknown>;

export async function handleOdbcPreview(
  panel: vscode.WebviewPanel,
  msg: OdbcPreviewMessage,
  processName: string,
  config: Tm1Config,
): Promise<void> {
  const maxRows = Math.max(1, Math.floor(Number(msg.maxRows) || DEFAULT_ROWS));
  const ds = (msg.dataSource ?? {}) as DataSource;
  const variableNames = Array.isArray(msg.variableNames)
    ? (msg.variableNames as unknown[]).map(String)
    : [];

  try {
    // A password typed into the form wins; otherwise the stored ciphertext is
    // read back from the process. TM1 accepts its own ciphertext as a password
    // (measured), so previewing a saved process never needs the plaintext.
    const wire = toPreviewWireDataSource(ds as unknown as Record<string, unknown>);
    if (!wire.password) {
      const stored = await fetchStoredOdbcPassword(processName, config);
      if (stored) { wire.password = stored; }
    }

    const body = JSON.stringify(buildOdbcPreviewProcess(wire, maxRows));
    const run = await runInlinePreview(config, body, {
      // The capture file is TM1's own error log here — only the server knows its
      // name, and `$expand` is what hands it back.
      expandErrorLog: true,
      processName: '}tm1ide_odbcpreview',
      label: 'odbcPreview',
      describeContents: `up to ${maxRows} datasource rows`,
    });

    if (!run?.text) {
      postTo<HostToWebview>(panel.webview, {
        type: 'odbcPreview',
        error: vscode.l10n.t('The query returned no rows, or the TM1 server could not read the data source.'),
      });
      return;
    }

    const { rows, truncated } = parseRejectRows(run.text, maxRows);
    const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
    postTo<HostToWebview>(panel.webview, {
      type: 'odbcPreview',
      header: buildPreviewHeader(variableNames, colCount),
      rows,
      truncated,
    });
  } catch (err) {
    postTo<HostToWebview>(panel.webview, { type: 'odbcPreview', error: errMsg(err) });
  }
}
