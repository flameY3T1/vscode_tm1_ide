import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import * as path from 'path';
import { deployProcess } from '../../tm1Client';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { pickDeployTarget } from './pickDeployTarget';
import { parseSections, toRestVariables, toRestParameters, toProUiData, toProHasSecurity } from '../../utils/proFile';
import { toRestDataSource } from './deployDataSourcePure';
import { parseParametersFromFileContent } from './processParams';
import { findUndefinedVariables, lintTiAstWithContext } from '../../tiLogicVisualizer/tiLinter';
import { renderLintMessage } from '../../providers/lintLocalize';
import { parseTiCode } from '../../tiLogicVisualizer/tiParser';
import { outputChannel } from '../../utils/outputChannel';

// Lazy-init OutputChannel — created on first .show/.appendLine call.
// Avoids the module-level vscode.* side-effect that would force every importer
// (incl. provider modules and tests) to instantiate the VS Code API at import time.
let _out: vscode.OutputChannel | undefined;
function getOut(): vscode.OutputChannel {
  if (!_out) { _out = outputChannel('TM1 Deploy'); }
  return _out;
}
const out: vscode.OutputChannel = new Proxy({} as vscode.OutputChannel, {
  get: (_t, prop) => {
    const ch = getOut();
    const v = Reflect.get(ch, prop, ch);
    return typeof v === 'function' ? v.bind(ch) : v;
  },
});

/** Parses the process name from the 602,"Name" header in a .pro file. */
export function parseProcessName(content: string): string | null {
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    const m = line.match(/^602,"(.+)"$/);
    if (m) { return m[1]; }
    // Stop as soon as we hit the Prolog section
    if (/^572,/.test(line)) { break; }
  }
  return null;
}


// toRestVariables lives in utils/proFile.ts (vscode-free) — import direct.

/** Cross-section type-mismatch check. Returns human-readable warning strings. */
function findTypeMismatches(
  sections: { prolog: string; metadata: string; data: string; epilog: string },
  content: string,
): string[] {
  const messages: string[] = [];
  // Seed with parameter types declared in the .pro header (560/561 blocks)
  const fileParams = parseParametersFromFileContent(content);
  let knownVariables: ReturnType<typeof lintTiAstWithContext>['variableTypes'] =
    new Map(fileParams.map(p => [
      p.Name.toLowerCase(),
      { type: (p.Type === 1 ? 'numeric' : 'string') as 'numeric' | 'string', firstAssignmentLine: 0 },
    ]));
  const sectionEntries: Array<[string, string]> = [
    ['Prolog',    sections.prolog],
    ['Metadata',  sections.metadata],
    ['Data',      sections.data],
    ['Epilog',    sections.epilog],
  ];
  for (const [label, code] of sectionEntries) {
    if (!code.trim()) { continue; }
    const result = parseTiCode(code);
    if (!result.ok) { continue; }
    const { diagnostics, variableTypes } = lintTiAstWithContext(result.ast, knownVariables, code);
    for (const d of diagnostics) {
      if (d.ruleId === 'type-mismatch-assignment') {
        messages.push(vscode.l10n.t('{0}, line {1}: {2}', label, d.line, renderLintMessage(d).replace('[type-mismatch-assignment] ', '')));
      }
    }
    knownVariables = variableTypes;
  }
  return messages;
}

export async function deployCommand(cfg?: Tm1Config): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage(vscode.l10n.t('No active editor found.'));
    return;
  }

  const doc = editor.document;
  const filePath = doc.fileName;
  const ext = path.extname(filePath).toLowerCase();

  if (ext !== '.ti' && ext !== '.pro') {
    vscode.window.showErrorMessage(vscode.l10n.t('Only .ti or .pro files can be deployed.'));
    return;
  }

  const content = doc.getText();
  // Prefer process name from 602 header over filename
  const processName = parseProcessName(content) ?? path.basename(filePath, ext);
  const sections    = parseSections(content);
  const dataSource  = toRestDataSource(content);
  const parameters  = toRestParameters(content);
  const variables   = toRestVariables(content);
  const hasSecurity = toProHasSecurity(content);
  const uiData      = toProUiData(content);

  if (!cfg) { cfg = await pickDeployTarget(); }
  if (!cfg) { return; } // user cancelled server selection

  out.show(true);
  out.appendLine(`[deploy] ${processName} → ${cfg.serverUrl}`);

  // No read-back of the server-side process here: it was a debug aid from the
  // datasource wire-name hunt (2026-08-16) and it dumped the whole DataSource —
  // ODBC password ciphertext included — into the output channel on every
  // deploy. The .pro-derived datasource logged below carries no password.
  out.appendLine(`[deploy] Prolog=${sections.prolog.length}chars Metadata=${sections.metadata.length}chars Data=${sections.data.length}chars Epilog=${sections.epilog.length}chars`);
  out.appendLine(`[deploy] DataSource: ${JSON.stringify(dataSource)}`);
  if (dataSource && dataSource.Type !== 'None') {
    out.appendLine(`[deploy] DataSource.Type=${dataSource.Type} Server="${dataSource.dataSourceNameForServer ?? ''}"`);
  }
  if (parameters.length > 0) {
    out.appendLine(`[deploy] Parameter: ${parameters.map(p => p.Name).join(', ')}`);
  }
  if (variables.length > 0) {
    out.appendLine(`[deploy] Variablen: ${variables.map(v => v.Name).join(', ')}`);
  }

  // Pre-deploy: check for parse errors and undefined variables
  const paramNames = new Set(parameters.map(p => p.Name));
  // Ignored columns never reach the TI code — they must not count as defined.
  const dsVarNames = new Set(variables.filter(v => !v.Ignored).map(v => v.Name));
  // For .ti files or .pro files without section markers, parseSections returns empty strings.
  // In that case treat the entire file content as the prolog section for validation purposes.
  const allSectionsEmpty = !sections.prolog && !sections.metadata && !sections.data && !sections.epilog;
  const sectionsForCheck = allSectionsEmpty
    ? { prolog: content, metadata: '', data: '', epilog: '' }
    : sections;

  const sectionLabels: Array<[string, string]> = [
    ['Prolog', sectionsForCheck.prolog],
    ['Metadata', sectionsForCheck.metadata],
    ['Data', sectionsForCheck.data],
    ['Epilog', sectionsForCheck.epilog],
  ];
  const parseErrors: string[] = [];
  for (const [label, code] of sectionLabels) {
    if (!code.trim()) { continue; }
    const result = parseTiCode(code);
    if (!result.ok) {
      parseErrors.push(vscode.l10n.t('{0} (line {1}): {2}', label, result.error.line, result.error.message));
    }
  }
  if (parseErrors.length > 0) {
    await vscode.window.showErrorMessage(
      vscode.l10n.t('TM1: Deploy not possible — syntax error in the code:\n\n{0}', parseErrors.map(e => `• ${e}`).join('\n')),
      { modal: true },
      'OK',
    );
    return;
  }

  const undefinedVars = findUndefinedVariables(sectionsForCheck, paramNames, dsVarNames);
  if (undefinedVars.length > 0) {
    const varList = undefinedVars.map(v => `• ${v.name}`).join('\n');
    await vscode.window.showErrorMessage(
      vscode.l10n.t('TM1: Deploy not possible — the following variables are not defined:\n\n{0}', varList),
      { modal: true },
      'OK',
    );
    return;
  }

  const typeMismatches = findTypeMismatches(sectionsForCheck, content);
  if (typeMismatches.length > 0) {
    const list = typeMismatches.map(m => `• ${m}`).join('\n');
    const DEPLOY = vscode.l10n.t('Deploy');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('TM1: Type inconsistency found — the same variable is used as Numeric and String in the process:\n\n{0}\n\nDeploy anyway?', list),
      { modal: true },
      DEPLOY,
      vscode.l10n.t('Cancel'),
    );
    if (choice !== DEPLOY) { return; }
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: vscode.l10n.t('TM1: Deploying {0} → {1}...', processName, cfg.serverUrl),
      cancellable: false,
    },
    async () => {
      try {
        await deployProcess(processName, sections, dataSource, parameters, variables, cfg, hasSecurity, uiData);
        out.appendLine(`[deploy] OK`);
      } catch (err) {
        out.appendLine(`[deploy] FEHLER: ${errMsg(err)}`);
        throw err;
      }
    }
  );

  vscode.window.showInformationMessage(vscode.l10n.t('TM1: "{0}" deployed successfully.', processName));
}

export { pickDeployTarget };
