// The process as a file: a CustomTextEditor that shows `<name>.ti` (+ its
// `<name>.json` header) of the git mirror in the process editor webview. The
// file is the truth; the webview is a view. Any tool that writes the file — an
// AI on disk, an extension through WorkspaceEdit, `git pull` — shows up live.
// Sync rules: `processFileSession.ts`. Design: docs/architecture/process-file-editor.md.
import * as vscode from 'vscode';
import { muteWebviewOnDispose } from '../../../webviews/webviewPanelHost';
import { postTo } from '../../../webviews/typedPost';
import type { HostToWebview, WebviewToHost } from '../../../webviewClient/processEditorMonaco/protocol';
import { parseProcess, type TM1Process } from '../../../git/serializer';
import { pushProcessFrom } from '../../../git/pushOrchestrator';
import { getConfig } from '../../../tm1Client';
import { fetchProcessEtag } from '../../../tm1Rest/processApi';
import { Tm1HttpError } from '../../../tm1Rest/httpError';
import { resolveDir, serverConfigForFileStrict } from '../../../providers/serverConfigForFile';
import { errMsg } from '../../../utils/errMsg';
import { mergeVariableColumns } from '../../../utils/processVariablesUi';
import type { ProcessVariable } from '../../../tm1Rest/transport/types';
import { attachProcessPanel } from '../openPanel';
import { sessionOfPanel, sessionsOfProcess } from '../state';
import { sectionsFromTi } from './processFilePure';
import { ProcessFileSession, type SessionWarning } from './processFileSession';

export const PROCESS_FILE_VIEW_TYPE = 'tm1.processFile';
/** Unsaved state is the one case a disk write from another tool cannot reach. Keep it short. */
export const AUTOSAVE_MS = 1000;

type ProbeResult = Extract<WebviewToHost, { type: 'fileModeProbeResult' }>;
type ProbeRequest = Omit<Extract<HostToWebview, { type: 'fileModeProbe' }>, 'type'>;

export class ProcessFileEditorProvider implements vscode.CustomTextEditorProvider {
  /** Integration tests only: the last resolved panel and its pending probe answer. */
  private probePanel: vscode.WebviewPanel | undefined;
  private probeAnswer: ((r: ProbeResult) => void) | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Asks the webview of the last opened file editor for its state (ExtensionMode.Test only). */
  probe(req: ProbeRequest): Promise<ProbeResult | undefined> {
    const panel = this.probePanel;
    if (!panel) { return Promise.resolve(undefined); }
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.probeAnswer = undefined; resolve(undefined); }, 3000);
      this.probeAnswer = r => { clearTimeout(timer); this.probeAnswer = undefined; resolve(r); };
      void postTo<HostToWebview>(panel.webview, { type: 'fileModeProbe', ...req });
    });
  }

  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): Promise<void> {
    muteWebviewOnDispose(panel);
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out', 'webview'),
        vscode.Uri.joinPath(this.extensionUri, 'media'),
      ],
    };
    const fail = (message: string) => {
      vscode.window.showErrorMessage(message);
      panel.dispose();
    };

    const jsonUri = document.uri.with({ path: document.uri.path.replace(/\.ti$/i, '.json') });
    let jsonDoc: vscode.TextDocument;
    try {
      jsonDoc = await vscode.workspace.openTextDocument(jsonUri);
    } catch {
      fail(vscode.l10n.t('Header file {0} is missing next to the process file.', vscode.workspace.asRelativePath(jsonUri)));
      return;
    }
    // Unbound file: lint and completion still need a server, a push never guesses one.
    const bound = serverConfigForFileStrict(document.uri.fsPath);
    const config = bound ?? getConfig();
    // Reading and writing the layout both follow the server, like the export did.
    const v12 = config.version === 'v12';
    const tiText = document.getText();
    const sections = sectionsFromTi(tiText, v12);
    if (!sections) {
      fail(vscode.l10n.t('File {0} has damaged section markers (#region/#endregion) — fix it as text first.', vscode.workspace.asRelativePath(document.uri)));
      return;
    }
    let process;
    try {
      process = { ...parseProcess(tiText.replace(/\r\n/g, '\n'), jsonDoc.getText().replace(/\r\n/g, '\n'), v12), ...sections };
    } catch (err) {
      fail(vscode.l10n.t('Header file {0} cannot be read: {1}', vscode.workspace.asRelativePath(jsonUri), errMsg(err)));
      return;
    }

    process.v12 = v12;
    // ETag of the server version this session starts from. The push sends it
    // back, so a version someone saved meanwhile is noticed, not overwritten.
    // Unknown (unbound, offline, not on the server yet) = overwrite as before.
    // The push awaits this read: an early save must not go out with `*` while
    // the tag is still on its way.
    let serverEtag: string | undefined;
    const initialEtag = bound
      ? fetchProcessEtag(bound, process.name).then(tag => { serverEtag ??= tag; }, () => undefined)
      : Promise.resolve();
    // Any profile's server editor on this process conflicts with the file.
    const other = sessionsOfProcess(config.serverUrl ?? '__default__', process.name)[0]?.panel;
    if (other) {
      const close = vscode.l10n.t('Close it and open the file');
      const pick = await vscode.window.showWarningMessage(
        vscode.l10n.t('"{0}" is already open in the server editor.', process.name), close);
      if (pick !== close) { panel.dispose(); return; }
      // The old panel's late cleanup holds its own session object and cannot
      // reach the new one, so no wait is needed after this.
      other.dispose();
    }

    let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
    const saveBoth = async () => {
      for (const doc of [document, jsonDoc]) {
        if (doc.isDirty && !(await doc.save())) {
          const revert = vscode.l10n.t('Revert to file on disk');
          const pick = await vscode.window.showWarningMessage(
            vscode.l10n.t('Could not save {0} — the file changed on disk.', vscode.workspace.asRelativePath(doc.uri)), revert);
          if (pick === revert) { await vscode.commands.executeCommand('workbench.action.files.revert', doc.uri); }
          return false;
        }
      }
      return true;
    };
    const warnings: Record<SessionWarning, () => string> = {
      damagedMarkers: () => vscode.l10n.t('File {0} has damaged section markers (#region/#endregion) — the editor keeps the last good state.', vscode.workspace.asRelativePath(document.uri)),
      damagedHeader: () => vscode.l10n.t('Header file {0} cannot be read — the editor keeps the last good state.', vscode.workspace.asRelativePath(jsonUri)),
      unboundPush: () => vscode.l10n.t('File is not inside the git folder of a connected server — cannot save to TM1.'),
      syncFailed: () => vscode.l10n.t('Could not write the editor state to {0} — the next edit tries again.', vscode.workspace.asRelativePath(document.uri)),
    };

    const session = new ProcessFileSession(process, tiText, jsonDoc.getText(),
      document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n', !!bound, {
        post: msg => { void postTo<HostToWebview>(panel.webview, msg); },
        applyEdits: async (ti, jsonText) => {
          if (ti) {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(document.positionAt(ti.offset), document.positionAt(ti.offset + ti.length)), ti.text);
            if (!(await vscode.workspace.applyEdit(edit))) { throw new Error('applyEdit refused'); }
          }
          if (jsonText !== undefined) {
            await vscode.workspace.fs.writeFile(jsonUri, Buffer.from(jsonText, 'utf8'));
          }
        },
        warn: kind => { void vscode.window.showWarningMessage(warnings[kind]()); },
        scheduleAutosave: () => {
          if (autosaveTimer) { clearTimeout(autosaveTimer); }
          autosaveTimer = setTimeout(() => { autosaveTimer = undefined; void saveBoth(); }, AUTOSAVE_MS);
        },
        saveFiles: saveBoth,
        readFiles: async () => ({
          ti: document.getText(),
          json: new TextDecoder().decode(await vscode.workspace.fs.readFile(jsonUri)),
        }),
        push: async () => {
          const dir = bound && resolveDir(bound);
          if (!dir || !(await saveBoth())) { return; }
          await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('TM1 Git: Pushing process "{0}"…', process.name),
          }, async () => {
            await initialEtag;
            try {
              try {
                serverEtag = await pushProcessFrom(dir.serverDir, dir.serverName, process.name, bound, serverEtag);
              } catch (err) {
                if (!(err instanceof Tm1HttpError && err.statusCode === 412)) { throw err; }
                const overwrite = vscode.l10n.t('Overwrite');
                const pick = await vscode.window.showWarningMessage(
                  vscode.l10n.t('"{0}" was changed on the server since this file was opened. Overwrite the server version?', process.name),
                  { modal: true }, overwrite);
                if (pick !== overwrite) { return; }
                serverEtag = await pushProcessFrom(dir.serverDir, dir.serverName, process.name, bound);
              }
              vscode.window.showInformationMessage(vscode.l10n.t('Process "{0}" pushed.', process.name));
            } catch (err) {
              vscode.window.showErrorMessage(vscode.l10n.t('Push failed: {0}', errMsg(err)));
            }
          });
        },
      });

    const docSub = vscode.workspace.onDidChangeTextDocument(e => {
      if (e.contentChanges.length === 0) { return; }
      const uri = e.document.uri.toString();
      if (uri === document.uri.toString()) { session.onTiChanged(e.document.getText()); }
      else if (uri === jsonUri.toString()) { session.onJsonChanged(e.document.getText()); }
    });
    // The header is not shown in an editor, so VS Code does not watch it outside
    // the workspace and its document never reloads. Watch the file itself.
    const jsonWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(jsonUri, '..'), jsonUri.path.split('/').pop()!), true, false, true);
    jsonWatcher.onDidChange(async () => {
      try {
        session.onJsonChanged(new TextDecoder().decode(await vscode.workspace.fs.readFile(jsonUri)));
      } catch { /* deleted or unreadable: the next change reports it */ }
    });
    panel.onDidDispose(() => {
      jsonWatcher.dispose();
      docSub.dispose();
      if (autosaveTimer) { clearTimeout(autosaveTimer); void saveBoth(); }
    });

    this.probePanel = panel;
    panel.onDidDispose(() => { if (this.probePanel === panel) { this.probePanel = undefined; } });
    const panelData = (p: TM1Process) => ({
      prolog: p.prolog, metadata: p.metadata, data: p.data, epilog: p.epilog,
      parameters: p.parameters ?? [],
      // The editor shows ignored columns too; they live in VariablesUIData.
      variables: mergeVariableColumns(p.variables, p.variablesUiData) as ProcessVariable[],
      hasSecurity: p.hasSecurity ?? false, dataSource: p.dataSource,
    });
    await attachProcessPanel(panel, process.name, config, undefined, async () => panelData(process), async msg => {
      switch (msg.type) {
        case 'monacoReady': {
          // Default handling hydrates from the stores; a reloaded webview must
          // get the current state, not the one at open, and the sequence its
          // `fileSync`s echo. File mode must be on before the first edit.
          const { dataSource, ...code } = panelData(session.current);
          const ps = sessionOfPanel(panel);
          if (ps) { ps.code = code; ps.dataSource = dataSource; }
          void postTo<HostToWebview>(panel.webview, { type: 'monacoFileMode' });
          void postTo<HostToWebview>(panel.webview, { type: 'monacoApplyExternal', sections: {}, seq: session.externalSequence });
          return false;
        }
        case 'fileSync': await session.onFileSync(msg); return true;
        // The document is the draft: VS Code shows the dirty dot, no extra store.
        case 'monacoContentChanged':
        case 'processDraft': return true;
        case 'save': await session.onSave(); return true;
        // These write the editor state to TM1 through the server editor's handlers.
        case 'execute':
        case 'debugStart':
        case 'saveAs': return !(await session.beforeServerWrite());
        case 'fileModeProbeResult': this.probeAnswer?.(msg); return true;
        default: return false;
      }
    });
  }
}
