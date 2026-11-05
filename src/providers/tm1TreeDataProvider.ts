import * as vscode from 'vscode';
import { Tm1TreeNode, getIconForNodeType } from './tm1TreeNodes';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { listFiles, isUserFile } from '../tm1Rest/filesApi';
import { fetchNames } from './fetchNames';
import { listApplications, type AppEntry } from '../tm1Rest/applicationsApi';
import { listThreads } from '../tm1Rest/threadApi';
import { listChores } from '../tm1Rest/choreApi';
import { listProcesses } from '../tm1Rest/processApi';
import { listCubes, getCubeDimensionHierarchies, getCubeViews, cubeHasRules } from '../tm1Rest/cubeApi';
import { fetchCubeLoadStates } from '../tm1Rest/runStatsApi';
import { indexPicklistCubes } from './picklistCubePure';
import { mdxViewLabel } from './treeViewLabelPure';
import { dedupeTreeNodeIds } from './treeNodeIdDedupePure';
import {
  listDimensionNames, listHierarchyNames, listElementAttributes,
} from '../tm1Rest/dimensionApi';
import { listSubsetInfos } from '../tm1Rest/subsetApi';
import { listSandboxes, isSandboxEnabled } from '../tm1Rest/sandboxApi';
import type { SandboxTracker } from '../tm1Rest/sandboxTracker';
import type { ServerProfile } from '../serverState/state';
import { listServerFolders, getProcessGroupOverrides } from '../serverState/profiles';
import { listAdminServers, getAdminServer } from '../serverState/adminServers';
import { discoverAndSync, lastInstanceCount, type DiscoveryResult } from './adminDiscovery';
import { groupServersByFolder } from '../serverState/serverFoldersPure';
import { describeInstanceListError } from './adminInstances';
import type { TiSnippet } from '../snippets/snippetStorage';
import type { ProcessTemplate } from '../processTemplates/processTemplateTypes';
import {
  groupProcesses,
  DEFAULT_PROCESS_GROUP_MODE,
  type ProcessGroup,
  type ProcessGroupingMode,
} from './processGroupingPure';
import {
  splitControlObjects,
  controlClusterId,
  type ControlCluster,
} from './controlObjectClusters';
import { isBedrockInstalled, setBedrockInstalled } from '../bedrock/bedrockStateCache';
import {
  filterByName as _pureFilterByName,
  resolveProcessGroupConfig as _pureResolveProcessGroupConfig,
  formatTreeError as _pureFormatTreeError,
} from './tm1TreeDataProviderPure';
import type { TreeExpansionStore, Memento } from './treeExpansionStore';
import { errMsg } from '../utils/errMsg';
// The slice of commands/workbench/workbenchStore the tree reads, declared
// here so providers/ does not import commands/.
interface WorkbenchStore {
  list(serverId: string): ReadonlyArray<{ id: string; name: string; windows: readonly unknown[] }>;
}

/** Object groups whose names run through the control-object visibility filter. */
export type TreeObjectGroup = 'Cubes' | 'Dimensions' | 'Processes' | 'Chores';

/**
 * The subset of {@link TreeObjectGroup} that has a Show/Hide menu entry. Chores
 * are filtered too but not toggleable, so they cannot reach `toggleSystemObjects`.
 */
export type ControlToggleGroup = 'Cubes' | 'Dimensions' | 'Processes';

const CONTROL_TOGGLE_GROUPS: readonly string[] = ['Cubes', 'Dimensions', 'Processes'];

/** Narrows a category node's `categoryKey` to a toggleable group. */
export function isControlToggleGroup(key: unknown): key is ControlToggleGroup {
  return typeof key === 'string' && CONTROL_TOGGLE_GROUPS.includes(key);
}

/** workspaceState key holding the shown-groups list (`serverId::Group`). */
const CONTROL_OBJECTS_STORAGE_KEY = 'tm1.tree.controlObjectsShown';

/**
 * TreeDataProvider for the TM1 Object Explorer.
 * Shows all configured servers as root nodes; connected servers are expandable.
 */
export class Tm1TreeDataProvider implements vscode.TreeDataProvider<Tm1TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<Tm1TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _filterText: string = '';
  /**
   * Object groups whose control objects are currently SHOWN, keyed
   * `${serverId}::${group}`. Absent = hidden, so the default stays "hidden"
   * without seeding an entry per server. Per GROUP, not per server: switching
   * the cubes on must not also unhide the dimensions (flameY3T1, 2026-08-18).
   * Chores are filtered with the same helper but have no menu entry, so their
   * key is never set — they stay hidden, exactly as the UI offered before.
   */
  private _showControlObjects = new Set<string>();
  private _autoRefreshTimer?: NodeJS.Timeout;
  /**
   * Retains the exact category-node instances last returned from getChildren,
   * keyed `${serverId}::${categoryKey}`. `refreshCategory` fires the retained
   * instance so VS Code matches its internal cached node and re-fetches only
   * that subtree (P1 — targeted tree refresh).
   */
  private _categoryNodeCache = new Map<string, Tm1TreeNode>();
  /**
   * Memoised "does this cube have rules?" result, keyed `${serverId}::${cubeName}`.
   * Avoids re-fetching the full rules text on every cube expand (P — conditional
   * Rules node). Evicted on rule save (`invalidateCubeRulesCache`) and on
   * disconnect/removal (`clearCategoryCacheForServer`). Only authoritative
   * results (cfg present + successful fetch) are cached; the tolerant TRUE
   * fallback is not, so transient errors don't stick.
   */
  private _cubeHasRulesCache = new Map<string, boolean>();

  private _workbenchStore: WorkbenchStore | undefined;

  /** Supplied after construction (order in `extension.ts`). */
  setWorkbenchStore(store: WorkbenchStore): void {
    this._workbenchStore = store;
  }

  private _isViewVisible: (() => boolean) | undefined;

  /**
   * `treeView.visible` supplied after the fact — the view is only created
   * after the provider. Stored on the provider instead of as a parameter of
   * `startAutoRefresh`, because the tick also restarts on a settings change
   * (`registerWorkspaceHandlers`) and must not lose this gate in the
   * process.
   */
  setVisibilityProbe(isVisible: () => boolean): void {
    this._isViewVisible = isVisible;
  }

  constructor(
    private readonly _getServers: () => ServerProfile[],
    private readonly _isConnected: (id: string) => boolean,
    private readonly _getConfig: (id: string) => Tm1Config | undefined,
    private readonly _getSnippets: () => TiSnippet[] = () => [],
    private readonly _getProcessTemplates: () => ProcessTemplate[] = () => [],
    private readonly _extensionUri?: vscode.Uri,
    private readonly _expansionStore?: TreeExpansionStore,
    private readonly _sandboxTracker?: SandboxTracker,
    private readonly _controlObjectsMemento?: Memento,
  ) {
    const stored = this._controlObjectsMemento?.get<string[]>(CONTROL_OBJECTS_STORAGE_KEY);
    if (Array.isArray(stored)) { this._showControlObjects = new Set(stored); }
  }

  /**
   * Promotes `Collapsed` to `Expanded` when the persisted expansion store
   * has the node's id recorded. Leaves `None` (leaf) and `Expanded` untouched.
   */
  private _applyExpansion(node: Tm1TreeNode): Tm1TreeNode {
    if (!this._expansionStore) { return node; }
    if (node.collapsibleState !== vscode.TreeItemCollapsibleState.Collapsed) { return node; }
    if (typeof node.id === 'string' && this._expansionStore.isExpanded(node.id)) {
      node.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    }
    return node;
  }

  isHidingSystemObjects(serverId: string, group: TreeObjectGroup): boolean {
    return !this._showControlObjects.has(`${serverId}::${group}`);
  }

  /**
   * True when ANY object group on this server currently shows control objects.
   * The usage/call graph spans cubes, dimensions, processes and chores at once,
   * so it cannot ask per group — it follows "the user has unhidden something
   * here" rather than picking one group's answer arbitrarily.
   */
  isShowingAnyControlObjects(serverId: string): boolean {
    return CONTROL_TOGGLE_GROUPS.some(g => this._showControlObjects.has(`${serverId}::${g}`));
  }

  /** Drops a deleted profile's control-object toggles (workspaceState). */
  forgetServer(serverId: string): void {
    const prefix = `${serverId}::`;
    const before = this._showControlObjects.size;
    for (const k of this._showControlObjects) {
      if (k.startsWith(prefix)) { this._showControlObjects.delete(k); }
    }
    if (this._showControlObjects.size === before) { return; }
    void this._controlObjectsMemento?.update(
      CONTROL_OBJECTS_STORAGE_KEY, Array.from(this._showControlObjects));
  }

  toggleSystemObjects(serverId: string, group: ControlToggleGroup): void {
    const key = `${serverId}::${group}`;
    if (!this._showControlObjects.delete(key)) { this._showControlObjects.add(key); }
    void this._controlObjectsMemento?.update(
      CONTROL_OBJECTS_STORAGE_KEY, Array.from(this._showControlObjects));
    this.refresh();
  }

  getTreeItem(element: Tm1TreeNode): vscode.TreeItem {
    if (element.nodeType === 'serverRoot' && element.meta.connected && this._extensionUri) {
      const idle = this._idleServers.has(element.meta.serverId);
      if (!!element.meta.sessionIdle !== idle) {
        element.meta.sessionIdle = idle;
        element.iconPath = getIconForNodeType('serverRoot', element.meta, this._extensionUri);
      }
    }
    return element;
  }

  // ── Cube load state (context menu: Load OR Unload) ─────────────────────────
  private _cubeLoad = new Map<string, Map<string, boolean>>();
  /** serverId|cube → state set by our own Load/Unload, and until when it beats the stats. */
  private _cubeLoadOverride = new Map<string, { loaded: boolean; until: number }>();

  /** Loaded state for the menu; `undefined` = unknown (both actions offered). */
  cubeLoaded(serverId: string, cube: string): boolean | undefined {
    const key = `${serverId}|${cube.toLowerCase()}`;
    const o = this._cubeLoadOverride.get(key);
    const measured = this._cubeLoad.get(serverId)?.get(cube.toLowerCase());
    if (o) {
      if (o.until > Date.now()) { return o.loaded; }
      // Our own Unload stays until the stats count cells again: }StatsByCube
      // cannot tell an unloaded cube from an empty one (measured 2026-09-30),
      // so "no cells" alone never ends it.
      if (!o.loaded && measured !== true) { return false; }
      this._cubeLoadOverride.delete(key);
    }
    return measured;
  }

  /**
   * After our own Load/Unload: the performance monitor catches up only after
   * about 20 s (measured), and a refresh in between would flip the menu back.
   */
  markCubeLoaded(node: Tm1TreeNode, loaded: boolean): void {
    const { serverId, cubeName } = node.meta;
    if (!serverId || !cubeName) { return; }
    this._cubeLoadOverride.set(`${serverId}|${String(cubeName).toLowerCase()}`, { loaded, until: Date.now() + 90_000 });
    node.meta.loaded = loaded;
    node.contextValue = node.contextValue?.replace(/\.(un)?loaded$/, '') + (loaded ? '.loaded' : '.unloaded');
    this._endIconOnly(serverId);
    this._onDidChangeTreeData.fire(node);
  }

  /** Stores fetched load states and redraws the cube nodes whose menu suffix changes. */
  private _applyCubeLoadStates(serverId: string, states: Map<string, boolean>, nodes: Tm1TreeNode[]): void {
    this._cubeLoad.set(serverId, states);
    for (const node of nodes) {
      if (node.nodeType !== 'cube') { continue; }
      const loaded = this.cubeLoaded(serverId, String(node.meta.cubeName));
      if (loaded === node.meta.loaded) { continue; }
      node.meta.loaded = loaded;
      node.contextValue = node.contextValue?.replace(/\.(un)?loaded$/, '') + (loaded === undefined ? '' : loaded ? '.loaded' : '.unloaded');
      this._onDidChangeTreeData.fire(node);
    }
  }

  // ── Session dot in the server icon ─────────────────────────────────────────
  //
  // The icon can only change through a node refresh, and VS Code answers a
  // refresh by asking again for the children of every EXPANDED node below.
  // Those calls go to the server — and a request on an expired session logs in
  // again: the dot would turn itself green, a covert keep-alive (the reason the
  // dot used to be a file decoration). So an icon refresh serves the children
  // VS Code asks for from what the tree showed last, for a few seconds.
  private _idleServers = new Set<string>();
  private _serverNodes = new Map<string, Tm1TreeNode>();
  /** serverId → (node id → children last shown). Emptied on every real refresh. */
  private _lastChildren = new Map<string, Map<string, Tm1TreeNode[]>>();
  /** serverId → until when (ms) getChildren answers from `_lastChildren`. */
  private _iconOnlyUntil = new Map<string, number>();

  /** Mark a connected server's session as expired (`idle`) or alive; redraws only its icon. */
  setSessionIdle(serverId: string, idle: boolean): void {
    if (this._idleServers.has(serverId) === idle) { return; }
    if (idle) { this._idleServers.add(serverId); } else { this._idleServers.delete(serverId); }
    const node = this._serverNodes.get(serverId);
    if (!node) { return; }
    // ponytail: time window, not a token per call — VS Code's follow-up
    // getChildren calls carry nothing that ties them to this refresh.
    this._iconOnlyUntil.set(serverId, Date.now() + 3000);
    this._onDidChangeTreeData.fire(node);
  }

  /**
   * A real refresh (create, delete, reload, filter) must reach the server: end
   * the icon-only window and drop the remembered children, for one server or
   * for all. Dropping them here is also what keeps `_lastChildren` bounded —
   * afterwards it only refills with the nodes VS Code asks for again.
   */
  private _endIconOnly(serverId?: string): void {
    if (serverId === undefined) {
      this._iconOnlyUntil.clear();
      this._lastChildren.clear();
    } else {
      this._iconOnlyUntil.delete(serverId);
      this._lastChildren.delete(serverId);
    }
  }

  async getChildren(element?: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const sid = element?.meta?.serverId as string | undefined;
    if (element && sid && (this._iconOnlyUntil.get(sid) ?? 0) > Date.now()) {
      const perServer = this._lastChildren.get(sid);
      const last = perServer?.get(element.id ?? '');
      // Consumed once: the icon refresh asks each expanded node once; a
      // second ask for the same node is somebody else's and goes to the server.
      if (perServer && last) { perServer.delete(element.id ?? ''); return last; }
    }
    const result = await this._getChildrenTracked(element);
    if (element?.id && sid) {
      let perServer = this._lastChildren.get(sid);
      if (!perServer) { perServer = new Map(); this._lastChildren.set(sid, perServer); }
      perServer.set(element.id, result);
    }
    return result;
  }

  private async _getChildrenTracked(element?: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const out = await this._getChildrenDeduped(element);
    for (const n of out) {
      if (n.nodeType === 'serverRoot' && typeof n.meta.serverId === 'string') { this._serverNodes.set(n.meta.serverId, n); }
    }
    return out;
  }

  private async _getChildrenDeduped(element?: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const children = await this._getChildrenRaw(element);
    // `dedupeTreeNodeIds` is the last guard, not the fix: two nodes with the
    // same id cost VS Code the WHOLE branch, not just the second node. A
    // server is free to hand us two identically named objects in one list
    // at any time (measured: a native view and an MDX view named `Standard`
    // on the same cube). Details are at the top of the module.
    return dedupeTreeNodeIds(children.map(n => this._applyExpansion(n)));
  }

  private async _getChildrenRaw(element?: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    if (!element) { return this._childrenForRoot(); }
    switch (element.nodeType) {
      case 'snippetsRoot':          return this._childrenForSnippetsRoot();
      case 'processTemplatesRoot':  return this._childrenForProcessTemplatesRoot();
      case 'serverRoot':      return this._childrenForServerRoot(element);
      case 'serverFolder':    return this._childrenForServerFolder(element);
      case 'adminServerRoot': return this._childrenForAdminServer(element);
      case 'filesRoot':       return this._childrenForFilesRoot(element);
      case 'applicationsRoot':   return this._childrenForApplicationsRoot(element);
      case 'applicationFolder':  return this._childrenForApplicationsFolder(element);
      case 'sandboxesRoot':   return this._childrenForSandboxesRoot(element);
      case 'category':        return this._getCategoryChildren(element);
      case 'cube':            return this._childrenForCube(element);
      case 'cubeSubCategory': return this._getCubeSubCategoryChildren(element);
      case 'dimension':       return this._childrenForDimension(element);
      case 'dimSubCategory':  return this._getDimSubCategoryChildren(element);
      case 'cubeDimension':   return this._childrenForCubeDimension(element);
      case 'processGroup':    return this._childrenForProcessGroup(element);
      case 'controlGroup':    return this._childrenForControlGroup(element);
      case 'workbenchesRoot': return this._childrenForWorkbenchesRoot(element);
      case 'toolsRoot':       return this._childrenForToolsRoot(element);
      case 'findReplaceRoot': return this._childrenForFindReplaceRoot(element);
      // Leaves (built with TreeItemCollapsibleState.None) and the unused
      // 'root'. Listed explicitly: a new expandable node type that is not
      // wired up here would otherwise expand to nothing, silently.
      case 'root':
      case 'hierarchy':
      case 'attribute':
      case 'subset':
      case 'process':
      case 'chore':
      case 'thread':
      case 'cubeRule':
      case 'cubeView':
      case 'messageLog':
      case 'transactionLog':
      case 'mdxRunner':
      case 'toolAction':
      case 'workbench':
      case 'error':
      case 'snippet':
      case 'addSnippet':
      case 'processTemplate':
      case 'addProcessTemplate':
      case 'serverFile':
      case 'sandbox':
      case 'applicationDoc':
      case 'applicationLink':
      case 'applicationRef':
        return [];
      default: {
        const unhandled: never = element.nodeType;
        void unhandled;
        return [];
      }
    }
  }

  /** Children of the sandboxesRoot node: one node per sandbox visible to current user. */
  private async _childrenForSandboxesRoot(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { serverId } = element.meta;
    const cfg = this._getConfig(serverId);
    if (!cfg) { return []; }
    try {
      const list = await listSandboxes(cfg);
      const active = this._sandboxTracker?.getActive(serverId);
      const sorted = [...list].sort((a, b) => a.Name.localeCompare(b.Name));
      return sorted.map(sb => {
        const isActive = sb.Name === active;
        const node = new Tm1TreeNode(
          'sandbox',
          sb.Name,
          vscode.TreeItemCollapsibleState.None,
          { sandboxName: sb.Name, serverId, active: isActive },
          this._extensionUri,
        );
        if (isActive) { node.description = vscode.l10n.t('(active)'); }
        return node;
      });
    } catch (err) {
      return [new Tm1TreeNode(
        'error',
        vscode.l10n.t('Failed to load Sandboxes: {0}', vscode.l10n.t(_pureFormatTreeError(err))),
        vscode.TreeItemCollapsibleState.None,
        { serverId, parentNode: element, message: errMsg(err) },
        this._extensionUri,
      )];
    }
  }

  /**
   * Build a serverRoot node for one server (used at root and inside folders).
   *
   * `extraMeta` is mixed in BEFORE construction, not set afterward:
   * `Tm1TreeNode` computes `this.tooltip` in the constructor from `meta`, so
   * a later `node.meta.x = ...` never reaches the tooltip (review
   * 2026-08-27, finding 2).
   */
  private _makeServerNode(s: ServerProfile, extraMeta?: Record<string, unknown>): Tm1TreeNode {
    const connected = this._isConnected(s.id);
    return new Tm1TreeNode(
      'serverRoot',
      s.name,
      connected
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      {
        serverId: s.id, serverName: s.name, serverUrl: s.serverUrl, connected, isV12: s.version === 'v12',
        // Carries the `-adm` suffix of the contextValue (Tm1TreeNode
        // constructor) and thereby decides whether "Remove from group…"
        // appears in the context menu. Must be in place BEFORE construction.
        fromAdmin: Boolean(s.parentAdminId),
        ...extraMeta,
      },
      this._extensionUri,
    );
  }

  /** Children of a serverFolder node: its servers, alpha-sorted. */
  private _childrenForServerFolder(element: Tm1TreeNode): Tm1TreeNode[] {
    const name = element.meta.folderName;
    return [...this._getServers()]
      .filter(s => s.folder === name)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(s => this._makeServerNode(s));
  }

  /**
   * Root level: server folders + ungrouped servers + snippets/templates roots.
   * With no servers configured the tree stays EMPTY so the
   * `contributes.viewsWelcome` onboarding content (package.json) renders —
   * viewsWelcome only shows for a completely empty tree.
   */
  private _childrenForRoot(): Tm1TreeNode[] {
    // Profiles hanging under an admin server do NOT belong at the root
    // level — otherwise the same instance would appear twice in the tree
    // after the first expansion, both nodes with the same id
    // `serverRoot:<id>` ("Element with id ... is already registered",
    // review 2026-08-27, finding 1). A profile that has been taken out has
    // had its `parentAdminId` deleted and as a result keeps appearing at
    // the root or in its folder. If `parentAdminId` points into the void,
    // the profile still belongs here regardless: the admin-server node is
    // its only other display path, and without this the profile, along
    // with its credentials, would be invisible — no error, no message. The
    // regular deletion path clears out `parentAdminId`, so this state
    // cannot actually be produced; the line costs nothing and catches any
    // future gap (review 2026-08-28, finding 2).
    const adminIds = new Set(listAdminServers().map(a => a.id));
    const rootServers = this._getServers()
      .filter(s => !s.parentAdminId || !adminIds.has(s.parentAdminId));
    const { folders, ungrouped } = groupServersByFolder(rootServers, listServerFolders());

    const adminNodes: Tm1TreeNode[] = listAdminServers()
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(a => new Tm1TreeNode(
        'adminServerRoot',
        a.name,
        vscode.TreeItemCollapsibleState.Collapsed,
        { adminId: a.id, adminName: a.name, adminKind: a.kind, serverUrl: a.serverUrl, instanceCount: lastInstanceCount(a.id) },
        this._extensionUri,
      ));

    if (folders.length === 0 && ungrouped.length === 0 && adminNodes.length === 0) {
      return [];
    }

    const serverNodes: Tm1TreeNode[] = folders.map(folder => new Tm1TreeNode(
      'serverFolder',
      folder.name,
      vscode.TreeItemCollapsibleState.Collapsed,
      {
        folderName: folder.name,
        serverCount: folder.servers.length,
        connectedCount: folder.servers.filter(s => this._isConnected(s.id)).length,
      },
      this._extensionUri,
    ));
    for (const s of ungrouped) {
      serverNodes.push(this._makeServerNode(s));
    }

    const snippetsRoot = new Tm1TreeNode(
      'snippetsRoot',
      vscode.l10n.t('Snippets (local)'),
      vscode.TreeItemCollapsibleState.Collapsed,
      {},
      this._extensionUri,
    );

    const processTemplatesRoot = new Tm1TreeNode(
      'processTemplatesRoot',
      vscode.l10n.t('Process templates (local)'),
      vscode.TreeItemCollapsibleState.Collapsed,
      {},
      this._extensionUri,
    );

    return [...adminNodes, ...serverNodes, snippetsRoot, processTemplatesRoot];
  }

  /**
   * Children of an admin-server node: its reported instances, materialised as
   * regular server profiles.
   *
   * Discovery runs HERE (on expand) rather than on a timer: every connection
   * costs a worker thread on TM1 (see docs/architecture/thread-stability.md).
   * The actual fetch + reconcile + persist happens in
   * `providers/adminDiscovery.ts#discoverAndSync` — this
   * provider has no `ExtensionContext` to write profiles with (see
   * task-5-addendum.md).
   */
  private async _childrenForAdminServer(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const adminId = element.meta.adminId as string;
    let res: DiscoveryResult;
    try {
      res = await discoverAndSync(adminId);
    } catch (err) {
      // Touch nothing: a one-off outage must not rewrite profiles.
      const admin = getAdminServer(adminId);
      return [new Tm1TreeNode(
        'error',
        // `describeInstanceListError` instead of `errMsg`: the most common setup
        // mistake — `https://` against a plaintext port — used to show up
        // in the tree as a raw BoringSSL line ("WRONG_VERSION_NUMBER") and
        // reads like a TLS version problem, even though no TLS is involved
        // at all.
        admin?.kind === 'paw'
          ? describeInstanceListError('paw', err, admin.serverUrl)
          : vscode.l10n.t('Admin server not reachable: {0}',
            describeInstanceListError('tm1', err, admin?.serverUrl ?? '')),
        vscode.TreeItemCollapsibleState.None,
        { adminId },
        this._extensionUri,
      )];
    }
    return res.visible.map((s) => this._makeServerNode(s, {
      diverged: res.diverged.has(s.id),
      stale: res.stale.has(s.id),
    }));
  }

  /** Snippets list + "add snippet" leaf. */
  private _childrenForSnippetsRoot(): Tm1TreeNode[] {
    const snippets = this._getSnippets();
    const nodes: Tm1TreeNode[] = snippets.map(s => {
      const bodyPreview = s.body.split('\n').slice(0, 3).join('\n');
      const node = new Tm1TreeNode(
        'snippet',
        s.name,
        vscode.TreeItemCollapsibleState.None,
        { snippetId: s.id, trigger: s.trigger, description: s.description, bodyPreview },
        this._extensionUri,
      );
      node.description = `[${s.trigger}]`;
      node.command = { command: 'tm1.snippet.edit', title: 'Edit snippet', arguments: [node] };
      return node;
    });
    const addNode = new Tm1TreeNode('addSnippet', vscode.l10n.t('Add snippet'), vscode.TreeItemCollapsibleState.None, {}, this._extensionUri);
    addNode.command = { command: 'tm1.snippet.new', title: 'New snippet', arguments: [] };
    nodes.push(addNode);
    return nodes;
  }

  /** Process-Templates list + "add template" leaf. */
  private _childrenForProcessTemplatesRoot(): Tm1TreeNode[] {
    const tpls = this._getProcessTemplates();
    const nodes: Tm1TreeNode[] = tpls.map(t => {
      const node = new Tm1TreeNode(
        'processTemplate',
        t.name,
        vscode.TreeItemCollapsibleState.None,
        { templateId: t.id, description: t.description },
        this._extensionUri,
      );
      node.description = t.description || undefined;
      node.command = { command: 'tm1.processTemplate.edit', title: 'Edit template', arguments: [node] };
      return node;
    });
    const addNode = new Tm1TreeNode(
      'addProcessTemplate',
      vscode.l10n.t('Create template manually'),
      vscode.TreeItemCollapsibleState.None,
      {},
      this._extensionUri,
    );
    addNode.command = { command: 'tm1.processTemplate.new', title: 'New template', arguments: [] };
    nodes.push(addNode);
    return nodes;
  }

  /** Server root → category nodes + Message Log + MDX Runner + Files root. */
  private async _childrenForServerRoot(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { serverId } = element.meta;
    if (!this._isConnected(serverId)) { return []; }
    const cfg = this._getConfig(serverId);
    const sandboxesEnabled = cfg ? await isSandboxEnabled(cfg).catch(() => true) : true;
    const categories = ['Cubes', 'Dimensions', 'Processes', 'Chores', 'Threads'];
    const catNodes = categories.map(key => {
      const node = new Tm1TreeNode(
        'category',
        key,
        vscode.TreeItemCollapsibleState.Collapsed,
        { categoryKey: key, serverId },
        this._extensionUri,
      );
      if (isControlToggleGroup(key)) {
        node.contextValue = key === 'Processes' && isBedrockInstalled(serverId) === true
          ? 'category-processes-bedrock'
          : `category-${key.toLowerCase()}`;
        // `.grouped` drives the Configure-vs-Reset menu verb per node — like the
        // `cube-v12` suffix, a global context key cannot do it, since servers
        // with and without a grouping override coexist in one tree.
        if (key === 'Processes' && this._isProcessGroupingConfigured(serverId)) {
          node.contextValue = `${node.contextValue}.grouped`;
        }
        // `.ctlShown` drives the Show-vs-Hide verb PER NODE. A global context
        // key cannot: the state is per server AND per object group, so cubes
        // shown on server A must not flip the verb on server A's dimensions —
        // let alone on server B (flameY3T1, 2026-08-18).
        if (!this.isHidingSystemObjects(serverId, key)) {
          node.contextValue = `${node.contextValue}.ctlShown`;
        }
      }
      // Retain the instance VS Code most recently received so refreshCategory
      // can fire the exact node the tree cached (overwrite every call).
      this._categoryNodeCache.set(`${serverId}::${key}`, node);
      return node;
    });
    const messageLogNode = new Tm1TreeNode('messageLog', 'Message Log', vscode.TreeItemCollapsibleState.None, { serverId }, this._extensionUri);
    // Tools that open a window rather than list objects. The ones without a
    // node of their own were reachable only from the server's context menu,
    // which stays as it is.
    const toolsNode = new Tm1TreeNode('toolsRoot', vscode.l10n.t('Tools'), vscode.TreeItemCollapsibleState.Collapsed, { serverId }, this._extensionUri);
    const applicationsRootNode = new Tm1TreeNode('applicationsRoot', 'Applications', vscode.TreeItemCollapsibleState.Collapsed, { serverId, appPath: [] }, this._extensionUri);
    const activeSandbox = this._sandboxTracker?.getActive(serverId);
    const sandboxesLabel = activeSandbox ? vscode.l10n.t('Sandboxes — active: {0}', activeSandbox) : 'Sandboxes';
    const sandboxesRootNode = sandboxesEnabled
      ? new Tm1TreeNode('sandboxesRoot', sandboxesLabel, vscode.TreeItemCollapsibleState.Collapsed, { serverId }, this._extensionUri)
      : null;
    // Order: Applications, Cubes, Dimensions, Processes, Chores, Sandboxes, Threads, Message Log, Tools, Workbenches
    const choresIdx = catNodes.findIndex(n => n.label === 'Chores');
    const beforeThreads = choresIdx >= 0 ? catNodes.slice(0, choresIdx + 1) : catNodes.slice(0, 4);
    const afterChores   = choresIdx >= 0 ? catNodes.slice(choresIdx + 1)    : catNodes.slice(4);
    const optional = sandboxesRootNode ? [sandboxesRootNode] : [];
    const workbenchesNode = new Tm1TreeNode('workbenchesRoot', vscode.l10n.t('Workbenches'), vscode.TreeItemCollapsibleState.Collapsed, { serverId }, this._extensionUri);
    return [applicationsRootNode, ...beforeThreads, ...optional, ...afterChores, messageLogNode, toolsNode, workbenchesNode];
  }

  /** This server's workbenches, most recently saved on top. */
  /** `toolIcon`: an SVG under media/icons by name, or a codicon as `$(name)`. */
  private _toolNode(serverId: string, label: string, toolCommand: string, toolIcon: string): Tm1TreeNode {
    return new Tm1TreeNode('toolAction', label, vscode.TreeItemCollapsibleState.None,
      { serverId, toolCommand, toolIcon }, this._extensionUri);
  }

  private _childrenForToolsRoot(element: Tm1TreeNode): Tm1TreeNode[] {
    const { serverId } = element.meta;
    const none = vscode.TreeItemCollapsibleState.None;
    return [
      // The transaction log answers the message log's question from the other
      // side: one says what the server did, the other which number changed.
      // It appears on EVERY connected server: `TransactionLogEntries` is
      // measured on 11.8 only (2026-09-22), none on v12 — a server without the
      // endpoint answers with an error, and the window shows that, instead of
      // the node being missing based on a guess.
      new Tm1TreeNode('transactionLog', vscode.l10n.t('Transaction Log'), none, { serverId }, this._extensionUri),
      new Tm1TreeNode('mdxRunner', vscode.l10n.t('MDX Runner'), none, { serverId }, this._extensionUri),
      this._toolNode(serverId, vscode.l10n.t('New TM1 Notebook'), 'tm1.notebook.new', 'tm1notebook'),
      this._toolNode(serverId, vscode.l10n.t('TI Console'), 'tm1.tiConsole.open', 'ti-console'),
      this._toolNode(serverId, vscode.l10n.t('Lineage'), 'tm1.showLineage', 'lineage'),
      // Reads a TM1 11 source; on a v12 server there is nothing left to check.
      ...(this._getConfig(serverId)?.version === 'v12' ? [] : [
        this._toolNode(serverId, vscode.l10n.t('v12 Readiness Check'), 'tm1.v12ReadinessCheck', 'v12-readiness'),
      ]),
      new Tm1TreeNode('findReplaceRoot', vscode.l10n.t('Find & Replace'), vscode.TreeItemCollapsibleState.Collapsed, { serverId }, this._extensionUri),
      this._toolNode(serverId, vscode.l10n.t('Bulk Deploy'), 'tm1.bulkDeploy.open', 'bulk-deploy'),
      this._toolNode(serverId, vscode.l10n.t('Bulk Delete'), 'tm1.bulkDelete.open', 'bulk-delete'),
    ];
  }

  /** The three entries of the server context menu's Find & Replace submenu. */
  private _childrenForFindReplaceRoot(element: Tm1TreeNode): Tm1TreeNode[] {
    const { serverId } = element.meta;
    return [
      this._toolNode(serverId, vscode.l10n.t('Find/Replace across Processes & Rules'), 'tm1.findReplaceObjects', 'find-replace'),
      this._toolNode(serverId, vscode.l10n.t('Normalize Naming & Casing'), 'tm1.openConsistencyNormalizer', 'normalize-naming'),
      this._toolNode(serverId, vscode.l10n.t('Unify Variable Names'), 'tm1.openValueNaming', 'unify-variables'),
    ];
  }

  private async _childrenForWorkbenchesRoot(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { serverId } = element.meta;
    const store = this._workbenchStore;
    if (!store) { return []; }
    // NOT expandable: the windows of a workbench used to sit here as child
    // nodes until 2026-08-24. They were pure information — no command, no
    // context menu — and the same information appears in the edit window,
    // where it also has an effect. In the tree it only cost space and a
    // level. `windowCount` stays in the metadata: the restore command reads
    // it for its message.
    return store.list(serverId).map(wb => new Tm1TreeNode(
      'workbench', wb.name, vscode.TreeItemCollapsibleState.None,
      { serverId, workbenchId: wb.id, windowCount: wb.windows.length }, this._extensionUri,
    ));
  }


  /**
   * The server's file space (v11 `Blobs`, v12 `Files` with folders — see
   * `filesApi`). What TM1 keeps there for its own purposes is hidden: on
   * v11 via `isUserFile`, on v12 the dot folders of the root (`.blobs`,
   * `.applications`, `.tmp` …).
   */
  private async _childrenForFilesRoot(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { serverId } = element.meta;
    const folderPath: string[] = element.meta.folderPath ?? [];
    const cfg = this._getConfig(serverId);
    if (!cfg) { return []; }
    try {
      const isV12 = cfg.version === 'v12';
      const [files, cubes] = await Promise.all([
        listFiles(cfg, folderPath),
        isV12 ? Promise.resolve([]) : fetchNames('Cubes', cfg),
      ]);
      const cubeNamesLower = new Set(cubes.map(c => c.toLowerCase()));
      const visible = files.filter(f => isV12 ? !f.Name.startsWith('.') : isUserFile(f.Name, cubeNamesLower));
      // Folders before files, as in the explorer.
      const byName = (a: { Name: string }, b: { Name: string }) => a.Name.localeCompare(b.Name);
      return [
        ...visible.filter(f => f.isFolder).sort(byName).map(f => new Tm1TreeNode(
          'filesRoot',
          f.Name,
          vscode.TreeItemCollapsibleState.Collapsed,
          { serverId, folderPath: [...folderPath, f.Name], parentNode: element },
          this._extensionUri,
        )),
        ...visible.filter(f => !f.isFolder).sort(byName).map(f => new Tm1TreeNode(
          'serverFile',
          f.Name,
          vscode.TreeItemCollapsibleState.None,
          { fileName: f.Name, folderPath, size: f.Size, lastUpdated: f.LastUpdated, serverId, parentNode: element },
          this._extensionUri,
        )),
      ];
    } catch (err) {
      return [new Tm1TreeNode('error', vscode.l10n.t('Files could not be loaded: {0}', errMsg(err)), vscode.TreeItemCollapsibleState.None, { serverId, parentNode: element }, this._extensionUri)];
    }
  }

  /** Applications root → public folder tree + "Data Files" (Blobs) child. */
  private async _childrenForApplicationsRoot(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { serverId } = element.meta;
    // The text stood there raw, even though both bundles have carried it
    // all along ("Datendateien") — German users saw English here (spotted
    // 2026-08-25).
    const dataFiles = new Tm1TreeNode('filesRoot', vscode.l10n.t('Data Files'), vscode.TreeItemCollapsibleState.Collapsed, { serverId }, this._extensionUri);
    const cfg = this._getConfig(serverId);
    if (!cfg) { return [dataFiles]; }
    try {
      const entries = await listApplications([], cfg);
      return [...this._appEntriesToNodes(entries, [], serverId), dataFiles];
    } catch (err) {
      return [
        new Tm1TreeNode('error', vscode.l10n.t('Applications could not be loaded: {0}', errMsg(err)), vscode.TreeItemCollapsibleState.None, { serverId, parentNode: element }, this._extensionUri),
        dataFiles,
      ];
    }
  }

  /** Applications folder → its child entries. */
  private async _childrenForApplicationsFolder(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { serverId, appPath } = element.meta;
    const cfg = this._getConfig(serverId);
    if (!cfg) { return []; }
    try {
      const entries = await listApplications(appPath as string[], cfg);
      return this._appEntriesToNodes(entries, appPath as string[], serverId);
    } catch (err) {
      return [new Tm1TreeNode('error', vscode.l10n.t('Applications could not be loaded: {0}', errMsg(err)), vscode.TreeItemCollapsibleState.None, { serverId, parentNode: element }, this._extensionUri)];
    }
  }

  /** Map AppEntry[] to tree nodes (folders sorted first, then by name). */
  private _appEntriesToNodes(entries: AppEntry[], parentPath: string[], serverId: string): Tm1TreeNode[] {
    const rank = (t: string) => (t === 'folder' ? 0 : 1);
    const sorted = [...entries].sort((a, b) => rank(a.type) - rank(b.type) || a.name.localeCompare(b.name));
    return sorted.map((e) => {
      if (e.type === 'folder') {
        return new Tm1TreeNode('applicationFolder', e.name, vscode.TreeItemCollapsibleState.Collapsed,
          { serverId, appPath: [...parentPath, e.name], name: e.name, isPrivate: e.isPrivate }, this._extensionUri);
      }
      if (e.type === 'document') {
        return new Tm1TreeNode('applicationDoc', e.name, vscode.TreeItemCollapsibleState.None,
          { serverId, appPath: parentPath, appId: e.id, name: e.name, isPrivate: e.isPrivate }, this._extensionUri);
      }
      if (e.type === 'link') {
        return new Tm1TreeNode('applicationLink', e.name, vscode.TreeItemCollapsibleState.None,
          { serverId, appPath: parentPath, appId: e.id, url: e.url, name: e.name, isPrivate: e.isPrivate }, this._extensionUri);
      }
      return new Tm1TreeNode('applicationRef', e.name, vscode.TreeItemCollapsibleState.None,
        { serverId, appPath: parentPath, appId: e.id, refType: e.type, target: e.target ?? {}, name: e.name, isPrivate: e.isPrivate }, this._extensionUri);
    });
  }

  /** Cube → Rules (only when the cube actually has rules) + Dimensions + Views sub-category nodes. */
  private async _childrenForCube(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { cubeName, serverId } = element.meta;
    const nodes: Tm1TreeNode[] = [];
    if (await this._cubeHasRules(cubeName as string, serverId as string)) {
      nodes.push(new Tm1TreeNode('cubeRule', 'Rules', vscode.TreeItemCollapsibleState.None, { cubeName, serverId }, this._extensionUri));
    }
    nodes.push(
      new Tm1TreeNode('cubeSubCategory', 'Dimensions',    vscode.TreeItemCollapsibleState.Collapsed,  { cubeName, subKey: 'Dimensions',   serverId }, this._extensionUri),
      new Tm1TreeNode('cubeSubCategory', 'Views',         vscode.TreeItemCollapsibleState.Collapsed,  { cubeName, subKey: 'Views',        serverId }, this._extensionUri),
      new Tm1TreeNode('cubeSubCategory', 'Private Views', vscode.TreeItemCollapsibleState.Collapsed,  { cubeName, subKey: 'PrivateViews', serverId }, this._extensionUri),
    );
    return nodes;
  }

  /**
   * Tolerant "does this cube have rules?" check for the tree. Defaults to TRUE
   * (keep the Rules node reachable) on missing cfg, transient/ambiguous REST
   * errors, or a malformed answer. Only an authoritative empty filter result
   * hides the node. Lazy per-cube on expand, and `cubeHasRules` asks with
   * `$filter=Rules ne null` — no rules text crosses the wire just for a boolean.
   */
  private async _cubeHasRules(cubeName: string, serverId: string): Promise<boolean> {
    const cfg = this._getConfig(serverId);
    if (!cfg) { return true; }
    const key = `${serverId}::${cubeName}`;
    const cached = this._cubeHasRulesCache.get(key);
    if (cached !== undefined) { return cached; }
    try {
      const has = await cubeHasRules(cfg, cubeName);
      this._cubeHasRulesCache.set(key, has);
      return has;
    } catch {
      // Tolerant fallback — do NOT cache, so a transient error doesn't stick.
      return true;
    }
  }

  /** Evict the memoised has-rules result for a cube (call after a rule save). */
  invalidateCubeRulesCache(serverId: string, cubeName: string): void {
    this._cubeHasRulesCache.delete(`${serverId}::${cubeName}`);
  }

  /** Dimension → Hierarchies + Attributes + Subsets sub-category nodes. */
  private _childrenForDimension(element: Tm1TreeNode): Tm1TreeNode[] {
    const { dimName, serverId } = element.meta;
    return [
      new Tm1TreeNode('dimSubCategory', 'Hierarchies', vscode.TreeItemCollapsibleState.Collapsed, { dimName, subKey: 'Hierarchies', serverId }, this._extensionUri),
      new Tm1TreeNode('dimSubCategory', 'Attributes',  vscode.TreeItemCollapsibleState.Collapsed, { dimName, subKey: 'Attributes',  serverId }, this._extensionUri),
      new Tm1TreeNode('dimSubCategory', 'Subsets',     vscode.TreeItemCollapsibleState.Collapsed, { dimName, subKey: 'Subsets',     serverId }, this._extensionUri),
    ];
  }

  /** Cube dimension → its hierarchies (names fetched with the cube's dimension list). */
  private _childrenForCubeDimension(element: Tm1TreeNode): Tm1TreeNode[] {
    const { cubeName, dimName, hierarchies, serverId } = element.meta;
    return ((hierarchies as string[] | undefined) ?? []).map(name =>
      new Tm1TreeNode('hierarchy', name, vscode.TreeItemCollapsibleState.None, { cubeName, dimName, hierName: name, serverId }, this._extensionUri),
    );
  }

  /** ProcessGroup → flat list of process leaves. */
  private _childrenForProcessGroup(element: Tm1TreeNode): Tm1TreeNode[] {
    const { children, serverId } = element.meta;
    return (children as string[]).map(name => this._makeProcessLeaf(name, serverId));
  }

  /**
   * A control-object cluster → the same leaves that, without a cluster,
   * would sit directly under the category. The cluster is a drawer, not a
   * different object type.
   */
  private _childrenForControlGroup(element: Tm1TreeNode): Tm1TreeNode[] {
    const { children, categoryKey, serverId, picklistOwners } = element.meta;
    const names = (children as string[]) ?? [];
    const owners = new Set((picklistOwners as string[] | undefined) ?? []);
    switch (categoryKey as string) {
      case 'Cubes':
        return names.map(name => new Tm1TreeNode('cube', name, vscode.TreeItemCollapsibleState.Collapsed, {
          cubeName: name,
          serverId,
          hasPicklistCube: owners.has(name.toLowerCase()),
          loaded: this.cubeLoaded(serverId, name),
        }, this._extensionUri));
      case 'Dimensions':
        return names.map(name => new Tm1TreeNode('dimension', name, vscode.TreeItemCollapsibleState.Collapsed, { dimName: name, serverId }, this._extensionUri));
      case 'Processes':
        return names.map(name => this._makeProcessLeaf(name, serverId));
      default:
        return [];
    }
  }

  /**
   * Node for a control-object cluster.
   *
   * `withPicklist` is only passed in by the cubes branch: the information
   * about which cube owns a picklist cube falls out while listing the
   * cubes, and would no longer be available when the cluster is expanded
   * without asking again. Filtered down to the members of this cluster —
   * usually empty.
   */
  private _makeControlGroupNode(
    cluster: ControlCluster,
    categoryKey: string,
    serverId: string,
    withPicklist?: Set<string>,
  ): Tm1TreeNode {
    const label = cluster.key ?? vscode.l10n.t('Other');
    const node = new Tm1TreeNode('controlGroup', label, vscode.TreeItemCollapsibleState.Collapsed, {
      groupName: label,
      clusterId: controlClusterId(cluster),
      categoryKey,
      children: cluster.names,
      picklistOwners: withPicklist
        ? cluster.names.map(n => n.toLowerCase()).filter(n => withPicklist.has(n))
        : undefined,
      serverId,
    }, this._extensionUri);
    node.description = String(cluster.names.length);
    return node;
  }

  private async _getCategoryChildren(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const key = element.meta.categoryKey as string;
    const { serverId } = element.meta;
    const cfg = this._getConfig(serverId);
    if (!cfg) { return []; }
    try {
      switch (key) {
        case 'Cubes': {
          const items = await listCubes(cfg);
          const loaded = (name: string) => this.cubeLoaded(serverId, name);
          // Derive from the SAME list (before the visibility filter that
          // hides `}`-cubes) which base cube already has a picklist cube.
          // Costs no additional query.
          const withPicklist = indexPicklistCubes(items.map(item => item.Name));
          const visible = items.map(item => item.Name).filter(name => this._filterByName(name, serverId, 'Cubes'));
          const { plain, clusters } = splitControlObjects(visible);
          // Clusters FIRST: they are collapsed, so they need one line each,
          // and sit as a block above the long list instead of sliding to
          // its end, where you would have to hunt for them (flameY3T1,
          // 2026-08-21).
          const nodes = [
            ...clusters.map(c => this._makeControlGroupNode(c, 'Cubes', serverId, withPicklist)),
            ...plain.map(name => new Tm1TreeNode('cube', name, vscode.TreeItemCollapsibleState.Collapsed, {
              cubeName: name,
              serverId,
              hasPicklistCube: withPicklist.has(name.toLowerCase()),
              loaded: loaded(name),
            }, this._extensionUri)),
          ];
          // The load state takes four requests (ExecuteMDX, $count, GET,
          // DELETE); the list is drawn first and the menu suffix follows.
          void fetchCubeLoadStates(cfg).then(states => this._applyCubeLoadStates(serverId, states, nodes));
          return nodes;
        }
        case 'Dimensions': {
          const names = await listDimensionNames(cfg);
          const visible = names.filter(name => this._filterByName(name, serverId, 'Dimensions'));
          const { plain, clusters } = splitControlObjects(visible);
          return [
            ...clusters.map(c => this._makeControlGroupNode(c, 'Dimensions', serverId)),
            ...plain.map(name => new Tm1TreeNode('dimension', name, vscode.TreeItemCollapsibleState.Collapsed, { dimName: name, serverId }, this._extensionUri)),
          ];
        }
        case 'Processes': {
          const items = await listProcesses(cfg);
          const allNames = items.map(item => item.Name as string);
          const bedrockDetected = allNames.some(n => /^}?bedrock\./i.test(n));
          if (isBedrockInstalled(serverId) !== bedrockDetected) {
            setBedrockInstalled(serverId, bedrockDetected);
            setTimeout(() => this.refresh(), 0);
          }
          const names = allNames.filter(name => this._filterByName(name, serverId, 'Processes'));
          // Control processes do NOT go through process grouping: that
          // works with a marker the user sets for their own processes,
          // and `}`-names have nothing to do with that.
          const { plain, clusters } = splitControlObjects(names);
          const { token, mode } = this._getProcessGroupConfig(serverId);
          const groups = groupProcesses(plain, token, mode);
          const controlNodes = clusters.map(c => this._makeControlGroupNode(c, 'Processes', serverId));
          if (groups.length === 1 && groups[0].marker === null) {
            return [...controlNodes, ...groups[0].children.map(name => this._makeProcessLeaf(name, serverId))];
          }
          return [...controlNodes, ...groups.map(g => this._makeProcessGroupNode(g, serverId))];
        }
        case 'Chores': {
          const items = await listChores(cfg, 'Name,Active');
          return items
            .filter(item => this._filterByName(item.Name, serverId, 'Chores'))
            .map(item => new Tm1TreeNode('chore', item.Name, vscode.TreeItemCollapsibleState.None, { choreName: item.Name, active: !!item.Active, serverId }, this._extensionUri));
        }
        case 'Threads': {
          const items = await listThreads(cfg);
          const activeItems = items.filter(item => item.State && item.State !== 'Idle').slice(0, 5);
          element.description = `${items.length} Threads`;
          return activeItems.map(item =>
            new Tm1TreeNode('thread', `Thread ${item.ID ?? ''}`, vscode.TreeItemCollapsibleState.None, {
              threadId: item.ID, state: item.State ?? '', user: item.Name ?? '', serverId,
            }, this._extensionUri),
          );
        }
        default: return [];
      }
    } catch (err) {
      return [this._errorNode(err, element)];
    }
  }

  private async _getCubeSubCategoryChildren(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { cubeName, subKey, serverId } = element.meta;
    const cfg = this._getConfig(serverId);
    if (!cfg) {
      // No config = server not connected / profile gone. Keeping the empty list
      // (an error node here would flash on every disconnect) but no longer
      // silent: an empty "Views" node with a live-looking server is exactly the
      // symptom that made the F3 bug unreportable.
      console.warn(`[tm1] no connection config for server "${serverId}" — cube "${cubeName}" sub-category "${subKey}" not loaded`);
      return [];
    }
    try {
      switch (subKey) {
        case 'Dimensions': {
          // Expandable only when there is more than the same-name hierarchy
          // (Leaves counts); the hierarchies ride along so expanding needs no request.
          const dims = await getCubeDimensionHierarchies(cfg, cubeName);
          return dims.map(d =>
            new Tm1TreeNode('cubeDimension', d.name,
              d.hierarchies.length > 1 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
              { cubeName, dimName: d.name, hierarchies: d.hierarchies, serverId }, this._extensionUri),
          );
        }
        case 'Views': {
          // NO blanket catch: public views are the primary collection. A failing
          // call (401/403/400/timeout/network) has to reach the enclosing catch
          // and become an error node — swallowing it to [] renders identically
          // to "this cube has no views", which is how a broken connection went
          // unnoticed on a live server. Same asymmetry as
          // commands/cubeViewer/fetch.ts#_fetchAllViews.
          const pubViews = await getCubeViews(cfg, cubeName, false);
          return [...pubViews]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(v =>
              new Tm1TreeNode('cubeView', mdxViewLabel(v.name, v.isMdx), vscode.TreeItemCollapsibleState.None, { cubeName, viewName: v.name, isPrivate: false, isMdx: v.isMdx, serverId }, this._extensionUri),
            );
        }
        case 'PrivateViews': {
          // Tolerated by design (unlike public Views above): plenty of
          // users/servers have no private views or forbid the collection
          // outright, so a failure here is not newsworthy enough for an error
          // node. It is logged instead of dropped — no new OutputChannel, this
          // file has none.
          const privViews = await getCubeViews(cfg, cubeName, true).catch((err) => {
            console.warn(`[tm1] private views for cube "${cubeName}" could not be loaded:`, err);
            return [] as const;
          });
          return [...privViews]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(v =>
              new Tm1TreeNode('cubeView', mdxViewLabel(v.name, v.isMdx), vscode.TreeItemCollapsibleState.None, { cubeName, viewName: v.name, isPrivate: true, isMdx: v.isMdx, serverId }, this._extensionUri),
            );
        }
        default: return [];
      }
    } catch (err) {
      return [this._errorNode(err, element)];
    }
  }

  private async _getDimSubCategoryChildren(element: Tm1TreeNode): Promise<Tm1TreeNode[]> {
    const { dimName, subKey, serverId } = element.meta;
    const cfg = this._getConfig(serverId);
    if (!cfg) { return []; }
    try {
      switch (subKey) {
        case 'Hierarchies': {
          const names = await listHierarchyNames(cfg, dimName);
          return names.map(name =>
            new Tm1TreeNode('hierarchy', name, vscode.TreeItemCollapsibleState.None, { dimName, hierName: name, serverId }, this._extensionUri),
          );
        }
        case 'Attributes': {
          const attrs = await listElementAttributes(cfg, dimName, dimName);
          return attrs.map(item =>
            new Tm1TreeNode('attribute', item.Name, vscode.TreeItemCollapsibleState.None, { dimName, attrName: item.Name, attrType: item.Type ?? '', serverId }, this._extensionUri),
          );
        }
        case 'Subsets': {
          // `isDynamic` (subset driven by an MDX Expression) rides along so the
          // node can say so — a dynamic subset is otherwise indistinguishable
          // from a static one in the tree.
          const { pub: pubInfos, priv: privInfos } = await listSubsetInfos(cfg, dimName, dimName);
          const pub = pubInfos.map(s =>
            new Tm1TreeNode('subset', s.name, vscode.TreeItemCollapsibleState.None, { dimName, subsetName: s.name, isPrivate: false, isDynamic: s.isDynamic, serverId }, this._extensionUri),
          );
          const priv = privInfos.map(s =>
            new Tm1TreeNode('subset', s.name, vscode.TreeItemCollapsibleState.None, { dimName, subsetName: s.name, isPrivate: true, isDynamic: s.isDynamic, serverId }, this._extensionUri),
          );
          return [...pub, ...priv];
        }
        default: return [];
      }
    } catch (err) {
      return [this._errorNode(err, element)];
    }
  }

  private _makeProcessLeaf(name: string, serverId: string): Tm1TreeNode {
    const node = new Tm1TreeNode('process', name, vscode.TreeItemCollapsibleState.None, { processName: name, serverId }, this._extensionUri);
    node.command = { command: 'tm1.openProcessEditor', title: vscode.l10n.t('Open Process'), arguments: [node] };
    return node;
  }

  private _makeProcessGroupNode(group: ProcessGroup, serverId: string): Tm1TreeNode {
    const label = group.marker ?? vscode.l10n.t('(Ungrouped)');
    const node = new Tm1TreeNode('processGroup', label, vscode.TreeItemCollapsibleState.Collapsed, {
      groupName: label,
      children: group.children,
      serverId,
    }, this._extensionUri);
    node.description = String(group.children.length);
    // Same `.grouped` verb marker as on the Processes category node.
    if (this._isProcessGroupingConfigured(serverId)) {
      node.contextValue = `${node.contextValue}.grouped`;
    }
    return node;
  }

  /** Does this server carry a per-server grouping override (→ Reset instead of Configure)? */
  private _isProcessGroupingConfigured(serverId?: string): boolean {
    if (!serverId) { return false; }
    return Object.prototype.hasOwnProperty.call(getProcessGroupOverrides().suffix, serverId);
  }

  /**
   * Grouping config for one server: the per-server override if it has one, else
   * no grouping. No settings read, no default token — grouping is per-server
   * data only.
   */
  private _getProcessGroupConfig(serverId?: string): { token: string; mode: ProcessGroupingMode } {
    const overrides = getProcessGroupOverrides();
    return _pureResolveProcessGroupConfig(
      serverId,
      overrides.suffix,
      overrides.mode,
      DEFAULT_PROCESS_GROUP_MODE,
    );
  }

  private _errorNode(err: any, parentNode: Tm1TreeNode): Tm1TreeNode {
    const msg = vscode.l10n.t(_pureFormatTreeError(err));
    return new Tm1TreeNode('error', msg, vscode.TreeItemCollapsibleState.None, { message: msg, parentNode }, this._extensionUri);
  }

  private _filterByName(name: string, serverId: string, group: TreeObjectGroup): boolean {
    return _pureFilterByName(name, this.isHidingSystemObjects(serverId, group), this._filterText);
  }

  refresh(): void {
    this._endIconOnly();
    this._onDidChangeTreeData.fire(undefined);
  }

  refreshNode(node: Tm1TreeNode): void {
    this._endIconOnly(node.meta?.serverId as string | undefined);
    this._onDidChangeTreeData.fire(node);
  }

  /**
   * Refresh only the given category subtree on the given server (P1). Fires the
   * retained category-node instance so VS Code re-fetches just that subtree. If
   * the category was never expanded/built, falls back to a global refresh —
   * harmless, as the subtree isn't visible.
   */
  refreshCategory(serverId: string | undefined, categoryKey: string): void {
    const cached = serverId ? this._categoryNodeCache.get(`${serverId}::${categoryKey}`) : undefined;
    if (cached) {
      this._endIconOnly(serverId);
      this._onDidChangeTreeData.fire(cached);
    } else {
      this.refresh();
    }
  }

  /** Drop retained category-node instances for a server (disconnect/removal). */
  clearCategoryCacheForServer(serverId: string): void {
    this._endIconOnly(serverId);
    const prefix = `${serverId}::`;
    for (const key of this._categoryNodeCache.keys()) {
      if (key.startsWith(prefix)) { this._categoryNodeCache.delete(key); }
    }
    for (const key of this._cubeHasRulesCache.keys()) {
      if (key.startsWith(prefix)) { this._cubeHasRulesCache.delete(key); }
    }
  }

  setFilter(text: string): void {
    this._filterText = text;
    this.refresh();
  }

  get filterText(): string {
    return this._filterText;
  }

  /**
   * Two gates in front of the automatic refresh tick.
   *
   * Without them it kept running while the object explorer sat collapsed
   * in another sidebar, and on every tick it discarded the whole tree
   * along with the server queries — at 250 ms that's four times a second
   * (Codex finding B15). Second gate: without a connected server there is
   * nothing to reload, the server list itself reports its changes through
   * its own events.
   */
  startAutoRefresh(ms: number): void {
    this.stopAutoRefresh();
    // V3: 0 disables; any positive value clamps to ≥250ms so a hand-edited
    // settings.json can't drive a tight refresh loop.
    if (ms > 0) {
      this._autoRefreshTimer = setInterval(() => {
        if (this._isViewVisible && !this._isViewVisible()) { return; }
        if (!this._getServers().some(s => this._isConnected(s.id))) { return; }
        this.refresh();
      }, Math.max(ms, 250));
    }
  }

  stopAutoRefresh(): void {
    if (this._autoRefreshTimer) {
      clearInterval(this._autoRefreshTimer);
      this._autoRefreshTimer = undefined;
    }
  }
}
