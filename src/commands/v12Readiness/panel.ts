import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { renderWebviewShell } from '../../webviews/webviewShell';
import { recordProcessOpen } from '../processEditor/recentBridge';
import { errMsg } from '../../utils/errMsg';
import { getConnectedIds, getServerConfig, getServerNameByUrl } from '../../serverState/state';
import { analyse } from '../../v12Readiness/analysisPure';
import { compileOnV12 } from './compileCheck';
import { toHtmlBody, toHtmlDocument, toMarkdown, escHtml, REPORT_CSS, type ReportL10n, type ReportState } from '../../v12Readiness/renderPure';
import { compare, parseAssessmentFile, toAssessmentFile, CAUSE_STATUSES, USAGE_STATUSES, type Baseline, type Decision } from '../../v12Readiness/assessmentPure';
import type { WebviewToHost } from '../../v12Readiness/protocol';
import type { Analysis, ScanInput } from '../../v12Readiness/types';

/** Same look as the overview pages' title-bar buttons (`objectOverview/overviewShell.ts`). */
const TOOLBAR_CSS = `
.tb-btn{font:inherit;font-size:12px;padding:4px 10px;color:var(--vscode-foreground);background:transparent;border:1px solid transparent;border-radius:4px;cursor:pointer;}
.tb-btn:hover{background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18));}
.tb-sep{width:1px;align-self:stretch;margin:2px 4px;background:var(--vscode-panel-border);}
.dirty{font-size:11px;color:var(--vscode-descriptionForeground);}
`;

interface Entry { cfg: Tm1Config; serverId: string; scan: ScanInput; analysis: Analysis; l10n: ReportL10n }

/**
 * What outlives a panel and a rescan within the session: the decisions, the file they
 * belong to, and the baseline the current scan is compared with. Closing the panel must
 * not throw away unsaved decisions — a rescan picks them up again.
 */
interface Assessment { decisions: Record<string, Decision>; file?: vscode.Uri; baseline?: Baseline; dirty: boolean }

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]/g, '_');

export class ReadinessPanel {
  private static host: WebviewPanelHost<WebviewToHost>;
  private static extensionUri: vscode.Uri;
  private static readonly entries = new Map<string, Entry>();
  private static readonly assessments = new Map<string, Assessment>();

  static initialize(extensionUri: vscode.Uri): void {
    this.extensionUri = extensionUri;
    this.host = new WebviewPanelHost<WebviewToHost>('tm1.v12Readiness', 'v12 Readiness Check');
    this.host.initialize(extensionUri);
  }

  static disposePanelsForServer(serverUrl: string): void {
    this.host?.disposePanelsForServer(serverUrl);
  }

  private static assessment(key: string): Assessment {
    let a = this.assessments.get(key);
    if (!a) { a = { decisions: {}, dirty: false }; this.assessments.set(key, a); }
    return a;
  }

  private static state(key: string, e: Entry): ReportState {
    const a = this.assessment(key);
    // Comparing a scan with its own saved copy says nothing — show it only for a later scan.
    const base = a.baseline && a.baseline.scannedAt !== e.scan.scannedAt ? a.baseline : undefined;
    return { decisions: a.decisions, comparison: base ? compare(base, e.scan, e.analysis) : undefined };
  }

  private static html(key: string, e: Entry, webview: vscode.Webview): string {
    const t = vscode.l10n.t;
    const a = this.assessment(key);
    const btn = (attr: string, label: string, title?: string) =>
      `<button class="tb-btn" ${attr}${title ? ` title="${escHtml(title)}"` : ''}>${escHtml(label)}</button>`;
    const toolbar = (a.dirty ? `<span class="dirty">${escHtml(t('Unsaved decisions'))}</span>` : '')
      + btn('data-action="compileV12"', t('Compile on TM1 12…'))
      + '<span class="tb-sep"></span>'
      + btn('data-action="openAssessment"', t('Open assessment…'))
      + btn('data-action="saveAssessment"', t('Save assessment'), a.file?.fsPath)
      + '<span class="tb-sep"></span>'
      + btn('data-export="html:full"', t('Export HTML'))
      + btn('data-export="md:full"', t('Export Markdown'))
      + btn('data-export="html:extract"', t('Export summary (HTML)'))
      + btn('data-export="md:extract"', t('Export summary (Markdown)'))
      + btn('data-action="rescan"', '⟳', t('Scan again'));
    return renderWebviewShell({
      cspSource: webview.cspSource,
      css: REPORT_CSS + TOOLBAR_CSS,
      body: toHtmlBody(e.scan, e.analysis, e.l10n, 'full', true, toolbar, this.state(key, e)),
      scriptUris: [String(webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'v12Readiness.js')))],
    });
  }

  static show(entry: Entry, displayName: string): void {
    const key = entry.cfg.serverUrl;
    // A fresh scan must show fresh content — close the old panel instead of revealing it.
    this.host.get(key)?.dispose();
    this.entries.set(key, entry);
    this.host.open({
      key,
      title: vscode.l10n.t('v12 Readiness: {0}', displayName),
      html: (webview) => ReadinessPanel.html(key, entry, webview),
      onMessage: (msg) => ReadinessPanel.onMessage(key, msg),
      onDispose: () => { ReadinessPanel.entries.delete(key); },
    });
  }

  private static rerender(key: string): void {
    const e = this.entries.get(key);
    const panel = this.host.get(key);
    if (e && panel) { panel.webview.html = this.html(key, e, panel.webview); }
  }

  private static async onMessage(key: string, msg: WebviewToHost): Promise<void> {
    const e = this.entries.get(key);
    if (!e) { return; }
    const t = vscode.l10n.t;
    const a = this.assessment(key);

    switch (msg.type) {
      case 'compileV12': {
        const targets = getConnectedIds()
          .map(id => ({ id, cfg: getServerConfig(id) }))
          .filter((x): x is { id: string; cfg: Tm1Config } => x.cfg?.version === 'v12');
        if (targets.length === 0) {
          void vscode.window.showInformationMessage(t('Connect a TM1 12 database first — the compile check sends each process to its compiler as a dry run.'));
          return;
        }
        const pick = targets.length === 1 ? targets[0] : (await vscode.window.showQuickPick(
          targets.map(x => ({ label: getServerNameByUrl(x.cfg.serverUrl) ?? x.id, target: x })),
          { placeHolder: t('TM1 12 database to compile against') }))?.target;
        if (!pick) { return; }
        const name = getServerNameByUrl(pick.cfg.serverUrl) ?? pick.id;
        // TM1 Applications processes stay out of every count, so they are not sent either.
        const toCompile = e.scan.processes.filter(p => !p.name.toLowerCase().startsWith('}tp_'));
        const go = t('Compile');
        const ok = await vscode.window.showWarningMessage(
          t('Send the code of {0} processes to "{1}" for a dry-run compile?', toCompile.length, name),
          { modal: true, detail: t('Each process is sent once via POST /CompileProcess. TM1 checks the syntax and saves nothing — but the process code leaves this server, and the target carries one request per process. Use a test or migration database, not production.') },
          go,
        );
        if (ok !== go) { return; }
        let result;
        try {
          result = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: t('Compiling on {0}…', name), cancellable: true },
            (progress, token) => compileOnV12(toCompile, pick.cfg, name, token, progress),
          );
        } catch (err) {
          void vscode.window.showErrorMessage(t('Compile check failed: {0}', errMsg(err)));
          return;
        }
        e.scan = { ...e.scan, compile: result };
        e.analysis = analyse(e.scan);
        this.rerender(key);
        return;
      }

      case 'rescan':
        await vscode.commands.executeCommand('tm1.v12ReadinessCheck', { meta: { serverId: e.serverId } });
        return;

      case 'openRules': {
        const { RuleEditorManager } = await import('../rule/ruleEditor');
        // The rule editor reveals 1-based Monaco lines; the analysis counts from 0.
        await RuleEditorManager.open(msg.cube, e.cfg, msg.line + 1);
        return;
      }

      case 'open': {
        const { openProcess } = await import('../processEditor/openPanel');
        await openProcess(msg.process, undefined, e.cfg, msg.section ? { section: msg.section, line: msg.line } : undefined);
        recordProcessOpen(e.serverId, msg.process);
        return;
      }

      case 'decide': {
        const all: readonly string[] = msg.id.startsWith('usage|') ? USAGE_STATUSES : CAUSE_STATUSES;
        if (!all.includes(msg.value)) { return; }
        a.decisions[msg.id] = { status: msg.value as Decision['status'], updatedAt: new Date().toISOString() };
        // The status badge, the retire tile and the "unsaved" marker all derive from it.
        a.dirty = true;
        this.rerender(key);
        return;
      }

      case 'saveAssessment': {
        let target = a.file;
        if (!target) {
          target = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(safeName(`v12-readiness-${e.scan.serverAlias}.json`)),
            filters: { [t('Readiness assessment')]: ['json'] },
          });
          if (!target) { return; }
        }
        const file = toAssessmentFile(e.scan, e.analysis, a.decisions, new Date().toISOString());
        await vscode.workspace.fs.writeFile(target, Buffer.from(JSON.stringify(file, null, 2) + '\n', 'utf8'));
        a.file = target;
        // The saved scan is what the next scan is compared with.
        a.baseline = file.baseline;
        a.dirty = false;
        this.rerender(key);
        void vscode.window.showInformationMessage(t('Assessment saved: {0}', target.fsPath));
        return;
      }

      case 'openAssessment': {
        if (a.dirty) {
          const discard = t('Discard and open');
          const pick = await vscode.window.showWarningMessage(t('There are unsaved decisions. Discard them?'), { modal: true }, discard);
          if (pick !== discard) { return; }
        }
        const picked = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { [t('Readiness assessment')]: ['json'] } });
        if (!picked?.[0]) { return; }
        let parsed;
        try {
          parsed = parseAssessmentFile(Buffer.from(await vscode.workspace.fs.readFile(picked[0])).toString('utf8'));
        } catch (err) {
          void vscode.window.showErrorMessage(t('Not a readiness assessment: {0}', errMsg(err)));
          return;
        }
        if (parsed.serverAlias && parsed.serverAlias !== e.scan.serverAlias) {
          const go = t('Open anyway');
          const pick = await vscode.window.showWarningMessage(
            t('This assessment was saved for "{0}", not for "{1}".', parsed.serverAlias, e.scan.serverAlias), { modal: true }, go);
          if (pick !== go) { return; }
        }
        this.assessments.set(key, { decisions: parsed.decisions, file: picked[0], baseline: parsed.baseline, dirty: false });
        this.rerender(key);
        return;
      }

      case 'export': {
        const st = this.state(key, e);
        const content = msg.format === 'html'
          ? toHtmlDocument(e.scan, e.analysis, e.l10n, msg.cut, st)
          : toMarkdown(e.scan, e.analysis, e.l10n, msg.cut, st);
        const stem = msg.cut === 'full' ? 'v12-readiness' : 'v12-readiness-summary';
        const target = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(safeName(`${stem}-${e.scan.serverAlias}.${msg.format}`)),
          filters: msg.format === 'html' ? { HTML: ['html'] } : { Markdown: ['md'] },
        });
        if (!target) { return; }
        await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
        void vscode.window.showInformationMessage(t('Report saved: {0}', target.fsPath));
        return;
      }
    }
  }
}
