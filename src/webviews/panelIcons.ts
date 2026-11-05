import * as vscode from 'vscode';

/**
 * Editor-tab icon of each webview panel, from the tree's own SVGs so a tab
 * looks like the node it was opened from. Keyed by viewType; panels without an
 * entry keep VS Code's default until a fitting SVG exists.
 */
export const PANEL_ICONS: Record<string, string> = {
  tm1ProcessEditor: 'process',
  tm1NewProcess: 'process',
  'tm1.processCoverage': 'process',
  'tm1.valueNaming': 'unify-variables',
  'tm1.consistencyNormalizer': 'normalize-naming',
  'tm1.processGrouping': 'processes',
  tm1ProcessOverview: 'processes',
  tm1ProcessTemplateEditor: 'process-template',
  tm1SnippetEditor: 'snippets',
  tm1RuleEditor: 'cube-rule',
  tm1AreaDbBuilder: 'cube-rule',
  tm1CubeViewer: 'cube-view',
  tm1CubeOverview: 'cube',
  tm1CubeStatsDashboard: 'cube',
  tm1CreateCube: 'cube',
  'tm1.feederAudit': 'cube',
  tm1DimensionEditor: 'dimension-editor-tree',
  tm1DimensionBrowser: 'dimension',
  tm1DimensionOverview: 'dimension',
  tm1ApplicationOverview: 'data-file',
  'tm1.reorderDims': 'dimension',
  'tm1.consolidationCompare': 'dimension',
  tm1ChoreEditor: 'chore-active',
  tm1ChoreOverview: 'chore-calendar',
  tm1MdxRunner: 'mdx-runner',
  tm1Threads: 'thread',
  tm1MessageLog: 'message-log',
  tm1MessageLogAnalysis: 'message-log',
  tm1MessageLogStartup: 'message-log',
  tm1TransactionLog: 'transaction-log',
  'tm1.lineage': 'lineage',
  'tm1.usageGraph': 'call-graph',
  'tm1.tiConsole': 'ti-console',
  'tm1.bulkDeploy': 'bulk-deploy',
  'tm1.bulkDelete': 'bulk-delete',
  'tm1.findReplace': 'find-replace',
  'tm1.userGroupManager': 'security',
  'tm1.cubeSecurityMatrix': 'security',
  'tm1.dimSecurityMatrix': 'security',
  'tm1.processSecurityMatrix': 'security',
  'tm1.elementSecurity': 'security',
  'tm1.cellSecurityBuilder': 'security',
  tm1CellTrace: 'cell-trace',
  tm1Top: 'tm1top',
  'tm1.gitConfig': 'git-config',
  tm1Params: 'parameters',
  tm1ServerParams: 'parameters',
  'tm1.tiTestSummary': 'ti-test',
  'tm1.tiTestDiff': 'ti-test',
  'tm1.addServer': 'server-connected',
  'tm1.serverConfig': 'server-connected',
};

let _root: vscode.Uri | undefined;

/** Called once at activation — some panel managers never see the extension URI. */
export function initPanelIcons(extensionUri: vscode.Uri): void { _root = extensionUri; }

export function setPanelIcon(panel: vscode.WebviewPanel, viewType: string): void {
  const name = PANEL_ICONS[viewType];
  if (!name || !_root) { return; }
  panel.iconPath = {
    light: vscode.Uri.joinPath(_root, 'media', 'icons', 'light', `${name}.svg`),
    dark: vscode.Uri.joinPath(_root, 'media', 'icons', 'dark', `${name}.svg`),
  };
}
