import * as vscode from 'vscode';
import { apiRequest, executeProcess } from '../../tm1Client';
import { notifyExecuteResult } from './executeNotify';
import type { ProcessParameter, ProcessVariable, DataSource, Tm1Config } from '../../tm1Rest/transport/types';
import { getCubeViewNames, getCubeDimensionNames } from '../../tm1Rest/cubeApi';
import type { ProtocolProcessParameter, ProtocolProcessVariable } from '../../webviewClient/processEditorMonaco/protocol';
import type { TiVarType } from '../../references/variableEnv';
import { listPublicSubsetNames } from '../../tm1Rest/subsetApi';
import { postSnippets } from './lifecycle';
import { runCancellableProcess, isCancelRejection } from '../../runState/runCancellableProcess';
import { buildResolverView, lookupIdentifierInfo } from '../../references/resolverView';
import type { WebviewToHost } from '../../webviewClient/processEditorMonaco/protocol';
import { askParamsInPanel, answerParamAsk } from './processParams';
import { getPanelTitle } from './processEditorUtils';
import { lintAllSections } from './processEditorLint';
import { postV12Mode } from './lifecycle';
import { errMsg } from '../../utils/errMsg';
import {
  _debugSessions, _sessions, isLive, type PanelSession,
  capitalizeSection, serverLabel,
} from './state';
import { handleAsciiPreview } from './asciiPreview';
import { handleOdbcPreview } from './odbcPreview';
import { handleMonacoSave, handleMonacoSaveAs } from './save';
import { logFetchError } from './messagingLog';
import {
  fetchCubeNames, fetchCubesWithDims, fetchDimensionNames, fetchHierarchyNamesFor,
  fetchProcessList,
} from '../../providers/contextListFetch';
import { loadFormatConfig, saveFormatConfig } from '../../providers/formatConfigStore';
import { loadLintConfig, saveLintConfig } from './lintConfigStore';
import { loadRuleFormatConfig, saveRuleFormatConfig } from '../../providers/ruleFormatConfigStore';
import { RuleEditorManager } from '../rule/ruleEditor';
import { buildBundle, parseBundle } from './tiConfigBundle';
import { dispatch, type DispatchTable } from '../../webviews/dispatchTablePure';
import { recordProcessOpen } from './recentBridge';
import { getServerIdByUrl } from '../../serverState/state';
import { isOk } from '../../tm1Rest/httpError';
import { postTo } from '../../webviews/typedPost';
// reveal.section is typed string by every caller of openProcess; they all pass a process section.
import type { HostToWebview } from '../../webviewClient/processEditorMonaco/protocol';
import type { SectionKey } from '../../webviewClient/processEditorMonaco/sectionTypes';

/**
 * Injected context for every process-editor message handler (A4 dispatch
 * table). Bundles the positional args the old switch-router received, so each
 * handler body stays byte-identical after destructuring these exact names.
 */
interface ProcessEditorCtx {
  readonly session: PanelSession;
  readonly panel: vscode.WebviewPanel;
  readonly panelKey: string;
  readonly processName: string;
  readonly serverKey: string;
  readonly config: Tm1Config;
  readonly reopenAfterSave: (newProcessName: string) => Promise<void>;
}

/**
 * Push the full initial payload (content/params/datasource/vars/security/config)
 * to a freshly-opened panel. Callable from either the `monacoReady` handler or
 * from openProcess once process data has loaded — whichever runs last actually
 * hydrates (guarded by `session.hydrated`); the other is a no-op. Skips entirely
 * until process data is stored, so an early `monacoReady` (arriving before the
 * network load finished) can't blank the editor; openProcess re-invokes this
 * once the data lands. Fixes the intermittent empty-editor race.
 */
export function hydratePanel(session: PanelSession): void {
  const { panel, key: panelKey, serverKey } = session;
  if (session.hydrated) return;
  const stored = session.code;
  if (!stored) return; // data not loaded yet — the other path will hydrate
  postTo<HostToWebview>(panel.webview, {
    type: 'monacoSetContent',
    sections: {
      prolog:   stored.prolog   ?? '',
      metadata: stored.metadata ?? '',
      data:     stored.data     ?? '',
      epilog:   stored.epilog   ?? '',
    },
  });
  postTo<HostToWebview>(panel.webview, { type: 'monacoSetParameters', parameters: stored.parameters ?? [] });
  postTo<HostToWebview>(panel.webview, {
    type: 'monacoSetDataSource',
    dataSource: session.dataSource ?? { Type: 'None' },
  });
  postTo<HostToWebview>(panel.webview, { type: 'monacoSetVariables', variables: stored.variables ?? [] });
  postTo<HostToWebview>(panel.webview, { type: 'monacoSetSecurity', hasSecurity: stored.hasSecurity ?? false });
  postTo<HostToWebview>(panel.webview, { type: 'formatConfig', config: loadFormatConfig(serverKey) });
  postTo<HostToWebview>(panel.webview, { type: 'lintConfig', config: loadLintConfig(serverKey) });
  postSnippets(panel);
  session.hydrated = true;
  // Flush a debug highlight that arrived while this panel was still opening
  // (StepIn routed the cursor into this freshly-opened sub-process editor).
  const pending = session.pendingDebugState;
  if (pending) {
    session.pendingDebugState = undefined;
    postTo<HostToWebview>(panel.webview, pending);
  } else if (_debugSessions.has(panelKey)) {
    // Webview reloaded (monacoReady WITHOUT a dispose) while a debug session is
    // still live. The webview is push-driven, so re-post the last known state —
    // otherwise the editor comes back in edit mode while the server is paused.
    const last = session.lastDebugState;
    if (last) { postTo<HostToWebview>(panel.webview, last); }
  }
  // Flush a reveal-target queued by openProcess (e.g. jump-to-match from
  // cross-object find/replace) once the editor content is in place.
  const reveal = session.pendingReveal;
  if (reveal) {
    session.pendingReveal = undefined;
    postTo<HostToWebview>(panel.webview, { type: 'revealSectionLine', section: reveal.section as SectionKey, line: reveal.line });
  }
}

// ── Dispatch table ──────────────────────────────────────────────
// Exhaustive over WebviewToHost: a missing `type` is a compile error.
const processEditorTable: DispatchTable<WebviewToHost, ProcessEditorCtx> = {
  // Only a file-mode panel posts this, and the file editor consumes it before
  // the table (`attachProcessPanel` onMessage). Nothing to do for a server panel.
  fileSync: async () => { /* file mode only */ },
  fileModeProbeResult: async () => { /* file mode only */ },

  paramsAnswer: async (msg) => { answerParamAsk(msg.requestId, msg.values); },

  openExternal: async (msg) => {
    if (typeof msg.url === 'string' && /^https?:\/\//i.test(msg.url)) {
      await vscode.env.openExternal(vscode.Uri.parse(msg.url));
    }
  },

  // Ctrl/Cmd+click on an ExecuteProcess/RunProcess name literal → open that
  // process in the editor using the current panel's server context.
  openProcess: async (msg, ctx) => {
    const name = String(msg.name ?? '').trim();
    if (!name) { return; }
    const { openProcess } = await import('./openPanel');
    // A failed open (typo'd name, no read rights) shows an error toast and leaves
    // no editor behind — recording it anyway would push a dead entry into the
    // 5-slot "Recently opened" list and evict a real one.
    const opened = await openProcess(name, undefined, ctx.config);
    if (!opened) { return; }
    // openPanel.openProcess only creates/reveals the panel — every caller records
    // its own Recent entry (the tree command does it directly). The panel context
    // carries only the config, so reverse-resolve the profile id from the URL.
    recordProcessOpen(getServerIdByUrl(ctx.config.serverUrl), name);
  },

  monacoReady: async (msg, ctx) => {
    const { panel, session } = ctx;
    // A `monacoReady` means the webview (re)loaded and needs content. Clearing the
    // hydrated flag lets hydratePanel run again, so the editor re-populates after a
    // webview reload/eviction (which re-fires monacoReady WITHOUT disposing the
    // panel) — the old handler recovered by re-posting on every monacoReady.
    // If data hasn't loaded yet, openProcess will hydrate once it lands.
    // The `session.hydrated` guard still prevents a double-post within a single load.
    session.hydrated = false;
    session.ready = true;
    // The v12 state must be on the other side BEFORE the content: it decides
    // which functions completion offers in the first place, and a freshly
    // opened panel would otherwise never experience a broadcast.
    postV12Mode(panel);
    hydratePanel(session);
  },

  monacoContentChanged: async (msg, ctx) => {
    const { panel, session, processName, serverKey } = ctx;
    if (!session.dirty) {
      session.dirty = true;
      panel.title = getPanelTitle(processName, true, serverLabel(serverKey));
    }
  },

  processDraft: async (rawMsg, ctx) => {
    // Debounced mirror of the editor state. Nothing is persisted here — this
    // only keeps the host's copy current so `onPanelDisposed` has something to
    // park if the panel disappears while dirty.
    const msg = rawMsg as Extract<WebviewToHost, { type: 'processDraft' }>;
    ctx.session.draft = {
      sections: msg.sections,
      parameters: msg.parameters,
      dataSource: msg.dataSource,
      variables: msg.variables,
    };
  },

  requestPaste: async (msg, ctx) => {
    const { panel } = ctx;
    // The webview cannot reliably read the clipboard, so the extension host does it.
    try {
      const text = await vscode.env.clipboard.readText();
      postTo<HostToWebview>(panel.webview, { type: 'pasteText', text });
    } catch (err) {
      logFetchError('requestPaste (clipboard.readText)', err);
      postTo<HostToWebview>(panel.webview, { type: 'pasteText', text: '' });
    }
  },

  requestCopy: async (msg) => {
    try { await vscode.env.clipboard.writeText(typeof msg.text === 'string' ? msg.text : ''); }
    catch { /* clipboard write unavailable */ }
  },

  save: async (rawMsg, ctx) => {
    const msg = rawMsg as Extract<WebviewToHost, { type: 'save' | 'saveAs' | 'execute' }>;
    const { panel, panelKey, processName, serverKey, config } = ctx;
    await handleMonacoSave(
      panel, panelKey, processName, serverKey,
      msg.sections ?? {}, msg.parameters as ProcessParameter[], msg.dataSource as DataSource, msg.variables as ProcessVariable[],
      config, false, Number(msg.errorCount ?? 0), msg.hasSecurity,
    );
  },

  saveAs: async (rawMsg, ctx) => {
    const msg = rawMsg as Extract<WebviewToHost, { type: 'save' | 'saveAs' | 'execute' }>;
    const { processName, config, reopenAfterSave } = ctx;
    await handleMonacoSaveAs(
      processName, msg.sections ?? {}, msg.parameters as ProcessParameter[], msg.dataSource as DataSource, msg.variables as ProcessVariable[],
      config, Number(msg.errorCount ?? 0), reopenAfterSave, msg.hasSecurity,
    );
  },

  execute: async (rawMsg, ctx) => {
    const msg = rawMsg as Extract<WebviewToHost, { type: 'save' | 'saveAs' | 'execute' }>;
    const { panel, panelKey, processName, serverKey, config } = ctx;
    try {
      // Auto-save first so server runs the latest editor state.
      const saveOk = await handleMonacoSave(
        panel, panelKey, processName, serverKey,
        msg.sections ?? {}, msg.parameters as ProcessParameter[], msg.dataSource as DataSource, msg.variables as ProcessVariable[], config,
        true,
        Number(msg.errorCount ?? 0), msg.hasSecurity,
      );
      if (!saveOk) { return; }
      const storedExec = ctx.session.code;
      const rawParams = (msg.parameters ?? storedExec?.parameters ?? []) as ProcessParameter[];
      let execParams: Array<{ Name: string; Value: string | number }>;
      if (rawParams.length > 0) {
        const formResult = await askParamsInPanel(panel, processName, rawParams, vscode.l10n.t('Execute'), config?.serverUrl ?? '');
        if (formResult === undefined) { return; } // cancelled
        execParams = formResult;
      } else {
        execParams = [];
      }
      postTo<HostToWebview>(panel.webview, { type: 'setExecuting', running: true });
      try {
        const { result, cancelled } = await runCancellableProcess(
          vscode.l10n.t('"{0}" running …', processName), processName, config,
          () => executeProcess(processName, execParams, config),
        );
        if (cancelled) {
          vscode.window.showWarningMessage(vscode.l10n.t('Process "{0}" was cancelled.', processName));
        } else if (result) {
          await notifyExecuteResult(processName, result, config);
        }
      } finally {
        // The tab may have been closed while the process was still running.
        // Posting to a disposed webview throws; only post if the panel is still live.
        if (isLive(ctx.session)) {
          postTo<HostToWebview>(panel.webview, { type: 'setExecuting', running: false });
        }
      }
    } catch (err) {
      // The run can be cancelled from OUTSIDE this editor — TM1 Top, another
      // admin, or the server — in which case the pending execute rejects with the
      // documented cancel signature (`500 TM1UserException: Cancel`). It was
      // cancelled, not failed, so report it like the in-editor stop button does.
      if (isCancelRejection(err)) {
        vscode.window.showWarningMessage(vscode.l10n.t('Process "{0}" was cancelled.', processName));
      } else {
        vscode.window.showErrorMessage(vscode.l10n.t('Execution failed: {0}', errMsg(err)));
      }
    }
  },

  fetchCubes: async (msg, ctx) => {
    const { panel, config } = ctx;
    postTo<HostToWebview>(panel.webview, {
      type: 'cubeList', cubes: await fetchCubeNames(config, logFetchError),
    });
  },

  fetchViews: async (msg, ctx) => {
    const { panel, config } = ctx;
    try {
      const cubeName = String(msg.cubeName ?? '');
      const views = (await getCubeViewNames(config, cubeName).catch(() => [] as string[])).slice().sort();
      postTo<HostToWebview>(panel.webview, { type: 'viewList', cubeName, views });
    } catch (err) {
      logFetchError('fetchViews', err);
      postTo<HostToWebview>(panel.webview, { type: 'viewList', cubeName: msg.cubeName, views: [] });
    }
  },

  fetchDimensions: async (msg, ctx) => {
    const { panel, config } = ctx;
    postTo<HostToWebview>(panel.webview, {
      type: 'dimensionList', dimensions: await fetchDimensionNames(config, logFetchError),
    });
  },

  fetchHierarchies: async (msg, ctx) => {
    const { panel, config } = ctx;
    const dimension = String(msg.dimension ?? '');
    postTo<HostToWebview>(panel.webview, {
      type: 'hierarchyList', dimension,
      hierarchies: await fetchHierarchyNamesFor(config, dimension, logFetchError),
    });
  },

  fetchSubsets: async (msg, ctx) => {
    const { panel, config } = ctx;
    try {
      const dimName = String(msg.dimensionName ?? '');
      const subsets = (await listPublicSubsetNames(config, dimName, dimName)).slice().sort();
      postTo<HostToWebview>(panel.webview, { type: 'subsetList', dimensionName: dimName, subsets });
    } catch (err) {
      logFetchError('fetchSubsets', err);
      postTo<HostToWebview>(panel.webview, { type: 'subsetList', dimensionName: msg.dimensionName, subsets: [] });
    }
  },

  fetchOdbcDsns: async (msg, ctx) => {
    const { panel, config } = ctx;
    try {
      const dsnRes = await apiRequest('GET', 'SQLDataSources?$select=Name', undefined, undefined, config);
      const items: string[] = isOk(dsnRes)
        ? ((JSON.parse(dsnRes.body).value ?? []) as Array<{ Name?: string }>)
            .map((d) => String(d.Name ?? ''))
            .sort()
        : [];
      postTo<HostToWebview>(panel.webview, { type: 'odbcDsnList', items });
    } catch (err) {
      logFetchError('fetchOdbcDsns', err);
      postTo<HostToWebview>(panel.webview, { type: 'odbcDsnList', items: [] });
    }
  },

  fetchCubeDimensions: async (msg, ctx) => {
    const { panel, config } = ctx;
    try {
      const cName = String(msg.cubeName ?? '');
      const dimensions = await getCubeDimensionNames(config, cName).catch(() => [] as string[]);
      postTo<HostToWebview>(panel.webview, { type: 'cubeDimensions', cubeName: cName, dimensions });
    } catch (err) {
      logFetchError('fetchCubeDimensions', err);
      postTo<HostToWebview>(panel.webview, { type: 'cubeDimensions', cubeName: msg.cubeName, dimensions: [] });
    }
  },

  fetchAsciiPreview: async (msg, ctx) => {
    const { panel, config } = ctx;
    await handleAsciiPreview(panel, msg, config);
  },

  fetchOdbcPreview: async (msg, ctx) => {
    const { panel, processName, config } = ctx;
    await handleOdbcPreview(panel, msg, processName, config);
  },

  fetchCubesWithDims: async (msg, ctx) => {
    const { panel, config } = ctx;
    postTo<HostToWebview>(panel.webview, {
      type: 'cubesWithDims', cubes: await fetchCubesWithDims(config, logFetchError),
    });
  },

  fetchProcesses: async (msg, ctx) => {
    const { panel, config } = ctx;
    // The parameter type now comes narrowed (`'Numeric' | 'String'`) rather than
    // as the server's raw string — the same shape the TI console has always
    // sent. The client is the same for both.
    postTo<HostToWebview>(panel.webview, {
      type: 'processList', processes: await fetchProcessList(config, logFetchError),
    });
  },

  requestLint: async (msg, ctx) => {
    const { panel, processName, serverKey, config } = ctx;
    const sec = (msg.sections ?? {}) as { prolog?: string; metadata?: string; data?: string; epilog?: string };
    const lintVer = ctx.session.lintVersion;
    lintVer.value++;
    lintAllSections(
      panel,
      {
        prolog:     sec.prolog     ?? '',
        metadata:   sec.metadata   ?? '',
        data:       sec.data       ?? '',
        epilog:     sec.epilog     ?? '',
        parameters: (Array.isArray(msg.parameters) ? msg.parameters : []) as ProcessParameter[],
        variables:  (Array.isArray(msg.variables)  ? msg.variables  : []) as ProcessVariable[],
        processName,
      },
      lintVer,
      config,
      serverKey,
    );
  },

  debugStart: async (msg, ctx) => {
    const { panel, panelKey, processName, serverKey, config } = ctx;
    // Auto-save first so the debug runs the latest editor state.
    if (msg.sections) {
      const saveOk = await handleMonacoSave(
        panel, panelKey, processName, serverKey,
        msg.sections, msg.parameters as ProcessParameter[], msg.dataSource as DataSource, msg.variables as ProcessVariable[], config,
        true,
        Number(msg.errorCount ?? 0),
      );
      if (!saveOk) { return; }
    }
    const rawParams = (Array.isArray(msg.parameters) ? msg.parameters : []) as ProcessParameter[];
    let debugParams: Array<{ Name: string; Value: string | number }>;
    if (rawParams.length > 0) {
      const formResult = await askParamsInPanel(panel, processName, rawParams, vscode.l10n.t('Debug'), config?.serverUrl ?? '');
      if (formResult === undefined) {
        // Reset webview debug mode — optimistically set before user cancelled
        postTo<HostToWebview>(panel.webview, { type: 'debugSessionEnded', status: '' });
        return;
      }
      debugParams = formResult;
    } else {
      debugParams = [];
    }
    const bpsRaw = Array.isArray(msg.breakpoints) ? msg.breakpoints : [];
    const bps = bpsRaw
      .map((b) => ({
        section: capitalizeSection(String(b.section ?? '')),
        line: Number(b.line ?? 0),
        condition: typeof b.condition === 'string' ? b.condition : undefined,
        hitCondition: typeof b.hitCondition === 'string' ? b.hitCondition : undefined,
      }))
      .filter((b) => b.section && b.line > 0);
    const { handleDebugStart } = await import('./debug');
    await handleDebugStart(panelKey, panel, debugParams, bps);
  },

  debugCommand: async (msg, ctx) => {
    const { panel, panelKey } = ctx;
    const { handleDebugCommand } = await import('./debug');
    await handleDebugCommand(panelKey, panel, String(msg.command ?? ''));
  },

  setBreakpoint: async (msg, ctx) => {
    const { panel, panelKey } = ctx;
    const sectionCap = capitalizeSection(String(msg.section ?? ''));
    if (!sectionCap) { return; }
    const lineNo = Number(msg.line ?? 0);
    const enabled = Boolean(msg.enabled);
    const { handleBreakpoint } = await import('./debug');
    await handleBreakpoint(panelKey, panel, { section: sectionCap, line: lineNo, enabled });
  },

  setBreakpointCondition: async (msg, ctx) => {
    const { panelKey } = ctx;
    const sectionCap = capitalizeSection(String(msg.section ?? ''));
    if (!sectionCap) { return; }
    const { handleBreakpointCondition } = await import('./debug');
    handleBreakpointCondition(panelKey, {
      section: sectionCap,
      line: Number(msg.line ?? 0),
      condition: String(msg.condition ?? ''),
      hitCondition: String(msg.hitCondition ?? ''),
    });
  },

  resolveIdentifier: async (msg, ctx) => {
    const { panel } = ctx;
    const word = String(msg.word ?? '');
    const section = String(msg.section ?? '').toLowerCase();
    const localLine = Number(msg.line ?? 0);
    const requestId = msg.requestId as string; // the hover always sends one (identifierHover.ts)
    if (!word || !['prolog', 'metadata', 'data', 'epilog'].includes(section)) {
      postTo<HostToWebview>(panel.webview, { type: 'identifierInfo', requestId, info: null });
      return;
    }
    const secInline = (msg.sections ?? {}) as { prolog?: string; metadata?: string; data?: string; epilog?: string };
    const params = Array.isArray(msg.parameters) ? msg.parameters : [];
    const variables = Array.isArray(msg.variables) ? msg.variables : [];
    const sectionOrder = ['prolog', 'metadata', 'data', 'epilog'] as const;
    const sectionTexts: Record<typeof sectionOrder[number], string> = {
      prolog:   secInline.prolog   ?? '',
      metadata: secInline.metadata ?? '',
      data:     secInline.data     ?? '',
      epilog:   secInline.epilog   ?? '',
    };
    let globalLine = 0;
    for (const s of sectionOrder) {
      if (s === section) { globalLine += Math.max(0, localLine - 1); break; }
      globalLine += sectionTexts[s].split('\n').length;
    }
    const fullText = sectionOrder.map(s => sectionTexts[s]).join('\n');
    const paramArr = params as Array<{ Name?: unknown; Type?: unknown }>;
    const varArr = (variables as Array<{ Name?: unknown; Type?: unknown; Ignored?: unknown }>).filter(v => !v.Ignored);
    const paramNames = paramArr.map((p) => String(p.Name ?? ''));
    const meta = {
      params: paramArr.map((p) => ({ name: String(p.Name ?? ''), type: p.Type as TiVarType })),
      datasourceVars: varArr.map((v) => ({ name: String(v.Name ?? ''), type: v.Type as TiVarType })),
    };
    try {
      const info = lookupIdentifierInfo(word, fullText, globalLine, paramNames, meta);
      postTo<HostToWebview>(panel.webview, { type: 'identifierInfo', requestId, info });
    } catch (err) {
      logFetchError('lookupIdentifierInfo', err);
      postTo<HostToWebview>(panel.webview, { type: 'identifierInfo', requestId, info: null });
    }
  },

  requestResolver: async (msg, ctx) => {
    const { panel } = ctx;
    const sec = (msg.sections ?? {}) as { prolog?: string; metadata?: string; data?: string; epilog?: string };
    const params = Array.isArray(msg.parameters) ? msg.parameters : [];
    const variables = Array.isArray(msg.variables) ? msg.variables : [];
    const codeSections = {
      prolog:   sec.prolog   ?? '',
      metadata: sec.metadata ?? '',
      data:     sec.data     ?? '',
      epilog:   sec.epilog   ?? '',
    };
    const paramArr = params as ProtocolProcessParameter[];
    const varArr = (variables as ProtocolProcessVariable[]).filter(v => !(v as { Ignored?: unknown }).Ignored);
    const paramNames = paramArr.map((p) => String(p.Name ?? ''));
    const meta = {
      params: paramArr.map((p) => ({ name: String(p.Name ?? ''), type: p.Type as TiVarType })),
      datasourceVars: varArr.map((v) => ({ name: String(v.Name ?? ''), type: v.Type as TiVarType })),
    };
    try {
      const rows = buildResolverView(codeSections, paramNames, meta);
      postTo<HostToWebview>(panel.webview, { type: 'resolverData', rows });
    } catch (err) {
      const errText = err instanceof Error ? err.message : 'Unknown error';
      postTo<HostToWebview>(panel.webview, { type: 'resolverData', rows: [], error: errText });
    }
  },

  setFormatConfig: async (msg, ctx) => {
    const { serverKey } = ctx;
    await saveFormatConfig(serverKey, msg.config);
    for (const { panel: p, serverKey: sk } of _sessions.values()) {
      if (sk === serverKey) {
        postTo<HostToWebview>(p.webview, { type: 'formatConfig', config: msg.config });
      }
    }
  },

  setLintConfig: async (msg, ctx) => {
    const { serverKey } = ctx;
    await saveLintConfig(serverKey, msg.config);
    for (const { panel: p, serverKey: sk } of _sessions.values()) {
      if (sk === serverKey) {
        postTo<HostToWebview>(p.webview, { type: 'lintConfig', config: msg.config });
      }
    }
  },

  exportTiConfig: async (msg, ctx) => {
    const { serverKey } = ctx;
    const bundle = buildBundle(
      loadLintConfig(serverKey),
      loadFormatConfig(serverKey),
      loadRuleFormatConfig(serverKey),
      new Date().toISOString(),
    );
    const uri = await vscode.window.showSaveDialog({
      title: vscode.l10n.t('Export TI Configuration'),
      saveLabel: vscode.l10n.t('Export'),
      filters: { JSON: ['json'] },
      defaultUri: vscode.Uri.file('tm1-ti-config.json'),
    });
    if (!uri) { return; }
    try {
      const text = JSON.stringify(bundle, null, 2);
      await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
      void vscode.window.showInformationMessage(vscode.l10n.t('TI configuration exported.'));
    } catch (err) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Could not write the configuration file: {0}', errMsg(err)),
      );
    }
  },

  importTiConfig: async (msg, ctx) => {
    const { serverKey } = ctx;
    const uris = await vscode.window.showOpenDialog({
      title: vscode.l10n.t('Import TI Configuration'),
      openLabel: vscode.l10n.t('Import'),
      canSelectMany: false,
      filters: { JSON: ['json'] },
    });
    if (!uris || uris.length === 0) { return; }
    let parsed: ReturnType<typeof parseBundle> | undefined;
    try {
      const bytes = await vscode.workspace.fs.readFile(uris[0]);
      parsed = parseBundle(new TextDecoder().decode(bytes));
    } catch (err) {
      void vscode.window.showErrorMessage(
        vscode.l10n.t('Could not read the configuration file: {0}', errMsg(err)),
      );
      return;
    }
    if (!parsed.ok) {
      void vscode.window.showErrorMessage(vscode.l10n.t('Not a valid TM1 TI configuration file.'));
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      vscode.l10n.t('Overwrite the TI configuration for the current server with the imported file?'),
      { modal: true },
      vscode.l10n.t('Overwrite'),
    );
    if (!confirm) { return; }
    if (parsed.lint) {
      await saveLintConfig(serverKey, parsed.lint);
      for (const { panel: p, serverKey: sk } of _sessions.values()) {
        if (sk === serverKey) { postTo<HostToWebview>(p.webview, { type: 'lintConfig', config: parsed.lint }); }
      }
    }
    if (parsed.format) {
      await saveFormatConfig(serverKey, parsed.format);
      for (const { panel: p, serverKey: sk } of _sessions.values()) {
        if (sk === serverKey) { postTo<HostToWebview>(p.webview, { type: 'formatConfig', config: parsed.format }); }
      }
    }
    if (parsed.ruleFormat) {
      await saveRuleFormatConfig(serverKey, parsed.ruleFormat);
      RuleEditorManager.broadcastRuleFormatConfig(serverKey, parsed.ruleFormat);
    }
    void vscode.window.showInformationMessage(vscode.l10n.t('TI configuration imported.'));
  },
};

/**
 * Router for all WebviewToHost messages from a process editor panel. Delegates
 * to the exhaustive `processEditorTable` dispatch table. The `reopenAfterSave`
 * callback exists so `saveAs` can re-trigger `openProcess` for the freshly-
 * created process without a circular import.
 */
export async function handleMessage(
  session: PanelSession,
  msg: WebviewToHost,
  reopenAfterSave: (newProcessName: string) => Promise<void>,
): Promise<void> {
  if (!msg || !msg.type) { return; }
  const { panel, key: panelKey, processName, serverKey, config } = session;
  await dispatch(processEditorTable, msg, { session, panel, panelKey, processName, serverKey, config, reopenAfterSave });
}
