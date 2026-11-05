// src/commands/dimension/dimensionEditor.ts
// Manager for the Dimension Editor (v1.6.0). Panel lifecycle + initData snapshot load.
// Interaction and commit wiring come in later tasks (12-20).

import { setPanelIcon } from '../../webviews/panelIcons';
import { muteWebviewOnDispose } from '../../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { identityTag } from '../../tm1Rest/transport/session';
import { DimensionApi } from '../../tm1Rest/dimensionApi';
import { dispatch, type DispatchTable } from '../../webviews/dispatchTablePure';
import { apiFetch } from '../../tm1Rest/dimensionApi';
import { listCubes } from '../../tm1Rest/cubeApi';
import { attrCubeName, attrCubeExists } from './attrCube';
import { listSubsetsWithElements } from '../../tm1Rest/subsetApi';
import type { DimDraftState, DimSnapshot, ElementDraft } from '../../dimensionEditor/model';
import { computeDiff } from '../../dimensionEditor/diff';
import { planCommit } from '../../dimensionEditor/commitPlanner';
import { commitChanges } from '../../dimensionEditor/restEditCommitter';
import { commitNewDimension } from '../../dimensionEditor/restCreateCommitter';
import { findElementReferences } from '../../usageCheck/elementUsage';
import type { UsageRef } from '../../usageCheck/elementUsage';
import { getOrBuildIndex } from '../../references/referenceIndexService';
import { CubeViewerManager } from '../cubeViewer/manager';
import { getDimensionEditorHtml } from './dimensionEditorWebview';
import { getServerNameByUrl, formatServerLabel } from '../../serverState/state';
import type {
  HostToWebview,
  WebviewToHost,
  DimEditorDraftPayload,
} from '../../webviewClient/dimensionEditor/protocol';
import { readDefaultMembers, setDefaultMember } from '../../tm1Rest/defaultMemberApi';
import { readSortOrder, setSortOrder } from '../../tm1Rest/sortOrderApi';
import { startRun, finishRun } from '../../runState/runRegistry';
import { errMsg } from '../../utils/errMsg';
import { getExtensionContext } from '../../utils/extensionContext';
import {
  clearDimensionDraft, dimensionDraftKey, draftFitsStore, loadDimensionDraft, saveDimensionDraft,
  type DimensionDraft,
} from './dimensionDraftStore';
import { validateDimName } from '../../dimensionEditor/dimNameValidation';
import { fetchNames, invalidateCache } from '../../providers/fetchNames';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';
import { postTo } from '../../webviews/typedPost';

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

/**
 * Offers a parked draft for this dimension/hierarchy and returns it when the user
 * wants it back. Declining drops the draft — leaving it would re-ask on every
 * open. A draft that cannot be shown (store corrupt, shape drift) is simply absent.
 */
async function offerParkedDraft(
  serverUrl: string, dimName: string, hierName: string,
): Promise<DimensionDraft | undefined> {
  const memento = getExtensionContext()?.globalState;
  if (!memento) { return undefined; }
  const key = dimensionDraftKey(serverUrl, dimName, hierName);
  const parked = loadDimensionDraft(memento, key);
  if (!parked) { return undefined; }

  const restore = vscode.l10n.t('Restore');
  const discard = vscode.l10n.t('Discard');
  const when = new Date(parked.savedAt).toLocaleString();
  const pick = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'Dimension "{0}" has unsaved changes from {1} (hierarchy "{2}"). Restore them?',
      dimName, when, hierName,
    ),
    { modal: true }, restore, discard,
  );
  await clearDimensionDraft(memento, key);
  return pick === restore ? parked : undefined;
}

/** Injected context for a dimension-editor message handler (A2 dispatch table).
 *  Handlers touch no closure locals except `setDirty`, which writes back to the
 *  panel-local dirty flag captured by `open()`. */
interface DimEditorCtx {
  readonly panel: vscode.WebviewPanel;
  readonly dimName: string;
  readonly hierName: string | undefined;
  readonly config: Tm1Config;
  readonly api: DimensionApi;
  readonly setDirty: (v: boolean) => void;
  /** Remembers that the parked draft exceeded the store cap (close message). */
  readonly setDraftTooLarge: (v: boolean) => void;
  /** Opened via "Sort Order…" in the tree: open the sort dialog once loaded. */
  readonly openSortOrder: boolean;
}

// Exhaustive over WebviewToHost (dimension editor) — a missing `type` is a compile error.
const dimEditorTable: DispatchTable<WebviewToHost, DimEditorCtx> = {
  dirtyState: async (msg, ctx) => {
    ctx.setDirty(!!msg.dirty);
  },

  draftSync: async (msg, ctx) => {
    // Park the webview's working state so closing the panel stops being final.
    // Runs on every debounced push; the store overwrites the previous entry.
    const draft = msg.draft as DimensionDraft | undefined;
    const memento = getExtensionContext()?.globalState;
    if (!draft || !draft.dimName || !memento) { return; }
    const key = dimensionDraftKey(ctx.config.serverUrl, ctx.dimName, draft.hierName ?? ctx.dimName);
    if (!draftFitsStore(draft)) {
      // Too big for globalState. Say so at close time instead of promising a
      // restore that cannot happen.
      ctx.setDraftTooLarge(true);
      await clearDimensionDraft(memento, key);
      return;
    }
    ctx.setDraftTooLarge(false);
    await saveDimensionDraft(memento, key, draft, Date.now());
  },

  ready: async (_msg, ctx) => {
    const { panel, dimName, hierName, config, api } = ctx;
    try {
      // Lazy hierarchy load: only load the default hierarchy. Other hierarchies
      // get loaded on demand via the 'fetchHier' message. Saves RAM on
      // dimensions with many large hierarchies.
      const hierarchies = await api.fetchHierarchyList(dimName);
      // Hierarchy-aware open: if invoked from a hierarchy tree node, load that
      // hierarchy first instead of the default (hierarchies[0]).
      const defaultHier = (hierName && hierarchies.indexOf(hierName) >= 0)
        ? hierName
        : (hierarchies[0] ?? dimName);
      const snap = await api.fetchSnapshot(dimName, [defaultHier]);
      const attrExists = await attrCubeExists(dimName, config);
      const draft = buildDraftPayload(snap, defaultHier, config.serverUrl, attrExists);
      // Deliver the loaded hierarchy's default element afterwards. Deliberately
      // AFTER `initData`, so a slow control-cube read does not hold up the
      // opening, and best-effort: without the marker, the editor is still usable.
      const postDefaultMember = (): void => {
        void readDefaultMembers(dimName, [defaultHier], config)
          .then(states => post(panel, { type: 'defaultMemberState', states }))
          .catch(() => { /* marker is skipped, editor stays usable */ });
      };
      // Unsaved work from a previous close? Offer it before showing server state.
      const restored = await offerParkedDraft(config.serverUrl, dimName, defaultHier);
      if (restored) {
        post(panel, { type: 'initData', state: { ...restored, attrCubeExists: attrExists } as typeof draft });
        postDefaultMember();
        return;
      }
      post(panel, { type: 'initData', state: draft });
      postDefaultMember();
      if (ctx.openSortOrder) { post(panel, { type: 'openSortOrder', hier: defaultHier }); }
    } catch (err) {
      const message = errMsg(err);
      post(panel, { type: 'loadError', message });
      vscode.window.showErrorMessage(vscode.l10n.t('Dim editor "{0}": {1}', dimName, message));
    }
  },

  fetchHier: async (msg, ctx) => {
    const { panel, dimName, api } = ctx;
    // On-demand load of a hierarchy after a switch in the webview.
    const targetHier = msg.hier;
    if (!targetHier) { return; }
    try {
      const content = await api.fetchHierarchyContent(dimName, targetHier);
      post(panel, { type: 'mergeHier', hier: targetHier, content });
      void readDefaultMembers(dimName, [targetHier], ctx.config)
        .then(states => post(panel, { type: 'defaultMemberState', states }))
        .catch(() => { /* see above */ });
    } catch (err) {
      post(panel, { type: 'mergeHier', hier: targetHier, error: errMsg(err) });
    }
  },

  setDefaultMember: async (msg, ctx) => {
    const { panel, dimName, config } = ctx;
    // The refresh took 3.5 s on a dimension with 1.63 million elements — too
    // long for a silent wait, so it goes through the run indicator instead.
    const runId = startRun({
      label: vscode.l10n.t('Set default member'),
      objectName: `${dimName}:${msg.hier}`,
      kind: 'Processes',
      serverUrl: config.serverUrl,
      cancel: () => { /* RefreshMdxHierarchy cannot be cancelled */ },
    });
    try {
      // Call without arguments: `defaultMemberApi` fills in the placeholders
      // itself, because it knows the values there. `vscode.l10n.t` would only
      // get them here to substitute them right back in.
      const state = await setDefaultMember(dimName, msg.hier, msg.element, config, {
        unknownElement: vscode.l10n.t('Element "{0}" does not exist in hierarchy "{1}".'),
        verifyFailed: vscode.l10n.t('Set "{0}", but TM1 still uses "{1}".'),
        resetFailed: vscode.l10n.t('Reset had no effect — "{0}" is still set.'),
      });
      post(panel, { type: 'defaultMemberResult', ok: true, hier: msg.hier, state });
    } catch (err) {
      post(panel, { type: 'defaultMemberResult', ok: false, hier: msg.hier, message: errMsg(err) });
    } finally {
      finishRun(runId);
    }
  },

  readSortOrder: async (msg, ctx) => {
    const { panel, dimName, config } = ctx;
    try {
      const sort = await readSortOrder(dimName, msg.hier, config);
      post(panel, { type: 'sortOrderState', hier: msg.hier, sort });
    } catch (err) {
      post(panel, { type: 'sortOrderState', hier: msg.hier, message: errMsg(err) });
    }
  },

  setSortOrder: async (msg, ctx) => {
    const { panel, dimName, config, api } = ctx;
    try {
      await setSortOrder(dimName, msg.hier, msg.sort, config);
      // The sort rewrites the element order on the server: reload, like after a
      // commit. The webview decides whether to apply it — the draft may have
      // been edited while the sort ran.
      const snap = await api.fetchSnapshot(dimName, [msg.hier]);
      post(panel, { type: 'sortOrderResult', ok: true, state: buildDraftPayload(snap, msg.hier, config.serverUrl) });
    } catch (err) {
      post(panel, { type: 'sortOrderResult', ok: false, message: errMsg(err) });
    }
  },

  checkUsage: async (msg, ctx) => {
    const { panel, dimName, config } = ctx;
    const elements = msg.elements ?? [];
    try {
      const index = await getOrBuildIndex(config);
      const cubes = await listCubes(config, {
        select: 'Name', top: 10000, expand: 'Dimensions($select=Name)',
      }).catch(() => [] as Array<{ Name: string; Dimensions?: Array<{ Name: string }> }>);
      const cubesWithDim: string[] = cubes
        .filter(c => (c.Dimensions ?? []).some(d => d.Name === dimName))
        .map(c => c.Name);
      let _subsetsCache: Array<{ name: string; isPrivate: boolean; elements: string[] }> | null = null;
      const subsetsFetcher = async () => {
        if (_subsetsCache) { return _subsetsCache; }
        const subs = await listSubsetsWithElements(config, dimName, dimName);
        _subsetsCache = subs.map(s => ({
          name: s.Name,
          isPrivate: false,
          elements: (s.Elements ?? []).map(e => e.Name),
        }));
        return _subsetsCache;
      };
      const usages: Array<UsageRef & { element: string }> = [];
      for (const element of elements) {
        const refs = await findElementReferences({
          dim: dimName,
          element,
          index,
          cubesContainingDim: cubesWithDim,
          subsetsFetcher,
          viewsFetcher: async () => [],
        });
        for (const r of refs) { usages.push({ ...r, element }); }
      }
      post(panel, { type: 'confirmDelete', elements, usages });
    } catch (err) {
      post(panel, { type: 'confirmDelete', elements, usages: [] });
      vscode.window.showWarningMessage(vscode.l10n.t('Usage check failed: {0}', errMsg(err)));
    }
  },

  commit: async (msg, ctx) => {
    const { panel, dimName, config, api } = ctx;
    try {
      const state = deserializeState(msg.state);
      const diff = computeDiff(state);
      const plan = planCommit(diff);
      const activeHier = state.hierName ?? dimName;
      const result = await commitChanges(plan, dimName, activeHier, api);
      post(panel, { type: 'commitResult', ok: result.ok, errors: result.errors });
      if (result.ok) {
        // Saved — the parked draft would otherwise be offered again on next open.
        const memento = getExtensionContext()?.globalState;
        if (memento) {
          await clearDimensionDraft(memento, dimensionDraftKey(config.serverUrl, dimName, activeHier));
        }
        ctx.setDraftTooLarge(false);
      }
      if (result.ok) {
        const snap = await api.fetchSnapshot(dimName, [activeHier]);
        post(panel, { type: 'initData', state: buildDraftPayload(snap, activeHier, config.serverUrl) });
      } else if (result.serverMayHaveChanged) {
        // Keep the working state: replacing it would discard every change
        // that was not applied. Re-basing on the server state leaves exactly
        // the failed and skipped changes in the next diff.
        const snap = await api.fetchSnapshot(dimName, [activeHier]);
        post(panel, { type: 'rebaseSnapshot', snapshot: snap });
      }
    } catch (err) {
      post(panel, { type: 'commitResult', ok: false, errors: [{ message: errMsg(err) }] });
    }
  },

  saveAsNew: async (msg, ctx) => {
    const { dimName, config, api } = ctx;
    try {
      const existing = await fetchNames('Dimensions', config).catch(() => [] as string[]);
      const raw = await vscode.window.showInputBox({
        prompt: vscode.l10n.t('Name of the new dimension (copy of "{0}")', dimName),
        placeHolder: vscode.l10n.t('e.g. Year'),
        ignoreFocusOut: true,
        validateInput: (val: string) => validateDimName(val, existing),
      });
      if (raw === undefined) { return; }
      const newName = raw.trim();

      const emptySnapshot: DimSnapshot = {
        dimName: newName,
        hierarchies: [newName],
        perHier: { [newName]: { elements: [], edges: [], attrDefs: [] } },
      };
      let saveAsState: DimDraftState;
      if (msg.state !== undefined) {
        // Dirty: the complete editor state came from the webview. Commit it as
        // "everything is new" against an EMPTY snapshot — every non-deleted
        // element/edge/attrDef becomes an add. hierName = newName, so the
        // changes hit the new dimension's default hierarchy (content = the
        // active source hierarchy).
        const state = deserializeState(msg.state);
        const deletedEls = new Set(
          [...state.elements.values()].filter(e => e.marked === 'deleted').map(e => e.name),
        );
        saveAsState = {
          ...state,
          dimName: newName,
          hierName: newName,
          hierarchies: [newName],
          edges: state.edges.filter(e =>
            e.marked !== 'deleted' && !deletedEls.has(e.parent) && !deletedEls.has(e.child)),
          snapshot: emptySnapshot,
        };
      } else {
        // Unchanged: load the active source hierarchy fresh from the server and
        // clone it as a brand-new state (everything 'clean' → commitNewDimension
        // adds everything). Saves serializing and transferring the complete
        // draft back across the webview boundary — the lion's share of the
        // runtime on large dims.
        const activeHier = msg.activeHier ?? dimName;
        const content = await api.fetchHierarchyContent(dimName, activeHier);
        saveAsState = {
          serverId: config.serverUrl,
          dimName: newName,
          hierName: newName,
          hierarchies: [newName],
          elements: new Map(content.elements.map(e => [e.name, e])),
          edges: content.edges,
          attrDefs: content.attrDefs,
          snapshot: emptySnapshot,
          dirty: false,
        };
      }
      const newApi = new DimensionApi(apiFetch, { dimName: newName, config });
      const result = await commitNewDimension(saveAsState, newName, newName, newApi);

      invalidateCache('Dimensions', config.serverUrl);
      void vscode.commands.executeCommand('tm1.refreshExplorer');
      if (result.ok) {
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Dimension "{0}" created.', newName));
        await DimensionEditorManager.open(newName, config);
      } else {
        vscode.window.showErrorMessage(vscode.l10n.t(
          'Dimension "{0}" created, but {1} change(s) failed: {2}',
          newName, result.errors.length, result.errors[0]?.message ?? '',
        ));
      }
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Dim editor "{0}": {1}', dimName, errMsg(err)));
    }
  },

  openAttrCube: async (_msg, ctx) => {
    const { dimName, config } = ctx;
    try {
      const attrCube = attrCubeName(dimName);
      const exists = await attrCubeExists(dimName, config);
      if (!exists) {
        vscode.window.showWarningMessage(
          vscode.l10n.t('Attribute cube "{0}" does not exist. Create an attribute so TM1 generates the cube.', attrCube),
        );
        return;
      }
      await CubeViewerManager.open(attrCube, config);
    } catch (err) {
      vscode.window.showErrorMessage(vscode.l10n.t('Dim editor "{0}": {1}', dimName, errMsg(err)));
    }
  },

  discard: async (msg, ctx) => {
    const { panel, dimName, config, api } = ctx;
    try {
      // Only load the active hierarchy (memory optimization).
      const activeHier = msg.hier || dimName;
      const snap = await api.fetchSnapshot(dimName, [activeHier]);
      post(panel, {
        type: 'initData',
        state: buildDraftPayload(snap, activeHier, config.serverUrl),
      });
    } catch (err) {
      post(panel, { type: 'loadError', message: errMsg(err) });
    }
  },
};

export class DimensionEditorManager {
  private static _panels = new Map<string, vscode.WebviewPanel>();
  private static _extensionUri: vscode.Uri | null = null;

  /** Wire the extension URI so the webview shell can resolve the bundled JS via `webview.asWebviewUri`. */
  static initialize(extensionUri: vscode.Uri): void {
    DimensionEditorManager._extensionUri = extensionUri;
  }

  // Identity tag: two profiles on one URL must not share a panel (see identityTag).
  private static panelKey(config: Tm1Config, dimName: string): string {
    return `${config.serverUrl}|@${identityTag(config)}|${dimName}`;
  }

  /** `openSortOrder`: show the sort dialog on top (tree entry "Sort Order…"). */
  static async open(dimName: string, config: Tm1Config, hierName?: string, openSortOrder = false): Promise<void> {
    if (!DimensionEditorManager._extensionUri) {
      throw new Error('DimensionEditorManager not initialized — call initialize(extensionUri) on activation.');
    }
    const key = this.panelKey(config, dimName);
    const existing = this._panels.get(key);
    if (existing) {
      // Without a column argument, the panel stays in its own column.
      existing.reveal();
      if (openSortOrder) { post(existing, { type: 'openSortOrder', hier: hierName ?? dimName }); }
      return;
    }

    const serverLabel = formatServerLabel(config.serverUrl, getServerNameByUrl);
    const panelTitle = serverLabel ? `${serverLabel} : Dim: ${dimName}` : `Dim: ${dimName}`;
    const panel = vscode.window.createWebviewPanel(
      'tm1DimensionEditor',
      panelTitle,
      // Symbolic column: opens in the active group and thus in the same
      // window as the click that triggered it.
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(DimensionEditorManager._extensionUri, 'out'),
          vscode.Uri.joinPath(DimensionEditorManager._extensionUri, 'media'),
        ],
      },
    );
    setPanelIcon(panel, 'tm1DimensionEditor');
    muteWebviewOnDispose(panel);
    panel.webview.html = getDimensionEditorHtml(panel.webview, DimensionEditorManager._extensionUri);
    this._panels.set(key, panel);
    let isDirty = false;
    let draftTooLarge = false;
    panel.onDidDispose(() => {
      this._panels.delete(key);
      if (isDirty) {
        // The draft was parked by `draftSync` while typing — unless it was too
        // big for the store, in which case the old (honest) wording applies.
        vscode.window.showWarningMessage(
          draftTooLarge
            ? vscode.l10n.t('Dimension "{0}": editor closed with unsaved changes. The change set was too large to keep — the changes are lost.', dimName)
            : vscode.l10n.t('Dimension "{0}": editor closed with unsaved changes. They are kept and offered again the next time you open it.', dimName),
        );
      }
    });

    const api = new DimensionApi(apiFetch, { dimName, config });

    // Prompts/confirms run purely in the webview via HTML modals (no showInputBox).
    // Hierarchy switch is likewise handled locally via state.snapshot.perHier.
    panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
      if (!msg || !msg.type) return;
      await dispatch(dimEditorTable, msg, {
        panel, dimName, hierName, config, api,
        setDirty: (v) => { isDirty = v; },
        setDraftTooLarge: (v) => { draftTooLarge = v; },
        openSortOrder,
      });
    });
  }

  static disposeAll(): void {
    for (const p of this._panels.values()) p.dispose();
    this._panels.clear();
  }

  /** Close every dimension-editor panel that belongs to the given server. */
  static disposePanelsForServer(serverUrl: string): void {
    if (!serverUrl) { return; }
    const prefix = `${serverUrl}|`;
    const toClose: vscode.WebviewPanel[] = [];
    for (const [key, panel] of this._panels) {
      if (key.startsWith(prefix)) { toClose.push(panel); }
    }
    for (const p of toClose) { p.dispose(); }
  }
}

registerServerDisposer('dimensionEditor', (url) => DimensionEditorManager.disposePanelsForServer(url));

/** Deserializes the state sent by the webview. `elements` comes in as a plain
 *  object; but `computeDiff` expects a Map — we convert here. */
function deserializeState(raw: unknown): DimDraftState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const elementsRaw = (r.elements ?? {}) as Record<string, ElementDraft>;
  const entries: Array<[string, ElementDraft]> = Object.entries(elementsRaw);
  return {
    serverId: r.serverId as string,
    dimName: r.dimName as string,
    hierName: r.hierName as string,
    hierarchies: Array.isArray(r.hierarchies) ? r.hierarchies as string[] : [],
    elements: new Map(entries),
    edges: Array.isArray(r.edges) ? r.edges as DimDraftState['edges'] : [],
    attrDefs: Array.isArray(r.attrDefs) ? r.attrDefs as DimDraftState['attrDefs'] : [],
    snapshot: r.snapshot as DimSnapshot,
    dirty: !!r.dirty,
  };
}


/** Builds the draft payload for a given hierarchy from a snapshot.
 *  elements is transported as a plain object (a Map is not postMessage-safe). */
function buildDraftPayload(
  snap: DimSnapshot,
  hierName: string,
  serverUrl: string,
  attrCubeExists?: boolean,
): DimEditorDraftPayload {
  // Fallback: if hierName is not in the snapshot (e.g. newly created locally), use empty sets.
  const h = snap.perHier[hierName] ?? { elements: [], edges: [], attrDefs: [] };
  const base: DimEditorDraftPayload = {
    serverId: serverUrl,
    dimName: snap.dimName,
    hierName,
    hierarchies: [...snap.hierarchies],
    elements: Object.fromEntries(h.elements.map(e => [e.name, { ...e }])),
    edges: h.edges.map(e => ({ ...e })),
    attrDefs: h.attrDefs.map(a => ({ ...a })),
    snapshot: snap,
    dirty: false,
  };
  if (attrCubeExists !== undefined) { base.attrCubeExists = attrCubeExists; }
  return base;
}

/** For tests only: access to the dispatch table without the panel lifecycle. */
export const _dimEditorTableForTest = dimEditorTable;
