import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import { splitVariableColumns } from '../../utils/processVariablesUi';
import { apiRequest, deployProcess } from '../../tm1Client';
import type { ProcessParameter, ProcessVariable, DataSource, Tm1Config } from '../../tm1Rest/transport/types';
import { getPanelTitle } from './processEditorUtils';
import { draftKeyOf, isLive, serverLabel, sessionOfPanel } from './state';
import { getExtensionContext } from '../../utils/extensionContext';
import { clearDraft } from './draftStore';
import { encodeODataKey } from '../../utils/odataKey';
import { carryStoredPassword } from '../../utils/dataSourceWire';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import { fetchProcessUiData } from '../../tm1Rest/processApi';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';

/**
 * Reads the DataSource TM1 stores for `processName`, as the server spells it.
 * Best-effort: every error path answers `undefined`.
 */
async function fetchStoredDataSource(processName: string, config: Tm1Config): Promise<DataSource | undefined> {
  try {
    const res = await apiRequest(
      'GET',
      `Processes('${encodeODataKey(processName)}')?$select=DataSource`,
      undefined,
      undefined,
      config,
    );
    if (res.statusCode !== 200) { return undefined; }
    return parseBodySafe<{ DataSource?: DataSource }>(res, {}).DataSource;
  } catch {
    return undefined;
  }
}

/**
 * Reads the encrypted ODBC password TM1 stores for `processName`. Best-effort:
 * a copy without a password is a lesser failure than a "Save as" that aborts,
 * so every error path answers `undefined`.
 */
export async function fetchStoredOdbcPassword(processName: string, config: Tm1Config): Promise<string | undefined> {
  const pw = ((await fetchStoredDataSource(processName, config)) as { password?: unknown } | undefined)?.password;
  return typeof pw === 'string' && pw !== '' ? pw : undefined;
}

/**
 * Handles save/deploy from the Monaco webview.
 * Returns true on success. With `autoSave=true`: skips the "saved" toast and
 * short-circuits when the panel is not dirty (returns true without deploy).
 */
export async function handleMonacoSave(
  panel: vscode.WebviewPanel,
  panelKey: string,
  processName: string,
  serverKey: string,
  rawSections: { prolog?: string; metadata?: string; data?: string; epilog?: string },
  webviewParameters: ProcessParameter[] | undefined,
  webviewDataSource: DataSource | undefined,
  webviewVariables: ProcessVariable[] | undefined,
  config: Tm1Config,
  autoSave: boolean = false,
  errorCount: number = 0,
  webviewHasSecurity?: boolean,
): Promise<boolean> {
  // Held for the whole save: a reopen during deploy registers a NEW session
  // under the same key, and this save must not mark that one clean.
  const session = sessionOfPanel(panel);
  if (autoSave && !session?.dirty) { return true; }
  if (errorCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Linter reports {0} error(s). Save anyway?', String(errorCount)),
      { modal: true },
      vscode.l10n.t('Save Anyway'),
    );
    if (choice !== vscode.l10n.t('Save Anyway')) {
      postTo<HostToWebview>(panel.webview, { type: 'saveCancelled' });
      return false;
    }
  }
  const sections = {
    prolog:   String(rawSections.prolog   ?? ''),
    metadata: String(rawSections.metadata ?? ''),
    data:     String(rawSections.data     ?? ''),
    epilog:   String(rawSections.epilog   ?? ''),
  };

  const stored = session?.code;
  if (!stored) {
    vscode.window.showErrorMessage(vscode.l10n.t('Internal error: process data not found.'));
    return false;
  }
  // "Security access" flag: prefer the value the webview sent; fall back to the
  // last-known stored value (autosave paths may omit it).
  const mergedHasSecurity = webviewHasSecurity ?? stored.hasSecurity;

  const mergedParameters: ProcessParameter[] = webviewParameters
    ? webviewParameters.map(p => {
        const type: 'Numeric' | 'String' = p.Type === 'Numeric' ? 'Numeric' : 'String';
        const rawValue = String(p.Value ?? '');
        // TM1 infers Parameter Type from the JSON type of Value: a quoted string
        // ("0") makes TM1 store Type=String even if we sent Type='Numeric'. For Numeric
        // parameters we therefore send Value as a JSON number.
        const value: any = type === 'Numeric'
          ? (rawValue.trim() === '' ? 0 : (Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0))
          : rawValue;
        return {
          Name: String(p.Name ?? ''),
          Type: type,
          Value: value,
          Prompt: String(p.Prompt ?? ''),
        };
      })
    : stored.parameters;

  const dataSource = webviewDataSource ?? session?.dataSource;
  const mergedVariables: ProcessVariable[] = webviewVariables
    ? webviewVariables.map(v => ({
        Name: String(v.Name ?? ''),
        Type: v.Type === 'Numeric' ? 'Numeric' : 'String',
        Position: Number(v.Position) || 0,
        StartByte: Number(v.StartByte ?? 0),
        EndByte: Number(v.EndByte ?? 0),
        // Ignore flag: dropping it here would silently turn every ignored
        // column into a processed one on the next save.
        ...(v.Ignored ? { Ignored: true } : {}),
      }))
    : stored.variables;

  // Snapshot OLD state for potential auto-rollback on compile errors.
  const oldSnapshot = {
    prolog: stored.prolog,
    metadata: stored.metadata,
    data: stored.data,
    epilog: stored.epilog,
    parameters: stored.parameters.map(p => ({ ...p })),
    variables: stored.variables.map(v => ({ ...v })),
    // Without a known DataSource the revert would leave the new one on the
    // server; read it before the save overwrites it.
    dataSource: session?.dataSource
      ?? (webviewDataSource && config ? await fetchStoredDataSource(processName, config) : undefined),
    hasSecurity: stored.hasSecurity,
  };

  try {
    await deployProcess(processName, sections, dataSource, mergedParameters, mergedVariables, config, mergedHasSecurity);

    // Server-side compile check. Compile API validates live server-state only; we
    // deployed first, so on errors we revert and surface markers (red squiggles +
    // Problems panel + F8 jump-to-line). Save is treated as failed. Both ways this
    // can go wrong — revert fails, or the compile API never answers — leave code on
    // the server, so neither may be reported as a clean save.
    if (config) {
      try {
        const { compileProcess } = await import('../../tm1Rest/processCompile');
        const errors = await compileProcess(processName, config);
        if (errors && errors.length > 0) {
          // The broken code is already on the server — we have to deploy before we can
          // compile. If the revert fails too, the server KEEPS it; reporting that as
          // "not saved" would leave the user believing the old version is still live.
          let reverted = true;
          try {
            await deployProcess(processName, {
              prolog: oldSnapshot.prolog, metadata: oldSnapshot.metadata,
              data: oldSnapshot.data, epilog: oldSnapshot.epilog,
            }, oldSnapshot.dataSource, oldSnapshot.parameters, oldSnapshot.variables, config, oldSnapshot.hasSecurity);
          } catch { reverted = false; }

          const errorsBySection: Record<string, Array<{ ruleId: string; severity: 'error'; message: string; line: number; section: string }>> = {
            prolog: [], metadata: [], data: [], epilog: [],
          };
          for (const err of errors) {
            const sec = String(err.Procedure ?? '').toLowerCase();
            if (errorsBySection[sec]) {
              errorsBySection[sec].push({
                ruleId: 'tm1-compile',
                severity: 'error',
                message: `[compile] ${err.Message}`,
                line: Math.max(1, err.LineNumber ?? 1),
                section: sec,
              });
            }
          }
          postTo<HostToWebview>(panel.webview, { type: 'compileResults', errorsBySection });
          const failMsg = reverted
            ? vscode.l10n.t('Compile error — not saved ({0}).', String(errors.length))
            : vscode.l10n.t('Compile error ({0}) — and the previous version could NOT be restored. The server still holds the broken code.', String(errors.length));
          postTo<HostToWebview>(panel.webview, { type: 'saveError', message: failMsg });
          vscode.window.showErrorMessage(failMsg);
          return false;
        }
      } catch (compileErr) {
        // Compile API unreachable. The code IS deployed — reverting would throw away a
        // save that is probably fine, so keep it, but never let this pass as validated.
        vscode.window.showWarningMessage(vscode.l10n.t('Deployed, but the server compile check could not run: {0}. The process is on the server unvalidated.', errMsg(compileErr)));
      }
    }

    // Compile clean — commit save state.
    stored.prolog = sections.prolog;
    stored.metadata = sections.metadata;
    stored.data = sections.data;
    stored.epilog = sections.epilog;
    stored.parameters = mergedParameters;
    stored.variables = mergedVariables;
    stored.hasSecurity = mergedHasSecurity;
    // The tab may have been closed during deploy/compile: `onDidDispose` already
    // dropped the session, and `panel.title` would throw "Webview is disposed"
    // and turn the successful save into an error.
    const live = !!session && isLive(session);
    if (session && webviewDataSource) {
      session.dataSource = webviewDataSource;
    }
    if (session) { session.dirty = false; }
    // The server now holds this content — a parked recovery draft would offer
    // the user stale work on the next open. Best-effort: a failed cleanup must
    // never turn a successful save into an error.
    if (session) { session.draft = undefined; }
    const draftMemento = getExtensionContext()?.globalState;
    if (draftMemento) { void clearDraft(draftMemento, draftKeyOf(serverKey, processName)).then(undefined, () => { /* nothing to recover from */ }); }
    if (live) { panel.title = getPanelTitle(processName, false, serverLabel(serverKey)); }
    postTo<HostToWebview>(panel.webview, { type: 'clearCompileResults' });
    if (!autoSave) {
      // Webview banner is the primary feedback; a transient status-bar note replaces
      // the old info-toast (Ctrl+S is the hottest action — toast would spam).
      postTo<HostToWebview>(panel.webview, { type: 'saveSuccess', message: vscode.l10n.t('Process "{0}" saved.', processName) });
      vscode.window.setStatusBarMessage(vscode.l10n.t('Process "{0}" saved.', processName), 3000);
    }
    // Git-Mirror: keep local .ti + .json in sync (only if tm1.git.enabled).
    if (config) {
      const { mirrorProcessAfterSave } = await import('../git/mirror');
      // The mirror writes the code it was given and takes the header from the
      // server. This editor state is its fallback when that read fails, so the
      // columns go in as the pair TM1 stores (ignored ones in VariablesUIData).
      const mirrored = splitVariableColumns(mergedVariables);
      void mirrorProcessAfterSave({
        name: processName,
        prolog: sections.prolog,
        metadata: sections.metadata,
        data: sections.data,
        epilog: sections.epilog,
        parameters: mergedParameters,
        variables: mirrored.Variables,
        variablesUiData: mirrored.VariablesUIData,
        dataSource: dataSource ?? { Type: 'None' },
        hasSecurity: mergedHasSecurity,
      }, config);
    }
    return true;
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('Deploy failed: {0}', errMsg(err)));
    return false;
  }
}

/**
 * Handles "Save as…" — deploys current editor state under a new process name.
 * After successful save, opens the new process in a fresh editor panel via `reopenAfterSave`
 * (a callback so this module doesn't import openPanel.ts and create a cycle).
 */
export async function handleMonacoSaveAs(
  sourceProcessName: string,
  rawSections: { prolog?: string; metadata?: string; data?: string; epilog?: string },
  webviewParameters: ProcessParameter[] | undefined,
  webviewDataSource: DataSource | undefined,
  webviewVariables: ProcessVariable[] | undefined,
  config: Tm1Config,
  errorCount: number = 0,
  reopenAfterSave: (newProcessName: string) => Promise<void>,
  webviewHasSecurity?: boolean,
): Promise<void> {
  if (errorCount > 0) {
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Linter reports {0} error(s). Save anyway?', String(errorCount)),
      { modal: true },
      vscode.l10n.t('Save Anyway'),
    );
    if (choice !== vscode.l10n.t('Save Anyway')) { return; }
  }
  const newName = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    title: vscode.l10n.t('Save process as…'),
    prompt: vscode.l10n.t('New process name'),
    value: `${sourceProcessName}_copy`,
    validateInput: v => v.trim() ? null : vscode.l10n.t('Name must not be empty.'),
  });
  if (newName === undefined) { return; }
  const targetName = newName.trim();
  if (targetName === sourceProcessName) {
    vscode.window.showWarningMessage(vscode.l10n.t('Name unchanged. Use "Save" instead.'));
    return;
  }

  try {
    const checkRes = await apiRequest(
      'GET',
      `Processes('${encodeODataKey(targetName)}')?$select=Name`,
      undefined,
      undefined,
      config,
    );
    if (checkRes.statusCode === 200) {
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Process "{0}" already exists. Overwrite?', targetName),
        { modal: true },
        vscode.l10n.t('Overwrite'),
      );
      if (choice !== vscode.l10n.t('Overwrite')) { return; }
    }
  } catch { /* ignore — deployProcess will surface real connection errors */ }

  const sections = {
    prolog:   String(rawSections.prolog   ?? ''),
    metadata: String(rawSections.metadata ?? ''),
    data:     String(rawSections.data     ?? ''),
    epilog:   String(rawSections.epilog   ?? ''),
  };

  const parameters: ProcessParameter[] = (webviewParameters ?? []).map(p => {
    const type: 'Numeric' | 'String' = p.Type === 'Numeric' ? 'Numeric' : 'String';
    const rawValue = String(p.Value ?? '');
    const value: any = type === 'Numeric'
      ? (rawValue.trim() === '' ? 0 : (Number.isFinite(Number(rawValue)) ? Number(rawValue) : 0))
      : rawValue;
    return { Name: String(p.Name ?? ''), Type: type, Value: value, Prompt: String(p.Prompt ?? '') };
  });

  const variables: ProcessVariable[] = (webviewVariables ?? []).map(v => ({
    Name: String(v.Name ?? ''),
    Type: v.Type === 'Numeric' ? 'Numeric' : 'String',
    Position: Number(v.Position) || 0,
    StartByte: Number(v.StartByte ?? 0),
    EndByte: Number(v.EndByte ?? 0),
    ...(v.Ignored ? { Ignored: true } : {}),
  }));

  // The form never carries the ODBC password (server hands it out encrypted), and
  // the merge that keeps it on a normal save has nothing to merge with for a
  // process that does not exist yet — so the copy would land without one. Fetch
  // the source process's stored ciphertext and hand it over; TM1 recognises its
  // own ciphertext and stores it verbatim (see `carryStoredPassword`).
  const dataSourceForTarget = webviewDataSource?.Type === 'ODBC'
    ? carryStoredPassword(webviewDataSource, await fetchStoredOdbcPassword(sourceProcessName, config))
    : webviewDataSource;

  // Same reason as the password above: a plain save leaves `UIData` alone because
  // PATCH does not touch what it does not name, but the copy is a POST — without
  // this the Architect wizard starts from defaults on the new process.
  const uiDataForTarget = await fetchProcessUiData(sourceProcessName, config);

  try {
    await deployProcess(targetName, sections, dataSourceForTarget, parameters, variables, config, webviewHasSecurity, uiDataForTarget);
    vscode.window.showInformationMessage(vscode.l10n.t('Process "{0}" saved as "{1}".', sourceProcessName, targetName));
    if (config) {
      const { mirrorProcessAfterSave } = await import('../git/mirror');
      const mirrored = splitVariableColumns(variables);
      void mirrorProcessAfterSave({
        name: targetName,
        prolog: sections.prolog,
        metadata: sections.metadata,
        data: sections.data,
        epilog: sections.epilog,
        parameters,
        variables: mirrored.Variables,
        variablesUiData: mirrored.VariablesUIData,
        dataSource: webviewDataSource ?? { Type: 'None' },
        hasSecurity: webviewHasSecurity ?? false,
        // It is already available here — "Save as…" fetches it anyway, because
        // a POST would otherwise not create it.
        uiData: uiDataForTarget,
      }, config);
    }
    await vscode.commands.executeCommand('tm1.refreshExplorer');
    await reopenAfterSave(targetName);
    // "Recently opened" is entered by whoever OPENS an editor — and
    // `reopenAfterSave` opens one: the one with the new name. Without this
    // line, the freshly copied process was missing from the list even though
    // it was the only one open (finding by flameY3T1, 2026-08-26). Deliberately
    // placed AFTER the reopen and inside the try branch: a failed save should
    // not leave an entry behind.
    const { recordProcessOpen } = await import('./recentBridge');
    const { getServerIdByUrl } = await import('../serverManager');
    recordProcessOpen(getServerIdByUrl(config.serverUrl), targetName);
  } catch (err) {
    vscode.window.showErrorMessage(vscode.l10n.t('"Save as" failed: {0}', errMsg(err)));
  }
}
