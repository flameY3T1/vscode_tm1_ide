// src/commands/dimension/dimensionBrowserHandlers.ts
//
// Message ROUTER of the dimension browser: the exhaustive dispatch table over
// `WebviewToHost`, the per-panel request generation, the panel title, and the
// modals. Everything a handler does beyond that is a call into a layer below.
//
// S2-8 (review 2026-08-02) lifted the REST half out — two thirds of this file
// spoke only to TM1 and never touched a panel:
//   - `tm1Rest/dimensionElementsApi.ts`  count, pages, attributes, by-name
//                                        lookups, MDX set evaluation
//   - `tm1Rest/dimensionTreeApi.ts`      children, subtree, ancestors, probe
//   - `tm1Rest/odataPaging.ts`           the `@odata.nextLink` follower
//   - `./dimensionSubsetSave.ts`         subset list/read/write incl. the
//                                        flatten modal (stays in commands/)
// Those modules are `vscode`-free (`tm1rest-no-vscode`), which is why the
// localized `assertOk` contexts are handed IN from the handlers below.
import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getServerNameByUrl, formatServerLabel, getServerIdByUrl } from '../../serverState/state';
import { getExtensionContext } from '../../utils/extensionContext';
import { loadAttrColumns, saveAttrColumns } from './attrColumnStore';
import { MdxRunnerManager } from '../mdx/mdxRunner';
import { listDimensionNames, listHierarchyNames } from '../../tm1Rest/dimensionApi';
import { attrCubeName, attrCubeExists } from './attrCube';
import { fetchAttrDefs, fetchHierarchyLevels, fetchDefaultMember } from '../../tm1Rest/dimensionElementsApi';
import { fetchAncestors } from '../../tm1Rest/dimensionTreeApi';
import {
  SAVE_CANCELLED,
  fetchSubsetElements,
  fetchSubsets,
  saveExpressionSubset,
  saveSubset,
} from './dimensionSubsetSave';
import type {
  DimElementSelection,
  HostToWebview,
  WebviewToHost,
} from '../../webviewClient/dimensionBrowser/protocol';
import { dispatch, type DispatchTable } from '../../webviews/dispatchTablePure';
import { errMsg } from '../../utils/errMsg';
import { handleFetchViewRows } from './viewRowsHandler';
import { handleFetchViewCount } from './viewCountHandler';
import { resolveStateReply } from '../workbench/stateAsk';
import { postTo } from '../../webviews/typedPost';

/** Options for opening the dimension browser in selection mode. */
export interface DimBrowserOptions {
  /** 'standalone' = existing read-only browser; 'selection' = selection picker for Cube Viewer etc. */
  mode: 'standalone' | 'selection';
  /** true = checkboxes + multi-select; false = single-click select */
  multiSelect: boolean;
  /** Restrict which element types are selectable. undefined = all types allowed. */
  allowedTypes?: ('N' | 'C' | 'S')[];
  /** Pre-selected element names (shown as checked when browser opens). */
  initialSelection?: string[];
  /** Alias attribute to open under — the counterpart of `onSelect`'s
   *  `displayAlias`. The caller already shows this dimension under an alias, so
   *  the browser opens under the same one instead of falling back to raw element
   *  names. Ignored when the dimension does not offer that attribute. */
  initialAlias?: string;
  /** Called when the user clicks "Apply" ("Übernehmen"). Panel is disposed afterwards.
   *  `displayAlias` is the alias attribute the user had active in the browser
   *  (empty string = none), so callers can mirror it in their own view. */
  onSelect?: (sel: DimElementSelection, displayAlias?: string, hierName?: string) => void;
  /** Keep the hierarchy picker usable in selection mode; `onSelect` then gets
   *  the hierarchy the user ended on. `taken` = hierarchies shown elsewhere. */
  hierSwitch?: { taken: string[] };
  /** Called after a subset has been saved — trigger tree refresh. */
  onSubsetSaved?: () => void;
  /** Open directly showing a specific subset's elements. */
  initialSubset?: { name: string; isPrivate: boolean };
  /**
   * Set expression the browser should be based on — the page query wraps
   * itself around it (`state._pageBaseMdx`) instead of starting from the
   * whole dimension.
   *
   * Meant for callers that DISPLAY an axis rather than having just picked a
   * selection (Cube Viewer): their MDX carries the expand/collapse state as a
   * DRILL*MEMBER chain, and `initialSelection` — a name list — cannot express
   * that.
   */
  initialSourceMdx?: string;
  /**
   * May the answer be an EXPRESSION instead of a name list
   * (`DimElementSelection` with `kind: 'expression'`)?
   *
   * Only for callers that can put MDX on their axis. Anyone who needs a name
   * list (process editor parameters, security matrices) leaves this out and
   * keeps getting names — even when the user has expanded/collapsed nodes in
   * the browser.
   */
  acceptsExpression?: boolean;
  /**
   * Why NO `initialSourceMdx` came along. Purely diagnostic — appears in the
   * composition diagnostics (Ctrl+Alt+K), so that a silent fallback to the
   * name list stays distinguishable from not having tried at all.
   */
  initialSourceNote?: string;
  /** If true, also fetch and send the subset's MDX Expression to the webview for editing. */
  editSubset?: boolean;
  /** Pre-fetched MDX Expression for editSubset — posted synchronously if provided. */
  initialExpression?: string | null;
  /** Open directly on this hierarchy (e.g. from a hierarchy tree node) instead of the default. */
  initialHier?: string;
  /**
   * Column the browser panel should open in. Meant for callers that are
   * themselves a panel (Cube Viewer): they pass their own `panel.viewColumn`
   * through so the browser appears in the same window — even when the
   * caller was dragged into its own window via "Move Editor into New
   * Window". Omitting it (or `undefined`, when the calling panel is
   * currently invisible) falls back to the host default `ViewColumn.Active`.
   */
  viewColumn?: vscode.ViewColumn;
}

/**
 * Injected context for every dimension-browser message handler (A2 dispatch
 * table). Handlers touch no module globals — `post` is pre-bound to the panel,
 * so a handler is unit-testable with a stub `ctx`.
 */
export interface DimBrowserCtx {
  readonly panel: vscode.WebviewPanel;
  /** Post a host→webview message (pre-bound to `panel.webview.postMessage`). */
  readonly post: (msg: HostToWebview) => void;
  readonly config: Tm1Config;
  readonly options?: DimBrowserOptions;
}



export function _serverLabel(config?: Tm1Config): string | undefined {
  return formatServerLabel(config?.serverUrl, getServerNameByUrl);
}

/**
 * The profile id behind `config`, for the remembered attribute columns
 * (`attrColumnStore.ts`) — the same id that `deleteServer` cleans up with.
 * `getServerIdByUrl` looks it up among the CONNECTED profiles; the browser
 * is always connected while it is open. Without a hit (e.g. tests without a
 * connection) it falls back to the URL, rather than not remembering at all.
 */
function _attrColumnServerId(config?: Tm1Config): string {
  const url = config?.serverUrl ?? '';
  return getServerIdByUrl(url) ?? url;
}

// ── Load-bearing query vs. side dressing ────────────────────────────────
// A handler that throws ends up in `setError` and thus in
// `setViewPhase('error')`: the `WebviewPanelHost` does not dispose the
// subscription, catches the exception in the `onDidReceiveMessage` wrapper and
// calls `onError`, and `dimensionBrowser.ts` then posts `setError` — which
// turns off the WHOLE table in the webview (`msgSession.ts`).
//
// For the load-bearing queries (`fetchViewRows`) that is correct. For the
// side dressing — attribute list, level list, subset list, subset elements —
// it is wrong: filling a selection field must not make correctly loaded rows
// disappear. `secondary` makes this distinction visible in ONE place: the
// error is reported, the phase stays where it was.
//
// DEVIATION from the task (deliberate, see feedback): the protocol
// (`webviewClient/dimensionBrowser/protocol.ts`) has NO host→webview message
// that triggers `flashBanner` in the client. The only way there is
// `viewRows` with `ok: false`, and `onViewRows` discards that without a
// matching `requestId` — so it is unsuitable as a reporting channel for a
// side query. Until the protocol gets its own banner message (its own round,
// the client is off limits here), the report goes over the same channel
// `drillAncestors` already uses: the VS Code warning. No silent fallback.
function reportSideError(message: string): void {
  vscode.window.showWarningMessage(message);
}

/**
 * Wrap a secondary handler: if it throws, the error is REPORTED, but not
 * propagated further — the table stays as it was.
 *
 * `message` builds the user-facing text from the error. The caller supplies
 * it, because only it knows WHAT could not be loaded.
 */
function secondary<M>(
  fn: (msg: M, ctx: DimBrowserCtx) => Promise<void>,
  message: (err: unknown) => string,
): (msg: M, ctx: DimBrowserCtx) => Promise<void> {
  return async (msg, ctx) => {
    try {
      await fn(msg, ctx);
    } catch (err) {
      reportSideError(message(err));
    }
  };
}

/**
 * Panel title `<Server> : <Mode>: <Dim>`.
 *
 * Two callers build the same string: the panel creation in
 * `dimensionBrowser.ts` and the `fetchElements` handler, which updates the
 * title after loading. Previously written out twice — every change in one
 * place left the other one out of sync.
 */
export function _panelTitle(config: Tm1Config | undefined, dimName: string | undefined, isSelection: boolean): string {
  const label = _serverLabel(config);
  const base = isSelection
    ? vscode.l10n.t('Selection: {0}', dimName ?? 'Dimension')
    : (dimName ? vscode.l10n.t('Elements: {0}', dimName) : 'TM1 Dimension Browser');
  return label ? `${label} : ${base}` : base;
}

// ── Dispatch table ──────────────────────────────────────────────
// Exhaustive over WebviewToHost: a missing `type` is a compile error.
export const dimBrowserTable: DispatchTable<WebviewToHost, DimBrowserCtx> = {
  // Answer to the workbench's state question. No guard needed: the
  // bookkeeping in `stateAsk` checks the token and discards anything foreign.
  stateReply: (msg) => { resolveStateReply(msg.token, msg.state); },
  // Identical to the open path, just without a preferred hierarchy: the webview
  // asks for the list, `_loadDimension` answers it — one implementation.
  fetchHierarchies: async (msg, { panel, config }) => {
    await _loadDimension(panel, msg.dimName, config);
  },

  openAttrCube: async (msg, { config }) => {
    if (!config) {
      vscode.window.showWarningMessage(vscode.l10n.t('TM1: Attribute cube cannot be opened — no server context.'));
      return;
    }
    const attrCube = attrCubeName(msg.dimName);
    if (!(await attrCubeExists(msg.dimName, config))) {
      vscode.window.showWarningMessage(
        vscode.l10n.t('Attribute cube "{0}" does not exist. Create an attribute so TM1 generates the cube.', attrCube),
      );
      return;
    }
    // Open via internal command to avoid a dimensionBrowser → cubeViewer import
    // cycle (cubeViewer already imports DimElementSelection from this module).
    await vscode.commands.executeCommand('tm1.internal.openCubeByName', attrCube, config);
  },

  openDimensionEditor: async (msg, { config }) => {
    if (!config) {
      vscode.window.showWarningMessage(vscode.l10n.t('TM1: Dimension editor cannot be opened — no server context.'));
      return;
    }
    // Same cycle dodge as openAttrCube: dimensionEditor pulls in cubeViewer,
    // which imports openDimensionBrowser — a direct import would close the loop.
    await vscode.commands.executeCommand(
      'tm1.internal.openDimensionEditor', msg.dimName, config, msg.hierName || undefined,
    );
  },


  drillAncestors: async (msg, { post, config }) => {
    const { dimName, hierName, element, recursive } = msg;
    try {
      const { elements, edges } = await fetchAncestors(
        dimName, hierName, element, recursive, config, vscode.l10n.t('Load ancestors'),
      );
      // Send dim/hier along (K11): the client discards the answer if it
      // belongs to a hierarchy that has meanwhile been left — otherwise its
      // elements and edges would end up in the `_allData` of the NEW hierarchy.
      post({ type: 'ancestors', dimName, hierName, element, elements, edges });
    } catch (err) {
      // The empty structure stays, so the client does not break — but it
      // alone is not distinguishable from "this element has no parents".
      // That is why the reason goes out over the same reporting channel as
      // the `secondary` side dressing.
      post({ type: 'ancestors', dimName, hierName, element, elements: [], edges: [] });
      reportSideError(vscode.l10n.t('Failed to load parents: {0}', errMsg(err)));
    }
  },

  /**
   * Only the attribute definitions — the new loading path needs names for the
   * selection list, not the values per element (that is `fetchAttributes`).
   * The old path got them delivered inside the `setElementPage` payload; the
   * new one turns around beforehand and therefore has to ask for them itself.
   */
  fetchAttrDefs: secondary(async (msg, { post, config }) => {
    const defs = await fetchAttrDefs(msg.dimName, msg.hierName, config);
    post({ type: 'attrDefs', dimName: msg.dimName, hierName: msg.hierName, defs });
  }, (err) => vscode.l10n.t('TM1: Could not load the attribute list: {0}', errMsg(err))),

  /**
   * The hierarchy's levels. `Levels?$select=Name,Number` is cheap (measured
   * live 2026-08-23: 1 ms) — the numbers come from the server, instead of
   * guessing them from loaded elements the way the old path does
   * (`filterUi.ts`), which needs the whole dimension in memory for that.
   */
  fetchLevels: secondary(async (msg, { post, config }) => {
    const levels = await fetchHierarchyLevels(msg.dimName, msg.hierName, config);
    post({ type: 'levels', dimName: msg.dimName, hierName: msg.hierName, levels });
  }, (err) => vscode.l10n.t('TM1: Could not load the hierarchy levels: {0}', errMsg(err))),

  selectionConfirmed: (msg, { panel, options }) => {
    options?.onSelect?.(msg.selection, msg.displayAlias, msg.hierName);
    panel.dispose();
  },

  openMdxRunner: (msg, { config }) => {
    const mdx = msg.mdx ?? '';
    if (!mdx || !config) {
      vscode.window.showWarningMessage(vscode.l10n.t('TM1: Cannot open MDX Runner — no server context.'));
      return;
    }
    const label = getServerNameByUrl(config.serverUrl) ?? config.serverUrl;
    MdxRunnerManager.openWithMdx(config, label, mdx);
  },

  fetchSubsets: secondary(async (msg, { post, config }) => {
    const subsets = await fetchSubsets(msg.dimName, msg.hierName, config);
    post({ type: 'setSubsets', dimName: msg.dimName, hierName: msg.hierName, subsets });
  }, (err) => vscode.l10n.t('TM1: Could not load the subset list: {0}', errMsg(err))),

  fetchSubsetElements: secondary(async (msg, { post, config }) => {
    const { elements, expression, alias, complete, expressionKnown } = await fetchSubsetElements(msg.dimName, msg.hierName, msg.subsetName, msg.isPrivate, config);
    // The list is shown either way — seeing part of a subset is useful. Saving it
    // back is what `saveSubset` refuses (the read state travels with the subset).
    if (!complete) {
      vscode.window.showWarningMessage(vscode.l10n.t(
        'TM1: Subset "{0}" was only read partially ({1} elements) — the server aborted the list. Saving is blocked until it loads completely.',
        msg.subsetName, elements.length,
      ));
    }
    // Echo the request's dim/hier: each fetch is an independent REST pair with
    // no ordering guarantee, so the client needs to recognise a reply that lands
    // after a dim/hier switch (see the guard in the webview's `msg.ts`).
    post({
      type: 'setSubsetElements', dimName: msg.dimName, hierName: msg.hierName,
      subsetName: msg.subsetName, isPrivate: msg.isPrivate, elements, expression, alias,
      // Only sent when the expression could NOT be read — an absent flag keeps
      // the old meaning of `expression: null` ("this subset is static").
      ...(expressionKnown ? {} : { expressionUnread: true }),
    });
  }, (err) => vscode.l10n.t('TM1: Could not load the subset elements: {0}', errMsg(err))),

  fetchDefaultMember: async (msg, { post, config }) => {
    const name = await fetchDefaultMember(msg.dimName, msg.hierName, config);
    post({ type: 'setDefaultMember', name });
  },


  saveSubset: async (msg, { post, config, options }) => {
    const subsetName = msg.subsetName.trim();
    const expression = msg.expression?.trim() ?? '';

    if (!msg.dimName || !msg.hierName || !subsetName) {
      post({ type: 'subsetSaveResult', ok: false, message: 'Name must not be empty.' });
      return;
    }
    if (!expression && !msg.elements.length) {
      post({ type: 'subsetSaveResult', ok: false, message: vscode.l10n.t('No elements selected.') });
      return;
    }

    // Blank means "raw names" — kept as null so the POST body omits the property
    // instead of writing an empty alias the user never chose.
    const alias = msg.displayAlias?.trim() || null;

    try {
      const result = expression
        ? await saveExpressionSubset(msg.dimName, msg.hierName, subsetName, msg.isPrivate, expression, msg.overwrite, config, alias)
        : await saveSubset(msg.dimName, msg.hierName, subsetName, msg.isPrivate, msg.elements, msg.overwrite, config, alias);
      if (result === SAVE_CANCELLED) {
        // User declined the flatten warning — nothing was written. Answer anyway
        // so the webview releases its "saving…" state instead of hanging.
        post({ type: 'subsetSaveResult', ok: false, cancelled: true, message: vscode.l10n.t('Save cancelled — the subset is unchanged.') });
        return;
      }
      post({ type: 'subsetSaveResult', ok: true, message: result });
      options?.onSubsetSaved?.();
    } catch (err) {
      post({ type: 'subsetSaveResult', ok: false, message: errMsg(err) });
    }
  },

  // P1-8b: intercepted (and answered) earlier in dimensionBrowser.ts's
  // onDidReceiveMessage callback, before dispatch is ever called for it —
  // this entry exists only so the dispatch table stays exhaustive over the
  // WebviewToHost union (mirrors cubeViewer's messaging.ts `webviewReady` no-op).
  webviewReady: () => {
    // Handshake-only message — no host action here (handled upstream).
  },

  fetchViewRows: async (msg, { post, config, panel }) => {
    await handleFetchViewRows(msg, config, post, panel);
  },

  fetchViewCount: async (msg, { post, config }) => {
    await handleFetchViewCount(msg, config, post);
  },

  // Sent from the two places that change the column state (control callback,
  // releasing the drag handle). Side dressing: a failure while remembering
  // must not turn off the table.
  saveAttrColumns: secondary(async (msg, { config }) => {
    const extCtx = getExtensionContext();
    if (!extCtx) { return; }
    await saveAttrColumns(extCtx, _attrColumnServerId(config), msg.dimName, msg.cols, msg.widths);
  }, (err) => vscode.l10n.t('TM1: Could not save the attribute columns: {0}', errMsg(err))),
};

/**
 * Route a webview→host message through the dispatch table. Signature kept
 * stable (`panel, msg, config?, options?`) for its callers: `openDimensionBrowser`
 * in `dimensionBrowser.ts` (the real extension-host wiring) and the existing
 * message tests (the only other importer).
 */
export async function _handleMessage(
  panel: vscode.WebviewPanel,
  msg: WebviewToHost,
  config: Tm1Config,
  options?: DimBrowserOptions,
): Promise<void> {
  await dispatch(dimBrowserTable, msg, {
    panel,
    post: (m: HostToWebview) => { postTo<HostToWebview>(panel.webview, m); },
    config,
    options,
  });
}

/**
 * Fetches hierarchy list, then sends setHierarchies (which triggers the webview to fetch elements).
 *
 * The only loading path — the `fetchHierarchies` handler also routes through
 * here; it differs only in that it does not pass a `preferHier`.
 */
export async function _loadDimension(
  panel: vscode.WebviewPanel, dimName: string, config: Tm1Config, preferHier?: string,
  /**
   * The send path — normally straight to the panel.
   *
   * On the FIRST open, the caller passes in a path that additionally holds
   * back the three messages until the webview has reported its receipt.
   * Without that they get lost while the bundle is still loading in the
   * frame — and `setHierarchies` is the message that triggers the drawing in
   * the first place (see `dimensionBrowser.ts#openDimensionBrowser`).
   */
  postOverride?: (m: HostToWebview) => void,
): Promise<void> {
  const post = postOverride ?? ((m: HostToWebview): void => { postTo<HostToWebview>(panel.webview, m); });
  const hiers = await _fetchHierarchies(dimName, config);
  // Hierarchy-aware open: honor a preferred hierarchy (e.g. from a hierarchy tree
  // node) when it exists; otherwise fall back to the default (first) hierarchy.
  const selectedHier = (preferHier && hiers.indexOf(preferHier) >= 0)
    ? preferHier
    : (hiers[0] ?? dimName);
  // BEFORE `setHierarchies`: once that posts, the `setHierarchies` handler in
  // the webview triggers `startView`/`fetchRows()` SYNCHRONOUSLY and, while doing
  // so, reads the column state that this message is just setting. If it came
  // LATER, the first window would fetch without the remembered columns and
  // immediately reload (visible double loading when opening every dimension).
  const extCtx = getExtensionContext();
  const { cols, widths } = extCtx
    ? loadAttrColumns(extCtx, _attrColumnServerId(config), dimName)
    : { cols: [], widths: {} };
  post({ type: 'attrColumns', dimName, cols, widths });
  post({ type: 'setHierarchies', hiers, selectedHier, selectedDim: dimName });
  post({ type: 'setAttrCubeExists', exists: await attrCubeExists(dimName, config) });
  // The webview auto-fires fetchElements upon receiving setHierarchies.
}

export async function _fetchDimensions(config: Tm1Config): Promise<string[]> {
  const names = await listDimensionNames(config, 5000);
  return names.slice().sort((a, b) => a.localeCompare(b));
}

async function _fetchHierarchies(dimName: string, config: Tm1Config): Promise<string[]> {
  const names = await listHierarchyNames(config, dimName);
  const filtered = names.filter(Boolean);
  // Prefer default hier (same name as dim) first, then non-system, then system (}).
  // Prevents }Leaves_* or }ElementAttributes_* ending up as selectedHier.
  return filtered.sort((a, b) => {
    const aDefault = a === dimName ? 0 : 1;
    const bDefault = b === dimName ? 0 : 1;
    if (aDefault !== bDefault) { return aDefault - bDefault; }
    const aSys = a.startsWith('}') ? 1 : 0;
    const bSys = b.startsWith('}') ? 1 : 0;
    if (aSys !== bSys) { return aSys - bSys; }
    return a.localeCompare(b);
  });
}
