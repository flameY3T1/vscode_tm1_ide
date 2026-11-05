import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import {
  executeChore as executeChoreApi,
  createChore,
  updateChore,
  clearChoreTasks,
  choreExists,
  getChoreDetail as getChoreDetailApi,
} from '../../tm1Rest/choreApi';
import { listProcesses, getProcess } from '../../tm1Rest/processApi';
import { getChoreEditorHtml } from './choreEditorWebview';
import type { ChoreDetail, HostToWebview, WebviewToHost } from '../../webviewClient/choreEditor/protocol';
import { mapChoreDetailFromApi } from './choreEditorPure';
import {
  saveChore,
  saveChoreAs,
  ChoreSaveError,
  type ChoreSaveAsOutcome,
  type ChoreSaveDeps,
  type ChoreSaveOutcome,
  type ProcessParamDef,
} from './choreSavePure';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import { runCancellableExecution } from '../../runState/runCancellableProcess';
import { errMsg } from '../../utils/errMsg';
import { registerWindow, unregisterWindow } from '../../workbench/windowRegistry';
import { outputChannel } from '../../utils/outputChannel';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';

// Lazy-init OutputChannel — created on the first log line, so importing this
// module stays side-effect free (mirrors processEditor/deploy.ts).
let _log: vscode.OutputChannel | undefined;
function choreLog(message: string): void {
  if (!_log) { _log = outputChannel('TM1 Chore Editor'); }
  _log.appendLine(message);
}

export class ChoreEditorManager {
  private static _panels = new Map<string, vscode.WebviewPanel>();
  private static _extensionUri: vscode.Uri | null = null;

  /** Wire the extension URI so the webview shell can resolve the bundled JS via `webview.asWebviewUri`. */
  static initialize(extensionUri: vscode.Uri): void {
    this._extensionUri = extensionUri;
  }

  /** Open chore editor. Pass null for a new chore, or the chore name to edit an existing one. */
  static async open(choreName: string | null, config: Tm1Config, refreshTree: () => void): Promise<void> {
    if (!this._extensionUri) {
      throw new Error('Chore Editor not initialized — call ChoreEditorManager.initialize(extensionUri) on activation.');
    }
    const isNew = choreName === null;
    // Key prefix only: URL plus identity tag, so two profiles on one URL get two panels.
    const serverKey = `${config?.serverUrl ?? '__default__'}:@${identityTag(config)}`;
    let panelKey = `${serverKey}:${choreName ?? '__new__'}`;

    const existing = this._panels.get(panelKey);
    if (existing) {
      // Without a column argument, the panel stays in its own column.
      existing.reveal();
      return;
    }

    const serverLabel = formatServerLabel(config?.serverUrl, getServerNameByUrl);
    const baseTitle = isNew ? vscode.l10n.t('New Chore') : `Chore: ${choreName}`;
    const panelTitle = serverLabel ? `${serverLabel} : ${baseTitle}` : baseTitle;
    const panel = vscode.window.createWebviewPanel(
      'tm1ChoreEditor',
      panelTitle,
      // Symbolic column: opens in the active group and thus in the same
      // window as the click that triggered it.
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
      },
    );
    setPanelIcon(panel, 'tm1ChoreEditor');
    muteWebviewOnDispose(panel);

    this._panels.set(panelKey, panel);
    registerWindow({
      kind: 'tm1ChoreEditor', rawKey: panelKey, panel,
      serverId: config.serverUrl, target: choreName ?? undefined,
    });
    let disposed = false;
    panel.onDidDispose(() => {
      disposed = true;
      unregisterWindow(panel);
      this._panels.delete(panelKey);
    });
    panel.webview.html = getChoreEditorHtml(panel.webview, this._extensionUri);

    // Load data and send initData
    try {
      const processNames = await _fetchProcessNames(config);
      let chore: ChoreDetail | null = null;
      if (!isNew && choreName) {
        chore = await _fetchChoreDetail(choreName, config);
      }
      // StartTime is written back as a UTC (`Z`) value: TM1 preserves the absolute
      // instant (normalizing to its own standard offset) so no offset probe is needed.
      postTo<HostToWebview>(panel.webview, { type: 'initData', isNew, chore, processNames });
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('TM1: Failed to load Chore: {0}', errMsg(err)));
      panel.dispose();
      return;
    }

    // One save at a time, per panel. Both save paths run
    // deactivate → DELETE every task → PATCH the new list; two overlapping runs
    // would let the second clear delete what the first had just written. The
    // webview disables its buttons too, but that half can be bypassed (a reload,
    // or any posted message), so THIS is the lock that counts. It is taken
    // before the modal / input box, because those await user input while the
    // panel keeps receiving messages.
    let saveInFlight = false;

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      if (msg.type === 'cancel') {
        panel.dispose();
        return;
      }

      if (msg.type === 'getProcessParams') {
        try {
          const params = await _fetchProcessParams(config, msg.processName as string);
          postTo<HostToWebview>(panel.webview, { type: 'processParams', processName: msg.processName, params });
        } catch (err) {
          // Report the FAILURE, never `params: []`. An empty list is a valid
          // answer ("this process has no parameters") and used to be cached as
          // one permanently: the editor then said "ready", every parameter type
          // fell back to unknown, a numeric went out as a string, and the
          // rollback re-sent the same rejected shape — an empty chore.
          postTo<HostToWebview>(panel.webview, {
            type: 'processParams',
            processName: msg.processName,
            error: errMsg(err),
          });
        }
        return;
      }

      if (msg.type === 'saveAs') {
        if (_rejectWhenSaveInFlight(panel, saveInFlight)) { return; }
        saveInFlight = true;
        try {
          await _handleSaveAs(msg);
        } finally {
          saveInFlight = false;
        }
        return;
      }

      if (msg.type === 'save') {
        if (_rejectWhenSaveInFlight(panel, saveInFlight)) { return; }
        saveInFlight = true;
        try {
          await _handleSave(msg);
        } finally {
          saveInFlight = false;
        }
      }
    });

    // ── message handlers ─────────────────────────────────────────────────────
    // Split out of the dispatcher above so the in-flight lock can wrap the whole
    // (destructive) sequence, prompts included, in one try/finally.

    async function _handleSaveAs(msg: Extract<WebviewToHost, { type: 'saveAs' }>): Promise<void> {
      const sourceName = (msg.originalName as string) || '';
      const choreData = msg.choreData as ChoreDetail;

      // The name prompt has to live here: `window.prompt` is blocked inside a
      // webview (same reason the empty-task confirmation below is a VS Code modal).
      const answer = await vscode.window.showInputBox({
        ignoreFocusOut: true,
        title: vscode.l10n.t('Save chore as…'),
        prompt: vscode.l10n.t('New chore name'),
        value: `${sourceName || choreData.Name}_copy`,
        validateInput: v => v.trim() ? null : vscode.l10n.t('Name must not be empty.'),
      });
      // Every exit has to answer the webview, or its Save buttons — disabled for
      // the duration of the save — would stay disabled for good.
      if (answer === undefined) {
        postTo<HostToWebview>(panel.webview, { type: 'saveCancelled' });
        return;
      }
      const targetName = answer.trim();
      if (targetName === sourceName) {
        postTo<HostToWebview>(panel.webview, { type: 'saveCancelled' });
        vscode.window.showWarningMessage(vscode.l10n.t('Name unchanged. Use "Save" instead.'));
        return;
      }

      try {
        // Refuse a taken name rather than routing into the update path: that one
        // deletes the target's tasks before writing, so a mistyped name would
        // silently overwrite an unrelated chore.
        if (await choreExists(config, targetName)) {
          const taken = vscode.l10n.t('Chore "{0}" already exists — choose a different name.', targetName);
          postTo<HostToWebview>(panel.webview, { type: 'saveError', message: taken });
          vscode.window.showWarningMessage(taken);
          return;
        }

        // The copy is POSTed inactive on purpose and only then activated — see
        // `saveChoreAs`, which reports a failed activation instead of throwing.
        const outcome = await _saveChoreAs(targetName, choreData, config);
        refreshTree();
        postTo<HostToWebview>(panel.webview, { type: 'saveAsSuccess' });

        if (outcome.activateError) {
          vscode.window.showWarningMessage(vscode.l10n.t(
            'Chore "{0}" saved as "{1}", but the copy could not be activated and stays INACTIVE: {2}',
            sourceName, targetName, outcome.activateError,
          ));
        } else if (outcome.activated) {
          vscode.window.showInformationMessage(
            vscode.l10n.t('Chore "{0}" saved as "{1}" and activated.', sourceName, targetName));
        } else {
          vscode.window.showInformationMessage(
            vscode.l10n.t('Chore "{0}" saved as "{1}".', sourceName, targetName));
        }

        // Open the copy in its OWN panel and leave this one on the source chore.
        // A panel already keyed to the target name would merely be revealed by
        // `open()` and would still show its pre-save state — drop it first.
        const targetKey = `${serverKey}:${targetName}`;
        const stale = ChoreEditorManager._panels.get(targetKey);
        if (stale) {
          ChoreEditorManager._panels.delete(targetKey);
          stale.dispose();
        }
        await ChoreEditorManager.open(targetName, config, refreshTree);
      } catch (err) {
        const message = errMsg(err);
        postTo<HostToWebview>(panel.webview, { type: 'saveError', message });
        vscode.window.showErrorMessage(vscode.l10n.t('"Save as" failed: {0}', message));
      }
    }

    async function _handleSave(msg: Extract<WebviewToHost, { type: 'save' }>): Promise<void> {
      const wasNew = msg.isNew as boolean;
      const choreData = msg.choreData as ChoreDetail;
      const thenExecute = !!msg.thenExecute;

      // A load whose $expand came back empty would otherwise let "Save" wipe the
      // chore's task list without a word. Require an explicit confirmation —
      // window.confirm is blocked inside a webview, so it has to be a VS Code modal.
      if (!wasNew && (choreData.Tasks?.length ?? 0) === 0) {
        const confirmLabel = vscode.l10n.t('Save without tasks');
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Chore "{0}" would be saved WITHOUT any task — every task currently on the server would be deleted. Save anyway?',
            choreData.Name,
          ),
          { modal: true },
          confirmLabel,
        );
        if (answer !== confirmLabel) {
          postTo<HostToWebview>(panel.webview, { type: 'saveCancelled' });
          return;
        }
      }

      try {
        const outcome = await _saveChore(wasNew, msg.originalName as string, choreData, config);
        refreshTree();

        // Closed during the save: re-registering the dead panel would make
        // `existing.reveal()` throw on every later open of this chore.
        if (wasNew && !disposed) {
          ChoreEditorManager._panels.delete(panelKey);
          panelKey = `${serverKey}:${choreData.Name}`;
          ChoreEditorManager._panels.set(panelKey, panel);
        }

        if (!disposed) { panel.title = serverLabel ? `${serverLabel} : Chore: ${choreData.Name}` : `Chore: ${choreData.Name}`; }
        postTo<HostToWebview>(panel.webview, { type: 'saveSuccess', choreName: choreData.Name, wasNew });
        _warnOnIncompleteSave(choreData.Name, outcome);

        if (thenExecute) {
          void (async () => {
            try {
              const { cancelled } = await runCancellableExecution(
                vscode.l10n.t('TM1: Running Chore "{0}"…', choreData.Name), 'Chores', choreData.Name, config,
                () => executeChoreApi(config, choreData.Name),
              );
              vscode.window.showInformationMessage(
                cancelled
                  ? vscode.l10n.t('TM1: Chore "{0}" was cancelled.', choreData.Name)
                  : vscode.l10n.t('TM1: Chore "{0}" started.', choreData.Name),
              );
            } catch (err) {
              vscode.window.showErrorMessage(vscode.l10n.t('TM1: Chore "{0}" failed: {1}', choreData.Name, errMsg(err)));
            }
          })();
        } else {
          vscode.window.showInformationMessage(vscode.l10n.t('TM1: Chore "{0}" saved.', choreData.Name));
        }
      } catch (err) {
        const message = _saveErrorMessage(err);
        postTo<HostToWebview>(panel.webview, { type: 'saveError', message });
        vscode.window.showErrorMessage(vscode.l10n.t('TM1: Failed to save Chore: {0}', message));
      }
    }
  }

  static disposeAll(): void {
    for (const panel of this._panels.values()) {
      panel.dispose();
    }
    this._panels.clear();
  }

  /** Close every chore-editor panel that belongs to the given server. */
  static disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    const prefix = `${serverUrl}:`;
    const toClose: vscode.WebviewPanel[] = [];
    for (const [key, panel] of this._panels) {
      if (key.startsWith(prefix)) { toClose.push(panel); }
    }
    for (const p of toClose) { p.dispose(); }
  }
}

registerServerDisposer('choreEditor', (url) => ChoreEditorManager.disposePanelsForServer(url));

// ── API helpers ───────────────────────────────────────────────────────────────

/**
 * Refuse a save while another one is still running on the same panel.
 *
 * Returns `true` when the caller must drop the request. The webview is told via
 * `saveBusy` rather than `saveError` on purpose: `saveError` re-enables its Save
 * buttons, which would be wrong while the FIRST save is still in flight.
 */
function _rejectWhenSaveInFlight(panel: vscode.WebviewPanel, saveInFlight: boolean): boolean {
  if (!saveInFlight) { return false; }
  postTo<HostToWebview>(panel.webview, {
    type: 'saveBusy',
    message: vscode.l10n.t('A save is already running for this chore. The second request was ignored.'),
  });
  return true;
}

async function _fetchProcessNames(config: Tm1Config): Promise<string[]> {
  const items = await listProcesses(config, { select: 'Name', orderby: 'Name' });
  return items.map(p => p.Name);
}

/** Parameter definitions of a process, as the webview and the rollback need them. */
async function _fetchProcessParams(
  config: Tm1Config,
  processName: string,
): Promise<Array<ProcessParamDef & { value: string }>> {
  const proc = await getProcess(config, processName);
  return ((proc.Parameters ?? []) as any[]).map((p: any) => ({
    name: p.Name as string,
    type: p.Type === 1 || p.Type === 'Numeric' ? 'Numeric' : 'String',
    value: p.Value != null ? String(p.Value) : '',
  }));
}

async function _fetchChoreDetail(choreName: string, config: Tm1Config): Promise<ChoreDetail> {
  const { data, url } = await getChoreDetailApi(config, choreName);
  choreLog(`chore "${choreName}" loaded via ${url}`);
  return mapChoreDetailFromApi(data as unknown as Parameters<typeof mapChoreDetailFromApi>[0]);
}

/** Bind the pure save orchestration's REST hooks to the active config. */
function _saveDeps(config: Tm1Config): ChoreSaveDeps {
  return {
    createChore: body => createChore(config, body),
    updateChore: (name, body) => updateChore(config, name, body),
    clearChoreTasks: name => clearChoreTasks(config, name),
    readChore: name => _fetchChoreDetail(name, config),
    readProcessParams: name => _fetchProcessParams(config, name),
    log: choreLog,
  };
}

/**
 * Save the chore. The whole (destructive) ordering plus the rollback lives in
 * `choreSavePure.ts`; this only binds the REST calls to the active config.
 */
async function _saveChore(
  isNew: boolean,
  originalName: string,
  choreData: ChoreDetail,
  config: Tm1Config,
): Promise<ChoreSaveOutcome> {
  return saveChore(_saveDeps(config), { isNew, originalName, choreData });
}

/** Create a copy of the edited chore under `targetName` (POST inactive, then activate). */
async function _saveChoreAs(
  targetName: string,
  choreData: ChoreDetail,
  config: Tm1Config,
): Promise<ChoreSaveAsOutcome> {
  return saveChoreAs(_saveDeps(config), { targetName, choreData });
}

/** Turn a `ChoreSaveError` into a message that states what the server looks like now. */
function _saveErrorMessage(err: unknown): string {
  if (!(err instanceof ChoreSaveError)) { return errMsg(err); }
  switch (err.rollback) {
    case 'not-needed':
      return vscode.l10n.t('{0} — the chore was left unchanged.', err.detail);
    case 'restored':
      return vscode.l10n.t(
        '{0} — the previous tasks and the Active state were restored.',
        err.detail,
      );
    case 'failed':
      return vscode.l10n.t(
        '{0} — restoring the previous state FAILED as well ({1}). The chore may now be WITHOUT tasks and deactivated — check it before relying on it.',
        err.detail,
        err.rollbackDetail ?? '',
      );
    default:
      return vscode.l10n.t(
        '{0} — the previous state could not be captured beforehand, so nothing could be restored. The chore may now be WITHOUT tasks and deactivated — check it before relying on it.',
        err.detail,
      );
  }
}

/**
 * Warn when the stored task count differs from what was sent, or could not be
 * read back.
 *
 * The mismatch is checked in BOTH directions on purpose. Fewer tasks means the
 * server dropped some; MORE means the old tasks were not fully cleared and the
 * PATCH appended onto them (PATCH never replaces) — the chore then runs its
 * processes twice, which is the more damaging of the two and used to be reported
 * as a clean save.
 */
function _warnOnIncompleteSave(choreName: string, outcome: ChoreSaveOutcome): void {
  if (outcome.storedTasks < 0) {
    vscode.window.showWarningMessage(vscode.l10n.t(
      'TM1: Chore "{0}" was saved, but could not be read back for verification: {1}',
      choreName,
      outcome.readBackError ?? '',
    ));
    return;
  }
  if (outcome.storedTasks !== outcome.sentTasks) {
    vscode.window.showWarningMessage(vscode.l10n.t(
      'TM1: Chore "{0}" was saved, but the server reports {1} tasks instead of the {2} that were sent. Please re-check the chore.',
      choreName,
      String(outcome.storedTasks),
      String(outcome.sentTasks),
    ));
  }
}
