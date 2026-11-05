import * as vscode from 'vscode';
import { errMsg } from '../../utils/errMsg';
import * as path from 'path';
import * as fs from 'fs';
import { listProcesses, getProcess, PROCESS_FULL_SELECT } from '../../tm1Rest/processApi';
import { pickDeployTarget } from './deploy';
import { getServerConfig } from '../../serverState/state';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';
import { sanitizeFilename } from '../../git/sanitize';
import { redactPassword } from '../../utils/dataSourceWire';
import { mergeVariableColumns, splitVariableColumns, type VariableColumn } from '../../utils/processVariablesUi';

// TM1 REST API DataSource.Type → .pro 562 code
const DS_TYPE_MAP: Record<string, string> = {
  'None': 'NULL',
  'ASCII': 'CHARACTERDELIMITED',
  'ODBC': 'ODBC',
  'TM1CubeView': 'VIEW',
  'TM1DimensionSubset': 'SUBSET',
  'TM1CubeViewAsDataSource': 'VIEW',
};

function countLines(code: string): number {
  if (!code) { return 0; }
  return code.split('\n').length;
}

function q(s: string): string {
  return `"${(s ?? '').replace(/"/g, '""')}"`;
}

interface TiParam { Name: string; Type: number; Value: string; Prompt: string; }


function buildDatasourceBlock(ds: any): string[] {
  if (!ds || !ds.Type || ds.Type === 'None') {
    return [
      '562,"NULL"',
      '586,',
      '585,',
      '564,',
      '565,',
      '559,1',
      '928,0',
      '593,',
      '594,',
      '595,',
      '597,',
      '598,',
      '596,',
      '800,',
      '801,',
      '566,0',
      '567,","',
      '588,","',
      '589,"."',
      '568,""""',
      '570,',
      '571,',
      '569,0',
      '592,0',
      '599,1000',
    ];
  }

  const proType = DS_TYPE_MAP[ds.Type] ?? 'NULL';
  const dsName = ds.DataSourceNameForServer ?? ds.dataSourceNameForServer ?? '';
  const dsNameClient = ds.DataSourceNameForClient ?? ds.dataSourceNameForClient ?? dsName;
  const userName = ds.UserName ?? ds.userName ?? '';
  const password = ds.Password ?? ds.password ?? '';
  const query = ds.Query ?? ds.query ?? '';
  const delimiter = ds.Delimiter ?? ds.delimiter ?? ',';
  const quoteChar = ds.QuoteCharacter ?? ds.quoteCharacter ?? '"';
  const decimalSep = ds.DecimalSeparator ?? ds.decimalSeparator ?? '.';
  const thousandSep = ds.ThousandSeparator ?? ds.thousandSeparator ?? ',';
  const usesUnicode = ds.UsesUnicode ?? ds.usesUnicode;
  const headerSkip = ds.NumberOfHeaderRecordsToSkip ?? ds.headerRecordsToSkip ?? 0;
  const view = ds.View ?? ds.view ?? '';
  const subset = ds.Subset ?? ds.subset ?? '';
  const viewSubset = view || subset;

  const sqlLines = query ? query.replace(/\r\n/g, '\n').split('\n') : [];

  return [
    `562,${q(proType)}`,
    // 586 = name for the server, 585 = name for the client — as TM1 writes it
    // and as `datasource/parse.ts` reads it back.
    `586,${q(dsName)}`,
    `585,${q(dsNameClient)}`,
    `564,${userName}`,
    `565,${password ? q(password) : ''}`,
    // Unicode flag. Used to be hardcoded `559,1` — that made an ODBC source
    // with Unicode switched off come out of the export as switched on, and the
    // next deploy flipped it on the server (`deployDataSourcePure` sends
    // `UsesUnicode` from exactly this line). REST carries the field ONLY for
    // ODBC; for everything else it stays at 1 as before.
    `559,${proType === 'ODBC' && usesUnicode === false ? 0 : 1}`,
    '928,0',
    '593,',
    '594,',
    '595,',
    '597,',
    '598,',
    '596,',
    '800,',
    '801,',
    `566,${sqlLines.length}`,
    ...sqlLines,
    `567,${q(delimiter)}`,
    `588,${q(decimalSep)}`,
    `589,${q(thousandSep)}`,
    `568,${q(quoteChar)}`,
    `570,${viewSubset}`,
    '571,',
    `569,${headerSkip}`,
    '592,0',
    '599,1000',
  ];
}

function buildParamBlocks(params: TiParam[]): string[] {
  const lines: string[] = [];

  lines.push(`560,${params.length}`);
  for (const p of params) { lines.push(p.Name); }

  lines.push(`561,${params.length}`);
  for (const p of params) { lines.push(String(p.Type)); }

  lines.push(`590,${params.length}`);
  for (const p of params) {
    const val = p.Type === 2 ? `"${p.Value}"` : p.Value;
    lines.push(`${p.Name},${val}`);
  }

  lines.push(`637,${params.length}`);
  for (const p of params) { lines.push(`${p.Name},"${p.Prompt}"`); }

  return lines;
}

/**
 * Blocks 577–581 describe the variables the process USES; block 582 mirrors
 * `VariablesUIData` and therefore has one line per SOURCE column — including the
 * ones set to Contents="Ignore", whose names exist nowhere else. The two counts
 * differ whenever a column is ignored, exactly as in the REST payload.
 */
function buildVariableBlocks(cols: VariableColumn[]): string[] {
  const { Variables, VariablesUIData } = splitVariableColumns(cols);
  const lines: string[] = [];

  lines.push(`577,${Variables.length}`);
  for (const v of Variables) { lines.push(v.Name); }

  lines.push(`578,${Variables.length}`);
  for (const v of Variables) { lines.push(v.Type === 'Numeric' ? '1' : '2'); }

  lines.push(`579,${Variables.length}`);
  for (const v of Variables) { lines.push(String(v.Position)); }

  lines.push(`580,${Variables.length}`);
  for (const v of Variables) { lines.push(String(v.StartByte)); }

  lines.push(`581,${Variables.length}`);
  for (const v of Variables) { lines.push(String(v.EndByte)); }

  lines.push(`582,${VariablesUIData.length}`);
  for (const entry of VariablesUIData) { lines.push(entry); }

  return lines;
}

export function buildProFile(p: any): string {
  const name: string = p.Name ?? '';
  const prolog   = (p.PrologProcedure   ?? '').replace(/\r\n/g, '\n').trimEnd();
  const metadata = (p.MetadataProcedure ?? '').replace(/\r\n/g, '\n').trimEnd();
  const data     = (p.DataProcedure     ?? '').replace(/\r\n/g, '\n').trimEnd();
  const epilog   = (p.EpilogProcedure   ?? '').replace(/\r\n/g, '\n').trimEnd();

  const params: TiParam[] = (p.Parameters ?? []).map((param: any) => ({
    Name:   param.Name  ?? '',
    Type:   param.Type === 'Numeric' || param.Type === 1 ? 1 : 2,
    Value:  String(param.Value ?? ''),
    Prompt: param.Prompt ?? param.Name ?? '',
  }));

  const vars: VariableColumn[] = mergeVariableColumns(
    (p.Variables ?? []).map((v: any, idx: number) => ({
      Name:      v.Name ?? '',
      Type:      (v.Type === 'Numeric' || v.Type === 1 ? 'Numeric' : 'String') as 'Numeric' | 'String',
      Position:  v.Position ?? (idx + 1),
      StartByte: v.StartByte ?? 0,
      EndByte:   v.EndByte ?? 0,
    })),
    p.VariablesUIData,
  );

  const lines: string[] = [];

  // Header
  lines.push('601,100');
  lines.push(`602,"${name}"`);

  // Datasource block
  // Password stripped: the ciphertext is portable across servers, so it must not
  // land in an exported file. See `utils/dataSourceWire#redactPassword`. Nothing
  // is lost — the .pro READ path (`utils/proFile#toRestDataSource`) has never
  // carried a password, so line 565 was write-only anyway.
  lines.push(...buildDatasourceBlock(redactPassword(p.DataSource)));

  // Parameters
  lines.push(...buildParamBlocks(params));

  // Variables
  lines.push(...buildVariableBlocks(vars));

  // 603 is 0 in every file TM1 writes; HasSecurityAccess lives in footer line 1217.
  lines.push('603,0');

  // Code sections
  const addSection = (code: string, sectionCode: number) => {
    lines.push(`${sectionCode},${code ? countLines(code) : 0}`);
    if (code) { lines.push(code); }
  };
  addSection(prolog,   572);
  addSection(metadata, 573);
  addSection(data,     574);
  addSection(epilog,   575);

  // UIData / footer — Architect's wizard state, verbatim including its form-feed
  // separators. The fallback is what TM1 itself writes for a process the wizard
  // never touched; it is only reached when the server hands out no UIData at all
  // (108 of 328 processes live), never as a stand-in for a value we failed to read.
  const uiData: string = p.UIData ?? '';
  lines.push(`576,${uiData.includes('CubeAction=') ? uiData : 'CubeAction=1511\fDataAction=1503\fCubeLogChanges=0\f'}`);

  // Trailing metadata codes (static defaults matching TM1 export)
  lines.push(
    '930,0',
    `638,${params.length > 0 ? 1 : 0}`,
    '804,0',
    `1217,${p.HasSecurityAccess ? 1 : 0}`,
    '900,',
    '901,',
    '902,',
    '938,0',
    '937,',
    '936,',
    '935,',
    '934,',
    '932,0',
    '933,0',
    '903,',
    '906,',
    '929,',
    '907,',
    '908,',
    '904,0',
    '905,0',
    '909,0',
    '911,',
    '912,',
    '913,',
    '914,',
    '915,',
    '916,',
    '917,0',
    '918,1',
    '919,0',
    '920,50000',
    '921,""',
    '922,""',
    '923,0',
    '924,""',
    '925,""',
    '926,""',
    '927,""',
  );

  return lines.join('\r\n') + '\r\n';
}

export async function loadProcessesCommand(): Promise<void> {
  const cfg = await pickDeployTarget();
  if (!cfg) { return; }

  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Save here'),
    title: vscode.l10n.t('Select folder for TI processes'),
    defaultUri,
  });
  if (!picked || picked.length === 0) { return; }
  const targetDir = picked[0].fsPath;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('TM1: Loading processes…'), cancellable: false },
    async (progress) => {
      progress.report({ message: vscode.l10n.t('Fetching process list…') });

      // Without the explicit select TM1 omits both UIData properties, and the
      // exported .pro would drop every ignored column and the wizard state.
      const processes: any[] = await listProcesses(cfg, { select: PROCESS_FULL_SELECT }, 120000);
      let saved = 0;

      for (let i = 0; i < processes.length; i++) {
        const p = processes[i];
        progress.report({
          message: `${p.Name} (${i + 1}/${processes.length})`,
          increment: 100 / processes.length,
        });

        const content = buildProFile(p);
        const filePath = path.join(targetDir, `${sanitizeFilename(p.Name)}.pro`);
        fs.writeFileSync(filePath, content, 'utf8');
        saved++;
      }

      vscode.window.showInformationMessage(
        vscode.l10n.t('TM1: {0} processes saved to "{1}".', String(saved), targetDir),
        vscode.l10n.t('Open folder')
      ).then(action => {
        if (action === vscode.l10n.t('Open folder')) {
          vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetDir), { forceNewWindow: false });
        }
      });
    }
  );
}

export async function exportSelectedProcessesCommand(
  node?: Tm1TreeNode,
  selection?: Tm1TreeNode[],
): Promise<void> {
  const all: Tm1TreeNode[] = (selection && selection.length > 0)
    ? selection
    : (node ? [node] : []);
  const processNodes = all.filter(n => n?.nodeType === 'process' && n?.meta?.processName);
  if (processNodes.length === 0) {
    vscode.window.showErrorMessage(vscode.l10n.t('No processes selected.'));
    return;
  }

  const sourceServerIds = Array.from(new Set(processNodes.map(n => n.meta?.serverId).filter(Boolean)));
  if (sourceServerIds.length !== 1) {
    vscode.window.showErrorMessage(vscode.l10n.t('All selected processes must come from the same source server.'));
    return;
  }
  const cfg = getServerConfig(sourceServerIds[0] as string);
  if (!cfg) {
    vscode.window.showErrorMessage(vscode.l10n.t('Source server is not connected.'));
    return;
  }

  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: vscode.l10n.t('Save here'),
    title: vscode.l10n.t('Export {0} processes as .pro — choose target folder', String(processNodes.length)),
    defaultUri,
  });
  if (!picked || picked.length === 0) { return; }
  const targetDir = picked[0].fsPath;

  const failures: { name: string; reason: string }[] = [];
  let saved = 0;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: vscode.l10n.t('TM1: Exporting {0} processes…', String(processNodes.length)), cancellable: true },
    async (progress, token) => {
      const total = processNodes.length;
      for (let i = 0; i < total; i++) {
        if (token.isCancellationRequested) { break; }
        const n = processNodes[i];
        const processName = n.meta!.processName as string;
        progress.report({ message: `${processName} (${i + 1}/${total})`, increment: 100 / total });
        try {
          const p = await getProcess(cfg, processName, { select: PROCESS_FULL_SELECT }, 60000);
          const content = buildProFile(p);
          const filePath = path.join(targetDir, `${sanitizeFilename(processName)}.pro`);
          fs.writeFileSync(filePath, content, 'utf8');
          saved++;
        } catch (err) {
          failures.push({ name: processName, reason: errMsg(err) });
        }
      }
    },
  );

  if (failures.length === 0) {
    vscode.window.showInformationMessage(
      vscode.l10n.t('TM1: Saved {0} processes to "{1}".', String(saved), targetDir),
      vscode.l10n.t('Open folder'),
    ).then(action => {
      if (action === vscode.l10n.t('Open folder')) {
        vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(targetDir));
      }
    });
  } else {
    const head = failures.slice(0, 3).map(f => `• ${f.name}: ${f.reason}`).join('\n');
    const rest = failures.length > 3 ? vscode.l10n.t('\n… +{0} more', String(failures.length - 3)) : '';
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: {0}/{1} exported. Errors:\n{2}', String(saved), String(processNodes.length), head + rest));
  }
}
