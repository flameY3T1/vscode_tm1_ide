import * as vscode from 'vscode';
import type { ProcessEditorManager } from '../commands/processEditor/manager';
import { TiDiagnosticsProvider } from '../providers/tiDiagnosticsProvider';
import { isV12Active, isV12FromServer } from '../utils/v12Mode';
import { getConfig } from '../tm1Client';
import { onServerChanged } from '../serverState/state';

/**
 * Registers V12 compatibility mode: status-bar indicator + toggle command.
 * Toggling refreshes diagnostics and broadcasts to the Process Editor.
 */
export function registerV12Mode(
  context: vscode.ExtensionContext,
  tiDiagnostics: TiDiagnosticsProvider,
  processEditorManager: ProcessEditorManager,
): void {
  const v12StatusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  v12StatusItem.command = 'tm1.toggleV12Mode';
  context.subscriptions.push(v12StatusItem);

  function updateV12StatusBar(): void {
    // A v12 server turns the rules on by itself, so the switch being off does not mean the
    // rules are off — saying "inactive" while warnings appear would be a lie.
    const cfg = getConfig();
    const enabled = isV12Active(cfg);
    const fromServer = isV12FromServer(cfg);
    v12StatusItem.text = enabled ? '$(warning) TM1 V12' : '$(check) TM1 V12';
    v12StatusItem.tooltip = fromServer
      ? vscode.l10n.t('V12 mode active because the connected server is v12 – TM1 v12-incompatible functions are flagged.')
      : enabled
        ? vscode.l10n.t('V12 mode active – TM1 v12-incompatible functions are flagged. Click to disable.')
        : vscode.l10n.t('V12 mode inactive – click to enable (flags functions that are not available in TM1 v12).');
    v12StatusItem.backgroundColor = enabled
      ? new vscode.ThemeColor('statusBarItem.warningBackground')
      : undefined;
    v12StatusItem.show();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.toggleV12Mode', async () => {
      const cfg = vscode.workspace.getConfiguration('tm1');
      const current = cfg.get<boolean>('v12Mode', false);
      await cfg.update('v12Mode', !current, vscode.ConfigurationTarget.Global);
      updateV12StatusBar();
      tiDiagnostics.refreshAll();
      processEditorManager.broadcastV12Mode();
    }),
  );

  // Connecting to (or leaving) a v12 server flips the rules without anyone touching the
  // switch, so the indicator and the existing diagnostics have to follow the connection.
  context.subscriptions.push(
    onServerChanged.event((kind) => {
      // A profile edit changes no server version; only a live session does.
      if (kind === 'profiles') { return; }
      updateV12StatusBar();
      tiDiagnostics.refreshAll();
      processEditorManager.broadcastV12Mode();
    }),
  );

  updateV12StatusBar();
}
