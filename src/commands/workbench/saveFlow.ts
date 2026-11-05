import * as vscode from 'vscode';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { collectCandidates, candidatesToSaved, type CandidateWindow } from './collectWindows';
import { renderWorkbenchPickerBody, WORKBENCH_PICKER_CSS } from './workbenchPickerHtml';
import { MAX_WINDOWS, type WorkbenchStore } from './workbenchStore';
import type { WebviewToHost as Msg } from '../../webviewClient/workbenchPicker/protocol';

let host: WebviewPanelHost<Msg> | undefined;
let bundleRoot: vscode.Uri | undefined;

export function initializeWorkbenchPicker(extensionUri: vscode.Uri): void {
  bundleRoot = extensionUri;
  host = new WebviewPanelHost<Msg>('tm1.workbenchPicker', 'Save workbench');
  host.initialize(extensionUri);
}

/**
 * `editing` set = edit an existing workbench.
 *
 * The window then shows the UNION: the saved entries (checked, including
 * closed ones) and the currently open ones that are not in it yet
 * (unchecked). Unchecking removes, checking adds. It is saved under the
 * same `id`, so the tree node does not jump.
 */
export async function openWorkbenchPicker(
  serverId: string, serverName: string, store: WorkbenchStore, serverUrl?: string,
  editing?: { id: string; name: string },
): Promise<void> {
  if (!host || !bundleRoot) { throw new Error('initializeWorkbenchPicker() must be called before openWorkbenchPicker()'); }
  const root = bundleRoot;
  // A picker left open closes over the candidate list from the moment it was
  // first opened — `WebviewPanelHost.open()` merely REVEALS an existing panel
  // for this key, it never re-renders it. Reopening the command after windows
  // were opened/closed would otherwise silently show the stale set (and save
  // it). Disposing the stale panel first forces a fresh `host.open()` below,
  // which re-renders with a freshly collected list — simpler than plumbing a
  // "refresh this panel's body" path through the host for a one-off webview.
  // Its own key space per workbench: an edit window must not take over an
  // open save window, and vice versa.
  const panelKey = editing ? `${serverId}::edit#${editing.id}` : serverId;
  const stale = host.get(panelKey);
  if (stale) { stale.dispose(); }
  // Asks every open window for its state — concurrently, with a cap.
  const existing = editing ? (store.list(serverId).find(w => w.id === editing.id)?.windows ?? []) : undefined;
  const cands: CandidateWindow[] = await collectCandidates(serverId, serverUrl, existing);
  if (cands.length === 0) {
    void vscode.window.showInformationMessage(vscode.l10n.t('No open TM1 windows for this server.'));
    return;
  }
  const labels = {
    name: vscode.l10n.t('Workbench name'),
    save: vscode.l10n.t('Save'),
    cancel: vscode.l10n.t('Cancel'),
    other: vscode.l10n.t('Other'),
    counter: vscode.l10n.t('{0} of {1} selected · {2} possible'),
    nameLabel: vscode.l10n.t('Name'),
    overwrite: vscode.l10n.t('Overwrite'),
    all: vscode.l10n.t('All'),
    none: vscode.l10n.t('None'),
    existing: vscode.l10n.t('Already saved here:'),
    server: vscode.l10n.t('Server'),
    notOpen: vscode.l10n.t('not open'),
    editing: vscode.l10n.t('Workbench'),
  };
  // The existing names come from the same storage that the conflict check
  // further down queries — so the window shows exactly what it will run
  // into.
  const ctx = {
    serverName, existingNames: store.list(serverId).map(w => w.name),
    editingName: editing?.name,
  };
  host.open({
    key: panelKey,
    title: editing
      ? vscode.l10n.t('Edit workbench — {0}', editing.name)
      : vscode.l10n.t('Save workbench — {0}', serverName),
    html: (webview) => renderWebviewShell({
      cspSource: webview.cspSource,
      css: WORKBENCH_PICKER_CSS,
      body: renderWorkbenchPickerBody(cands, labels, ctx),
      scriptUris: [String(webview.asWebviewUri(
        vscode.Uri.joinPath(root, 'out', 'webview', 'workbenchPicker.js')))],
    }),
    onMessage: async (msg, panel) => {
      if (msg.type === 'cancel') { panel.dispose(); return; }
      const windows = candidatesToSaved(cands, msg.ids);
      if (windows.length === 0 || windows.length > MAX_WINDOWS) { return; }
      const name = msg.name || editing?.name || vscode.l10n.t('Workbench');
      // When editing, the workbench being edited is not a conflict with
      // itself — it is the target.
      const clash = store.list(serverId).find(w => w.name === name && w.id !== editing?.id);
      if (editing && !clash) {
        const self = store.list(serverId).find(w => w.id === editing.id);
        if (self) {
          await store.save({ ...self, name, savedAt: Date.now(), windows });
          panel.dispose();
          void vscode.window.showInformationMessage(
            vscode.l10n.t('Workbench "{0}" saved — {1} windows.', name, windows.length),
          );
          return;
        }
      }
      if (clash) {
        const overwrite = vscode.l10n.t('Overwrite');
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t('A workbench named "{0}" already exists.', name), { modal: true }, overwrite,
        );
        if (answer !== overwrite) { return; }
        await store.save({ ...clash, savedAt: Date.now(), windows });
      } else {
        await store.save({ id: `wb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, serverId, name, savedAt: Date.now(), windows });
      }
      panel.dispose();
      void vscode.window.showInformationMessage(
        vscode.l10n.t('Workbench "{0}" saved — {1} windows.', name, windows.length),
      );
    },
  });
}
