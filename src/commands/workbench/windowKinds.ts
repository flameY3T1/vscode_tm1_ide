import * as vscode from 'vscode';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import type { KeyShape } from './windowKindsPure';
import { CubeViewerManager } from '../cubeViewer/manager';
import { RuleEditorManager } from '../rule/ruleEditor';
import { openDimensionBrowser } from '../dimension/dimensionBrowser';
import { openProcess } from '../processEditor/openPanel';
import { ChoreEditorManager } from '../chore/choreEditor';
import { MdxRunnerManager } from '../mdx/mdxRunner';
import { captureCubeViewerState } from './captureCubeViewer';
import { captureDimBrowserState } from './captureDimBrowser';
import type { CubeViewerState, DimBrowserState } from './captureStatePure';
import { postTo } from '../../webviews/typedPost';
import type { HostToWebview as CubeViewerIn } from '../../webviewClient/cubeViewerMonaco/protocol';

/** A window, as it stands in a workbench. */
export interface SavedWindow {
  kind: string;
  target?: string;
  state?: unknown;
}

/**
 * What `reopen` needs beyond the server.
 *
 * Not every manager gets by with `(name, cfg)`: the MDX runner wants the
 * `ExtensionContext` and a server label, the chore editor a callback to
 * refresh the tree. Instead of smuggling these dependencies into the
 * table, the restore flow passes them through.
 */
export interface ReopenContext {
  serverId: string;
  serverLabel: string;
  extensionContext: vscode.ExtensionContext;
  refreshTree(): void;
}

export interface WindowKind {
  /**
   * Heading in the selection window.
   *
   * A function instead of a literal: `WINDOW_KINDS` is a module-level
   * constant, and a bare `vscode.l10n.t(...)` at this spot would run when
   * the module loads — before VS Code's localization bundle is ready — and
   * would freeze the untranslated text forever. The function moves the
   * call to the moment the selection window actually asks for it.
   */
  group(): string;
  /** How to read the raw panel key. Default: `'server::target'`. */
  keyShape?: KeyShape;
  /** true = never belongs in a workbench. Then `reopen` is forbidden. */
  transient?: boolean;
  label(w: SavedWindow): string;
  /** Preview line in the selection window. Without state: undefined. */
  describe?(state: unknown): string | undefined;
  /**
   * Reads the state from what the panel already carries anyway.
   *
   * `target` is passed along so `capture` can cut the known object name out
   * of the key instead of guessing at its structure — a server URL itself
   * contains colons, and whether the second-to-last part is a port or a
   * cube name CANNOT be decided from the key alone.
   *
   * May return a `Promise`: what a window SHOWS lives in its webview
   * (`buildCurrentMdx()`, `state._compose`), and asking it is a round trip.
   * `collectCandidates` asks all windows concurrently and caps each
   * window — a silent window does not hold up the collection.
   */
  capture?(panel: vscode.WebviewPanel, rawKey: string, target?: string): unknown | Promise<unknown>;
  reopen?(w: SavedWindow, cfg: Tm1Config, ctx: ReopenContext): Promise<void>;
  /**
   * What makes two windows of this kind recognizable as THE SAME.
   *
   * Needed when editing a workbench: a saved entry and a currently open
   * window are supposed to produce one entry, not two.
   *
   * The default is `kind|target`. Whoever needs more says so here — the
   * cube viewer, for instance, whose view name determines the panel key
   * and therefore belongs to the identity. The DISPLAYED CONTENT does not
   * belong there: otherwise the same window would count as a different one
   * after every change.
   */
  identity?(w: SavedWindow): string;
  /**
   * Applies the saved state to the freshly opened panel.
   *
   * Separate from `reopen`, because `reopen` does not return its panel (all
   * managers return `Promise<void>`) — the flow looks it up in the
   * directory and passes it in here. If the method is missing, the window
   * opens as before.
   */
  applyState?(panel: vscode.WebviewPanel, w: SavedWindow): void;
}

/**
 * The ONE table. Whoever adds a window kind only changes this file —
 * directory, storage, selection window, tree, and restore all read from
 * here and know nothing about any individual kind.
 *
 * Key = the panel's `viewType` (host panels), or the name under which a
 * manager registers.
 *
 * Kinds not listed here fall back to `DEFAULT_KIND`: they get saved, are
 * listed under "Other" in the selection window and in the tree, and are
 * reported by name as not opened when restoring. This version CANNOT open
 * them back up — the key is a `viewType`, not a command name, and guessing
 * a call from it opens nothing at best. That is exactly why the default
 * is nevertheless NOT transient: a workbench written by a newer version
 * does not lose the window here — it appears in storage and in the
 * message instead of silently going missing.
 */
export const WINDOW_KINDS: Record<string, WindowKind> = {
  tm1CubeViewer: {
    group: () => vscode.l10n.t('Cube Viewer'),
    label: (w) => w.target ?? vscode.l10n.t('Cube Viewer'),
    describe: (s) => {
      const st = s as CubeViewerState | undefined;
      if (!st) { return undefined; }
      // The unread state comes FIRST: it is the qualifier under which
      // everything else has to be read.
      if (st.stateRead === false) { return vscode.l10n.t('state not read'); }
      const parts: string[] = [];
      if (st.viewName) { parts.push(vscode.l10n.t('view "{0}"', st.viewName)); }
      else if (st.mdx) { parts.push(vscode.l10n.t('free MDX query')); }
      if (st.viewName && st.mdx) { parts.push(vscode.l10n.t('modified')); }
      if (st.mdxDropped) { parts.push(vscode.l10n.t('query too large to keep')); }
      return parts.length ? parts.join(' · ') : undefined;
    },
    capture: (panel, rawKey, target) => captureCubeViewerState(panel, rawKey, target),
    identity: (w) => {
      const st = w.state as CubeViewerState | undefined;
      // View name AND privacy: `${server}:${cube}:${view}:priv` is a
      // different panel than without `:priv`.
      return `tm1CubeViewer|${w.target ?? ''}|${st?.viewName ?? ''}|${st?.isPrivate ? 'p' : ''}`;
    },
    applyState: (panel, w) => {
      const st = w.state as CubeViewerState | undefined;
      // The MDX already travels along via `CubeViewerManager.open(...,
      // mdx)`; here only the control shell gets added on top.
      if (st?.ui) { void postTo<CubeViewerIn>(panel.webview, { type: 'applyState', ui: st.ui }); }
    },
    reopen: async (w, cfg) => {
      const st = w.state as CubeViewerState | undefined;
      // Last argument: EXECUTE the expression. A restored window should
      // show what it showed — not offer the expression in the editor and
      // hand the work back (click test "test2view").
      //
      // `st?.viewName` is more than decoration here: it determines the
      // panel key. Without it, two cube viewers on the same cube get the
      // same one, and the second `open` turns into a `reveal` of the
      // first — only one window opened.
      await CubeViewerManager.open(w.target ?? '', cfg, st?.viewName, st?.isPrivate, st?.mdx, true);
    },
  },

  tm1RuleEditor: {
    group: () => vscode.l10n.t('Rule Editor'),
    label: (w) => w.target ?? vscode.l10n.t('Rule Editor'),
    reopen: async (w, cfg) => { await RuleEditorManager.open(w.target ?? '', cfg); },
  },

  tm1DimensionBrowser: {
    group: () => vscode.l10n.t('Dimension Browser'),
    label: (w) => w.target ?? vscode.l10n.t('Dimension Browser'),
    describe: (s) => {
      const st = s as DimBrowserState | undefined;
      if (!st) { return undefined; }
      if (st.stateRead === false) { return vscode.l10n.t('state not read'); }
      const parts: string[] = [];
      if (st.hierarchy) { parts.push(vscode.l10n.t('hierarchy "{0}"', st.hierarchy)); }
      if (st.subset) { parts.push(vscode.l10n.t('subset "{0}"', st.subset.name)); }
      // "Expression" instead of the expression: the line should say THAT
      // the view is restricted, without spelling out the MDX.
      if (st.mdx) { parts.push(vscode.l10n.t('custom set')); }
      if (st.mdxDropped) { parts.push(vscode.l10n.t('query too large to keep')); }
      return parts.length ? parts.join(' · ') : undefined;
    },
    capture: (panel) => captureDimBrowserState(panel),
    reopen: async (w, cfg) => {
      const st = w.state as DimBrowserState | undefined;
      // No separate apply path needed: `DimBrowserOptions` already accepts
      // expression, hierarchy, and alias — it is the same path the cube
      // viewer uses to hand over its axis (`startView(..., initialMdx,
      // initialAlias)`). If the expression is missing (not read, or over
      // the cap), the window opens on the dimension as before.
      await openDimensionBrowser(w.target, cfg, {
        mode: 'standalone', multiSelect: false,
        initialHier: st?.hierarchy, initialAlias: st?.alias,
        initialSourceMdx: st?.mdx, initialSubset: st?.subset,
      });
    },
  },

  tm1ProcessEditor: {
    group: () => vscode.l10n.t('Process Editor'),
    label: (w) => w.target ?? vscode.l10n.t('Process Editor'),
    reopen: async (w, cfg) => {
      // `openProcess` returns `false` (and shows its own toast) when the
      // process could not be loaded instead of throwing — the only one of
      // the reopened managers whose failure is otherwise reachable here.
      // Throwing turns that into a summary entry instead of a silent "ok".
      const opened = await openProcess(w.target ?? '', undefined, cfg);
      if (!opened) {
        throw new Error(vscode.l10n.t('process "{0}" could not be loaded', w.target ?? ''));
      }
    },
  },

  tm1ChoreEditor: {
    group: () => vscode.l10n.t('Chore Editor'),
    label: (w) => w.target ?? vscode.l10n.t('Chore Editor'),
    reopen: async (w, cfg, ctx) => { await ChoreEditorManager.open(w.target ?? null, cfg, ctx.refreshTree); },
  },

  tm1MdxRunner: {
    group: () => vscode.l10n.t('MDX Runner'),
    // Server-wide, no object — and the key is `${serverId}|${serverUrl}`, so
    // neither `server` nor `server::target`. The manager registers itself
    // with `serverId`, so the key is never interpreted.
    keyShape: 'none',
    label: () => vscode.l10n.t('MDX Runner'),
    reopen: async (_w, cfg, ctx) => {
      MdxRunnerManager.open(ctx.extensionContext, ctx.serverId, cfg, ctx.serverLabel);
    },
  },

  // Throwaway window: its own key space `${serverUrl}::sel#<n>`, belongs to
  // no one and should not reappear after a restart.
  tm1DimensionBrowserSelection: { group: () => '', transient: true, label: () => '' },
  // Live native monitoring has no restorable state or credentials.
  tm1Top: { group: () => '', keyShape: 'server', transient: true, label: () => '' },

  // Tool windows with no server relation, or no purpose after a restart.
  'tm1.addServer':     { group: () => '', transient: true, label: () => '' },
  'tm1.findReplace':   { group: () => '', transient: true, label: () => '' },
  // `keyShape` gone since 2026-08-30: the key is now `${serverUrl}::${cube}`.
  'tm1.reorderDims':   { group: () => '', transient: true, label: () => '' },
  'tm1.workbenchPicker': { group: () => '', transient: true, label: () => '' },
  // A snippet window with no state: what is in it is a one-liner from a
  // moment ago, not an object of the model.
  // `keyShape` gone: the key is now `${serverUrl}::ti#${serverId}`.
  'tm1.tiConsole':     { group: () => '', transient: true, label: () => '' },
  // Bulk delete: a work list from a moment ago, not an object of the model.
  'tm1.bulkDelete':    { group: () => '', transient: true, label: () => '' },
  // Compare view plus an unsaved draft; reopening it later would show stale edges.
  'tm1.consolidationCompare': { group: () => '', transient: true, label: () => '' },
  'tm1.bulkDeploy':    { group: () => '', transient: true, label: () => '' },
  tm1TransactionLog:   { group: () => '', keyShape: 'server', transient: true, label: () => '' },
  // Runs live only in the window; after a restart there would be nothing to show.
  'tm1.processCoverage': { group: () => '', transient: true, label: () => '' },

  // Lever B (2026-08-30): the eleven panels that used to be hand-built now
  // run through `WebviewPanelHost` and thereby register HERE. Without their
  // own line, they would fall back to `DEFAULT_KIND` — which is NOT
  // transient, and the window store would suddenly offer them under
  // "Other" with a technical name. Until now they never showed up
  // anywhere; `transient` pins down exactly that.
  //
  // Four of them are wizards (new process, parameter form ×2, new cube,
  // area/DB builder): restoring a half-filled-out form after a restart
  // makes no sense. The others would in principle be restorable (server
  // configuration, call graph, snippet and template editor, the two
  // review views) — that needs a `reopen`, and that is its own step, not a
  // byproduct of the life-cycle work.
  'tm1.serverConfig':          { group: () => '', transient: true, label: () => '' },
  'tm1.usageGraph':            { group: () => '', transient: true, label: () => '' },
  tm1SnippetEditor:            { group: () => '', transient: true, keyShape: 'none', label: () => '' },
  tm1ProcessTemplateEditor:    { group: () => '', transient: true, keyShape: 'none', label: () => '' },
  'tm1.tiTestSummary':         { group: () => '', transient: true, keyShape: 'none', label: () => '' },
  'tm1.tiTestDiff':            { group: () => '', transient: true, keyShape: 'none', label: () => '' },
  tm1AreaDbBuilder:            { group: () => '', transient: true, label: () => '' },
  tm1CreateCube:               { group: () => '', transient: true, label: () => '' },
  tm1NewProcess:               { group: () => '', transient: true, label: () => '' },
  tm1Params:                   { group: () => '', transient: true, label: () => '' },
  tm1ServerParams:             { group: () => '', transient: true, label: () => '' },
  tm1DatasourceConfig:         { group: () => '', transient: true, label: () => '' },

  // Review 2026-10-03, A2: host panels that never got a line, so the
  // workbench stored them under "Other" and restore answered "window type
  // unknown". Analyses, reports and admin matrices are re-run from the tree;
  // none has a `reopen` yet. The guard in windowKinds.test.ts now scans every
  // host viewType so a new panel cannot slip past this table again.
  'tm1.processGrouping':       { group: () => '', transient: true, label: () => '' },
  'tm1.valueNaming':           { group: () => '', transient: true, label: () => '' },
  'tm1.consistencyNormalizer': { group: () => '', transient: true, label: () => '' },
  'tm1.feederAudit':           { group: () => '', transient: true, label: () => '' },
  'tm1.lineage':               { group: () => '', transient: true, label: () => '' },
  'tm1.v12Readiness':          { group: () => '', transient: true, label: () => '' },
  tm1MessageLogStartup:        { group: () => '', transient: true, label: () => '' },
  tm1MessageLogAnalysis:       { group: () => '', transient: true, label: () => '' },
  'tm1.userGroupManager':      { group: () => '', transient: true, label: () => '' },
  'tm1.elementSecurity':       { group: () => '', transient: true, label: () => '' },
  'tm1.dimSecurityMatrix':     { group: () => '', transient: true, label: () => '' },
  'tm1.processSecurityMatrix': { group: () => '', transient: true, label: () => '' },
  'tm1.cubeSecurityMatrix':    { group: () => '', transient: true, label: () => '' },
  'tm1.cellSecurityBuilder':   { group: () => '', transient: true, label: () => '' },
  'tm1.gitConfig':             { group: () => '', transient: true, label: () => '' },
};

/** For kinds that (still) have no line. */
export const DEFAULT_KIND: WindowKind = {
  group: () => vscode.l10n.t('Other'),
  // `w.kind` is a technical identifier (the `viewType`), deliberately not
  // translated — not a linguistic expression, but a raw value.
  label: (w) => w.target ?? w.kind,
};

/**
 * The kind for a saved `kind` name — or `DEFAULT_KIND`.
 *
 * An explicit own-property check instead of `?? DEFAULT_KIND`:
 * `WINDOW_KINDS` is an object literal and therefore has a prototype. For
 * `name = 'toString'`, the index access returns the PROTOTYPE member
 * instead of `undefined`, `??` does not kick in, and the next access
 * (`kind.label(w)`) throws. The name comes from storage and is therefore
 * an arbitrary string — nothing that can be relied on (review 2026-08-24,
 * H4).
 *
 * `hasOwnProperty.call` instead of `Object.hasOwn`: the project is on
 * `lib: ES2020`, `Object.hasOwn` is ES2022. Raising the lib for the whole
 * project for one line would be the wrong lever.
 */
export function kindOf(name: string): WindowKind {
  return Object.prototype.hasOwnProperty.call(WINDOW_KINDS, name)
    ? WINDOW_KINDS[name]!
    : DEFAULT_KIND;
}

/**
 * The identity of a window — default `kind|target`.
 *
 * Deliberately a function ALONGSIDE the table instead of a required field
 * in it: the vast majority of kinds have nothing to add, and a required
 * field would mean writing the same line twenty times.
 */
export function identityOf(w: SavedWindow): string {
  const kind = kindOf(w.kind);
  return kind.identity ? kind.identity(w) : `${w.kind}|${w.target ?? ''}`;
}
