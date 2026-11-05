import * as vscode from 'vscode';
import { Tm1TreeDataProvider } from '../providers/tm1TreeDataProvider';
import { ProcessEditorManager } from '../commands/processEditor/manager';
import { RecentTreeProvider } from '../recentTreeProvider';
import { SnippetStorage } from '../snippets/snippetStorage';
import { ProcessTemplateStorage } from '../processTemplates/processTemplateStorage';
import { CubeStatsDashboardManager } from '../commands/cubeViewer/cubeStatsDashboard';
import { TiDiagnosticsProvider } from '../providers/tiDiagnosticsProvider';
import { OverviewPanelManager } from '../webviews/objectOverview/overviewManager';

/**
 * Shared dependencies passed to every register*() activation module.
 * Keeps extension.ts lean and avoids module-level globals.
 */
export interface ActivationContext {
  context: vscode.ExtensionContext;
  treeDataProvider: Tm1TreeDataProvider;
  processEditorManager: ProcessEditorManager;
  processOverviewManager: OverviewPanelManager;
  dimensionOverviewManager: OverviewPanelManager;
  cubeOverviewManager: OverviewPanelManager;
  recentProvider: RecentTreeProvider;
  snippetStorage: SnippetStorage;
  tplStorage: ProcessTemplateStorage;
  cubeStatsDashboardManager: CubeStatsDashboardManager;
  tiDiagnostics: TiDiagnosticsProvider;
  getActiveServer: () => string | undefined;
  getServerNameForUrl: (serverUrl: string) => string | undefined;
  resolveServerName: (serverId?: string) => string | undefined;
}
