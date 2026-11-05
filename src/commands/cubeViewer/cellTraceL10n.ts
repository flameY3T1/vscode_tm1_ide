// src/commands/cubeViewer/cellTraceL10n.ts
import * as vscode from 'vscode';
import type { L10nMap } from '../../webviewClient/_shared/l10n';

export function buildCellTraceL10n(): L10nMap {
  return {
    traceTitle: vscode.l10n.t('Cell trace: {0}'),
    // Tabs — one panel per cell, one tab per question you can ask about it.
    traceTabRule: vscode.l10n.t('Calculation'),
    traceTabRuleHint: vscode.l10n.t('How this cell value is calculated (rules and consolidation)'),
    traceTabFeeders: vscode.l10n.t('Feeders'),
    traceTabFeedersHint: vscode.l10n.t('Which cells this cell feeds'),
    traceTabCheck: vscode.l10n.t('Check feeders'),
    traceTabCheckHint: vscode.l10n.t('Whether every component of this consolidation is fed'),
    traceCalculation: vscode.l10n.t('Calculation'),
    traceComponentCount: vscode.l10n.t('{0} components'),
    traceExpandAll: vscode.l10n.t('Expand all'),
    traceCollapseAll: vscode.l10n.t('Collapse all'),
    traceColCell: vscode.l10n.t('Cell'),
    traceColValue: vscode.l10n.t('Value'),
    traceColFed: vscode.l10n.t('Fed'),
    traceFedYes: vscode.l10n.t('Fed'),
    traceFedNo: vscode.l10n.t('Not fed'),
    traceShowMore: vscode.l10n.t('… {0} more'),
    traceFeederStatements: vscode.l10n.t('Feeder statements'),
    traceFedCells: vscode.l10n.t('Fed cells'),
    traceNoFeeders: vscode.l10n.t('This cell feeds nothing.'),
    traceAllFed: vscode.l10n.t('All consolidation components are properly fed.'),
    traceUnfed: vscode.l10n.t('Improperly fed components'),
    traceZeroToggle: vscode.l10n.t('Show zero cells'),
    traceLoading: vscode.l10n.t('Tracing…'),
    traceSimpleEmpty: vscode.l10n.t('This cell is a plain leaf value — no calculation to trace.'),
    traceRuleLabel: vscode.l10n.t('Rule'),
    traceFeederLabel: vscode.l10n.t('Feeder'),
    traceLineLink: vscode.l10n.t('Line {0}'),
  };
}
