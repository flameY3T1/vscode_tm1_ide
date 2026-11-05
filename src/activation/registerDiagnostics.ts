import * as vscode from 'vscode';
import { apiRequest, getConfig } from '../tm1Rest/client';
import { getServerConfig } from '../serverState/state';
import { runCancellableProcess } from '../runState/runCancellableProcess';
import { executeTransientProcess } from '../tm1Rest/transientProcess';
import { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { wrap } from './wrap';
import { errMsg } from '../utils/errMsg';
import { outputChannel } from '../utils/outputChannel';
import { isOk } from '../tm1Rest/httpError';
import { INTERACTIVE_CAP_MS, METADATA_CAP_MS } from '../tm1Rest/timeouts';

/**
 * Registers connection diagnostics and bulk server actions:
 *   tm1.testConnection / tm1.probeODBC / tm1.refreshSecurity / tm1.saveDataAll
 */
export function registerDiagnostics(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('tm1.testConnection', async () => {
      const cfg = getConfig();
      // In summary: every click on "Test Connection" so far created ANOTHER
      // channel of the same name.
      const out = outputChannel('TM1 Diagnostics');
      out.show(true);
      out.appendLine(`=== TM1 connection test ===`);
      out.appendLine(`URL:  ${cfg.serverUrl}`);
      out.appendLine(`User: ${cfg.username}`);
      out.appendLine(`SSL-Check: ${cfg.rejectUnauthorized}`);
      out.appendLine(`Auth: ${cfg.authType ?? 'Basic'}`);
      out.appendLine('');
      for (const endpoint of ['Threads', 'Cubes?$select=Name&$top=3', 'Processes?$select=Name&$top=3']) {
        out.appendLine(`GET ${endpoint} ...`);
        try {
          const res = await apiRequest('GET', endpoint, undefined, undefined, cfg);
          out.appendLine(`  HTTP ${res.statusCode}`);
          out.appendLine(`  Body (first 300 chars): ${res.body.substring(0, 300)}`);
        } catch (err) {
          out.appendLine(`  ERROR: ${errMsg(err)}`);
        }
        out.appendLine('');
      }
      out.appendLine('=== End ===');
    }),
    vscode.commands.registerCommand('tm1.probeODBC', async () => {
      const cfg = getConfig();
      const out = outputChannel('TM1 ODBC Probe');
      out.show(true);
      out.appendLine(`=== Probe ODBC endpoints @ ${cfg.serverUrl} ===\n`);
      const candidates = [
        'ODBCDataSources',
        'Configuration/ODBCDataSources',
        'Server/ODBCDataSources',
        'tm1.GetODBCDataSources()',
        'Configuration/tm1.GetODBCDataSources()',
        'DataSources',
        'Server/DataSources',
        'Server/Configuration/ODBCDataSources',
        'ActiveConfiguration/ODBCDataSources',
      ];
      for (const c of candidates) {
        try {
          const r = await apiRequest('GET', c, undefined, INTERACTIVE_CAP_MS, cfg);
          const preview = r.body.length > 240 ? r.body.slice(0, 240) + '...' : r.body;
          out.appendLine(`${r.statusCode}  /api/v1/${c}`);
          if (isOk(r)) {
            out.appendLine(`  → ${preview.replace(/\s+/g, ' ')}`);
          } else if (r.statusCode === 400 || r.statusCode === 404) {
            out.appendLine(`  (not available)`);
          } else {
            out.appendLine(`  → ${preview.replace(/\s+/g, ' ').slice(0, 200)}`);
          }
        } catch (err) {
          out.appendLine(`ERR  /api/v1/${c}  → ${errMsg(err)}`);
        }
      }
      out.appendLine('\n--- $metadata grep ODBC ±5 lines ---');
      try {
        const meta = await apiRequest('GET', '$metadata', undefined, METADATA_CAP_MS, cfg);
        if (meta.statusCode === 200) {
          const all = meta.body.split('\n');
          const hits = new Set<number>();
          all.forEach((l, i) => { if (/odbc|sql.*data\s*source|datasource/i.test(l)) { for (let k = -5; k <= 5; k++) { if (i + k >= 0 && i + k < all.length) hits.add(i + k); } } });
          const sorted = [...hits].sort((a, b) => a - b);
          let prev = -10;
          for (const i of sorted) {
            if (i - prev > 1) out.appendLine('---');
            out.appendLine(`${i}: ${all[i].trim()}`);
            prev = i;
          }
        } else {
          out.appendLine(`metadata HTTP ${meta.statusCode}`);
        }
      } catch (err) {
        out.appendLine(`metadata ERR: ${errMsg(err)}`);
      }
      out.appendLine('\n=== End ===');
    }),
    vscode.commands.registerCommand('tm1.refreshSecurity', wrap('SecurityRefresh', async (node?: Tm1TreeNode) => {
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      // TM1 11.x has no `POST /SecurityRefresh` REST action (returns HTTP 400) —
      // SecurityRefresh is a TI function, like TM1py's
      // SecurityService.security_refresh (which runs `SecurityRefresh;`). We run
      // that one-liner INLINE via `POST ExecuteProcessWithReturn`: nothing is
      // persisted, the name only labels the run in the message log.
      // Shown in the "Running" view like every other server-side run — a
      // security refresh on a large model takes minutes, and a notification
      // would sit on top of the editor for all of it.
      const refreshName = '}VSCode_SecurityRefresh';
      const { cancelled } = await runCancellableProcess(
        vscode.l10n.t('TM1: Security Refresh running…'), refreshName, cfg,
        () => executeTransientProcess(cfg, { name: refreshName, prolog: 'SecurityRefresh;' }),
        { includeTransient: true },
      );
      if (cancelled) {
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: Security Refresh was cancelled.'));
        return;
      }
      vscode.window.showInformationMessage(vscode.l10n.t('TM1: Security Refresh successful.'));
    })),
    vscode.commands.registerCommand('tm1.saveDataAll', wrap('SaveDataAll', async (node?: Tm1TreeNode) => {
      // Inline run (`POST ExecuteProcessWithReturn`) — no helper process is left
      // behind. `includeTransient` lets the cancel path find the thread: an
      // inline run carries no object name in its Function field.
      const processName = '}VSCode_SaveDataAll';
      // Per-server tree action (menu: `viewItem =~ /^serverRoot-connected/`) —
      // resolve the CLICKED server, never the last-connected one. Otherwise, with
      // two servers connected, the v12 guard below reads the wrong version and
      // SaveDataAll runs against the wrong instance.
      const cfg = getServerConfig(node?.meta?.serverId);
      if (!cfg) { return; }
      // The tree menu hides this on v12; guard the other entry points too.
      // Live-verified on v12: `SaveDataAll` is not a TI function there.
      if (cfg.version === 'v12') {
        vscode.window.showWarningMessage(
          vscode.l10n.t('{0} is not available on TM1 v12 — the TI function does not exist there (v12 persists data on its own).', 'SaveDataAll'));
        return;
      }
      const { cancelled } = await runCancellableProcess(
        vscode.l10n.t('TM1: Running SaveDataAll…'), processName, cfg,
        () => executeTransientProcess(cfg, { name: processName, prolog: 'SaveDataAll;' }),
        { includeTransient: true },
      );
      if (cancelled) {
        vscode.window.showWarningMessage(vscode.l10n.t('TM1: SaveDataAll was cancelled.'));
      } else {
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: SaveDataAll executed successfully.'));
      }
    })),
  );
}
