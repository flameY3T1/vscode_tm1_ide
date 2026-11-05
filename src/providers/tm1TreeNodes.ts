import * as vscode from 'vscode';
import { DYNAMIC_SUBSET_MARK } from '../utils/dynamicSubsetMark';

/** Scheme of a server node's state address — for decoration only, never opened. */
export const SERVER_STATE_SCHEME = 'tm1-server-state';

/**
 * Discriminated union of all node types in the TM1 Object Explorer tree.
 */
export type Tm1NodeType =
  | 'root'
  | 'serverRoot'
  | 'serverFolder'
  | 'adminServerRoot'
  | 'category'
  | 'cube'
  | 'cubeSubCategory'
  | 'cubeDimension'
  | 'dimension'
  | 'dimSubCategory'
  | 'hierarchy'
  | 'attribute'
  | 'subset'
  | 'process'
  | 'processGroup'
  | 'controlGroup'
  | 'chore'
  | 'thread'
  | 'cubeRule'
  | 'cubeView'
  | 'messageLog'
  | 'transactionLog'
  | 'mdxRunner'
  | 'toolsRoot'
  | 'findReplaceRoot'
  | 'toolAction'
  | 'workbenchesRoot'
  | 'workbench'
  | 'error'
  | 'snippetsRoot'
  | 'snippet'
  | 'addSnippet'
  | 'processTemplatesRoot'
  | 'processTemplate'
  | 'addProcessTemplate'
  | 'filesRoot'
  | 'serverFile'
  | 'sandboxesRoot'
  | 'sandbox'
  | 'applicationsRoot'
  | 'applicationFolder'
  | 'applicationDoc'
  | 'applicationLink'
  | 'applicationRef';

export function iconPath(
  extensionUri: vscode.Uri,
  name: string,
): { light: vscode.Uri; dark: vscode.Uri } {
  return {
    light: vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'light', `${name}.svg`),
    dark:  vscode.Uri.joinPath(extensionUri, 'media', 'icons', 'dark',  `${name}.svg`),
  };
}

export function getIconForNodeType(
  type: Tm1NodeType,
  meta: Record<string, any>,
  extensionUri: vscode.Uri,
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
  switch (type) {
    case 'serverRoot':
      // Connected: the dot in the corner says whether the session still lives
      // (`sessionIdle` is set by the tree provider, see `setSessionIdle`).
      return iconPath(extensionUri, !meta.connected ? 'server-disconnected' : meta.sessionIdle ? 'server-idle' : 'server-live');
    case 'serverFolder':
      return iconPath(extensionUri, 'folder-action');
    case 'adminServerRoot':
      return iconPath(extensionUri, 'admin-server');
    case 'root':
      return new vscode.ThemeIcon('server-environment');
    case 'category':
      switch (meta.categoryKey) {
        case 'Cubes':       return iconPath(extensionUri, 'cube');
        case 'Dimensions':  return iconPath(extensionUri, 'dimension');
        case 'Processes':   return iconPath(extensionUri, 'processes');
        case 'Chores':      return iconPath(extensionUri, 'chore-inactive');
        case 'Threads':     return iconPath(extensionUri, 'thread');
        default:            return iconPath(extensionUri, 'folder-action');
      }
    case 'cube':
      return iconPath(extensionUri, 'cube');
    case 'cubeSubCategory':
      switch (meta.subKey) {
        case 'Dimensions':   return iconPath(extensionUri, 'dimension');
        case 'Views':        return iconPath(extensionUri, 'cube-view');
        case 'PrivateViews': return iconPath(extensionUri, 'cube-view');
        default:             return iconPath(extensionUri, 'folder-action');
      }
    case 'cubeDimension':
      return iconPath(extensionUri, 'dimension');
    case 'dimension':
      return iconPath(extensionUri, 'dimension');
    case 'dimSubCategory':
      switch (meta.subKey) {
        case 'Hierarchies': return iconPath(extensionUri, 'hierarchy');
        case 'Attributes':  return iconPath(extensionUri, 'attribute');
        case 'Subsets':     return iconPath(extensionUri, 'subset');
        default:            return iconPath(extensionUri, 'folder-action');
      }
    case 'hierarchy':
      return iconPath(extensionUri, 'hierarchy');
    case 'attribute':
      return iconPath(extensionUri, 'attribute');
    case 'subset':
      return iconPath(extensionUri, meta.isPrivate ? 'subset-private' : 'subset');
    case 'process':
      return iconPath(extensionUri, 'process');
    case 'processGroup':
      // Folder of processes → plural icon, like the Processes category itself.
      return iconPath(extensionUri, 'processes');
    case 'controlGroup':
      // Cluster of control objects → the icon of the category it sits in, so
      // the eye reads "a bundle of these" and not "a new kind of thing".
      switch (meta.categoryKey) {
        case 'Cubes':      return iconPath(extensionUri, 'cube');
        case 'Dimensions': return iconPath(extensionUri, 'dimension');
        case 'Processes':  return iconPath(extensionUri, 'processes');
        default:           return iconPath(extensionUri, 'folder-action');
      }
    case 'chore':
      return iconPath(extensionUri, meta.active ? 'chore-active' : 'chore-inactive');
    case 'thread':
      return iconPath(extensionUri, 'thread');
    case 'messageLog':
      return iconPath(extensionUri, 'message-log');
    case 'transactionLog':
      return iconPath(extensionUri, 'transaction-log');
    case 'mdxRunner':
      return iconPath(extensionUri, 'mdx-runner');
    case 'cubeRule':
      return iconPath(extensionUri, 'cube-rule');
    case 'cubeView':
      return iconPath(extensionUri, meta.isPrivate ? 'cube-view-private' : 'cube-view');
    case 'toolsRoot':
      return iconPath(extensionUri, 'tools');
    case 'findReplaceRoot':
      return iconPath(extensionUri, 'find-replace');
    case 'toolAction': {
      // An own SVG by name, or a codicon written as in package.json: `$(name)`.
      const codicon = /^\$\((.+)\)$/.exec(meta.toolIcon ?? '');
      return codicon ? new vscode.ThemeIcon(codicon[1]) : iconPath(extensionUri, meta.toolIcon);
    }
    case 'workbenchesRoot':
      return new vscode.ThemeIcon('layout');
    case 'workbench':
      return new vscode.ThemeIcon('save-all');
    case 'error':
      return new vscode.ThemeIcon('error');
    case 'snippetsRoot':
      return iconPath(extensionUri, 'snippets');
    case 'snippet':
      return iconPath(extensionUri, 'snippets');
    case 'addSnippet':
      return new vscode.ThemeIcon('add');
    case 'processTemplatesRoot': return iconPath(extensionUri, 'process-templates');
    case 'processTemplate':      return iconPath(extensionUri, 'process-template');
    case 'addProcessTemplate':   return new vscode.ThemeIcon('add');
    case 'filesRoot':
      return meta.folderPath?.length ? new vscode.ThemeIcon('folder') : iconPath(extensionUri, 'data-files');
    case 'serverFile':
      return iconPath(extensionUri, 'data-file');
    case 'sandboxesRoot':
      return iconPath(extensionUri, 'sandboxes');
    case 'sandbox':
      return iconPath(extensionUri, 'sandbox');
    case 'applicationsRoot':
      return iconPath(extensionUri, 'data-files');
    case 'applicationFolder':
      return iconPath(extensionUri, 'folder-action');
    case 'applicationDoc':
      return iconPath(extensionUri, 'data-file');
    case 'applicationLink':
      return new vscode.ThemeIcon('link-external');
    case 'applicationRef':
      switch (meta.refType) {
        case 'cubeRef': return iconPath(extensionUri, 'cube');
        case 'viewRef': return iconPath(extensionUri, 'cube-view');
        case 'dimensionRef': return iconPath(extensionUri, 'dimension');
        case 'subsetRef': return iconPath(extensionUri, 'subset');
        case 'processRef': return iconPath(extensionUri, 'process');
        case 'choreRef': return iconPath(extensionUri, 'chore-inactive');
        default: return new vscode.ThemeIcon('link');
      }
    default: {
      // Compile-time completeness: a new Tm1NodeType must get its icon here.
      // The runtime fallback stays for values that bypass the type.
      const unhandled: never = type;
      void unhandled;
      return new vscode.ThemeIcon('circle-outline');
    }
  }
}

/**
 * Returns a description string for a node based on its type and meta data.
 * - Chore nodes show "Aktiv" or "Inaktiv"
 * - Thread nodes show state and user info
 * - Other node types return undefined (no description)
 */
export function getDescriptionForNode(type: Tm1NodeType, meta: Record<string, any>): string | undefined {
  switch (type) {
    case 'serverRoot':
      return meta.connected ? vscode.l10n.t('Connected') : undefined;
    case 'serverFolder':
      if (typeof meta.serverCount !== 'number') { return undefined; }
      // Show how many of the folder's servers are currently connected.
      return typeof meta.connectedCount === 'number'
        ? vscode.l10n.t('{0}/{1} connected', meta.connectedCount, meta.serverCount)
        : String(meta.serverCount);
    case 'adminServerRoot':
      return typeof meta.instanceCount === 'number'
        ? vscode.l10n.t('{0} instance(s)', meta.instanceCount)
        : undefined;
    case 'subset':
      // A DYNAMIC subset resolves its members from an MDX expression. It gets a
      // description marker rather than its own icon: private × dynamic would need
      // four new SVGs (each with a dark variant), and the icon slot already
      // carries the public/private distinction.
      // The marker is the shared `ƒx` SYMBOL — the very glyph the Dimension
      // Browser's subset dropdown appends (`subsetOptionLabel`), so one subset
      // reads the same in both places. Being a symbol it is NOT translated and
      // stays out of the l10n bundles; only the `private` word beside it is.
      if (meta.isDynamic) {
        return meta.isPrivate
          ? `${vscode.l10n.t('private')} ${DYNAMIC_SUBSET_MARK}`
          : DYNAMIC_SUBSET_MARK;
      }
      return meta.isPrivate ? vscode.l10n.t('private') : undefined;
    case 'cubeView':
      return meta.isPrivate ? vscode.l10n.t('private') : undefined;
    case 'chore':
      return meta.active ? vscode.l10n.t('Active') : vscode.l10n.t('Inactive');
    case 'thread':
      if (meta.state && meta.user) {
        return `${meta.state} — ${meta.user}`;
      }
      if (meta.state) {
        return meta.state;
      }
      return undefined;
    case 'serverFile':
      return typeof meta.size === 'number' ? formatBytes(meta.size) : undefined;
    case 'applicationDoc':
    case 'applicationLink':
    case 'applicationRef':
    case 'applicationFolder':
      return meta.isPrivate ? vscode.l10n.t('private') : undefined;
    default:
      return undefined;
  }
}

function formatBytes(n: number): string {
  if (n < 1024) { return `${n} B`; }
  if (n < 1024 * 1024) { return `${(n / 1024).toFixed(1)} KB`; }
  if (n < 1024 * 1024 * 1024) { return `${(n / (1024 * 1024)).toFixed(1)} MB`; }
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Returns a tooltip string for a node based on its type, label, and meta data.
 */
function getTooltipForNode(type: Tm1NodeType, label: string, meta: Record<string, any>): string {
  switch (type) {
    case 'serverRoot': {
      const base = `${label}${meta.serverUrl ? `\n${meta.serverUrl}` : ''}\n${meta.connected ? vscode.l10n.t('Connected') : vscode.l10n.t('Disconnected — right-click → Connect')}`;
      if (meta.diverged) { return `${base}\n${vscode.l10n.t('URL differs from what the admin server reports')}`; }
      if (meta.stale) { return `${base}\n${vscode.l10n.t('No longer reported by the admin server')}`; }
      return base;
    }
    case 'adminServerRoot':
      // The kind belongs in the tooltip, not after the name: in the
      // description it stood next to the instance count and was mere
      // repetition there (click test 2026-09-16).
      return `${label}\n${meta.serverUrl ?? ''}\n${meta.adminKind === 'paw'
        ? vscode.l10n.t('Planning Analytics Workspace — shows the TM1 databases it routes')
        : vscode.l10n.t('TM1 Admin Server — shows the instances registered with it')}`;
    case 'root':
      return `Server: ${meta.serverName ?? label}`;
    case 'cube':
      return `Cube: ${meta.cubeName ?? label}`;
    case 'dimension':
      return `Dimension: ${meta.dimName ?? label}`;
    case 'process':
      return `Process: ${meta.processName ?? label}`;
    case 'processGroup':
      return vscode.l10n.t('Process group: {0}', meta.groupName ?? label);
    case 'controlGroup':
      return vscode.l10n.t('Control objects: {0}', meta.groupName ?? label);
    case 'serverFolder':
      return vscode.l10n.t('Folder: {0}', meta.folderName ?? label);
    case 'chore':
      return vscode.l10n.t('Chore: {0} ({1})', meta.choreName ?? label, meta.active ? vscode.l10n.t('Active') : vscode.l10n.t('Inactive'));
    case 'thread':
      return `Thread ${meta.threadId ?? ''}: ${meta.state ?? ''} — ${meta.user ?? ''}`;
    case 'error':
      return meta.message ?? label;
    case 'snippet':
      return [
        `Trigger: ${meta.trigger ?? ''}`,
        meta.description ? `\n${meta.description}` : '',
        meta.bodyPreview ? `\n\n${meta.bodyPreview}` : '',
      ].join('');
    default:
      return label;
  }
}

// Injected at activation so the node constructor can append a `.git` contextValue
// suffix for process/cubeRule nodes whose server has git enabled. Default: off.
let _gitEnabledResolver: (serverId: string) => boolean = () => false;
export function setGitEnabledResolver(fn: (serverId: string) => boolean): void {
  _gitEnabledResolver = fn;
}

/**
 * Tells whether a server runs TM1 v12. Injected (like the git resolver) so this
 * module needs no serverManager import. Drives the `-v12` contextValue suffix
 * that hides v11-only actions per node — a global context key could not, since
 * v11 and v12 servers coexist in one tree.
 */
let _v12Resolver: (serverId: string) => boolean = () => false;
export function setV12Resolver(fn: (serverId: string) => boolean): void {
  _v12Resolver = fn;
}

/**
 * Is an impersonation session currently running on this server? Injected the
 * same way as `_v12Resolver`, and for the same reason per NODE rather than via
 * a global context key: impersonating on server A must not make "Start
 * impersonation" disappear on server B.
 */
let _impersonationResolver: (serverId: string) => boolean = () => false;
export function setImpersonationResolver(fn: (serverId: string) => boolean): void {
  _impersonationResolver = fn;
}

/**
 * TM1 control objects (`}Clients`, `}Groups`, `}ElementAttributes_Product`, …)
 * are server internals. Once "Show system objects" is on, they hang in the
 * tree as perfectly normal `cube`/`dimension`/`hierarchy` nodes — until now,
 * nothing distinguished them from user objects, so the delete commands were
 * also available on them.
 *
 * The `-control` suffix on the contextValue makes the difference visible to
 * the menus (the same pattern as `cube-v12`): the delete commands match only
 * the suffix-less form, and every other entry matches `…(-control)?` and thus
 * remains available on control objects.
 *
 * The node's `id` is unaffected by this — it comes from `_buildId()`.
 */
function isControlNode(type: Tm1NodeType, label: string, meta: Record<string, any>): boolean {
  const isControlName = (n: unknown): boolean => typeof n === 'string' && n.startsWith('}');
  switch (type) {
    case 'cube':      return isControlName(meta.cubeName ?? label);
    case 'dimension': return isControlName(meta.dimName ?? label);
    // A hierarchy is control if it is itself named that way (`}Leaves`) or if
    // its dimension is a control dimension.
    case 'hierarchy': return isControlName(meta.hierName ?? label) || isControlName(meta.dimName);
    default:          return false;
  }
}

/**
 * A tree node in the TM1 Object Explorer.
 * Extends vscode.TreeItem with nodeType, meta data, and contextValue for menu contributions.
 */
export class Tm1TreeNode extends vscode.TreeItem {
  constructor(
    public readonly nodeType: Tm1NodeType,
    label: string,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly meta: Record<string, any> = {},
    extensionUri?: vscode.Uri,
  ) {
    super(label, collapsibleState);
    this.id = Tm1TreeNode._buildId(nodeType, meta, label);
    this.contextValue = nodeType === 'serverRoot'
      // `-v12` only on a CONNECTED node: the v12 marker exists to drop v11-only
      // actions from a live server's menu. A disconnected node carries no suffix
      // — every menu there anchors on the bare form.
      ? (meta.connected ? (meta.isV12 ? 'serverRoot-connected-v12' : 'serverRoot-connected') : 'serverRoot-disconnected')
      : nodeType === 'category' && meta.categoryKey
        ? `category-${meta.categoryKey.toLowerCase()}`
        : nodeType === 'sandbox' && meta.active
          ? 'sandbox-active'
          : nodeType;
    // `-adm`: this server originates from an admin server (`parentAdminId` on
    // the profile, the provider mixes the flag into `meta` BEFORE construction).
    // The suffix deliberately sits BEFORE the `.git` suffix further below, so
    // the forms are `serverRoot-connected-adm` and `serverRoot-connected-adm.git`.
    // All serverRoot menu conditions in package.json tolerate an optional
    // `-adm`; guard: src/test/serverRootMenuWhenClauses.test.ts.
    // `-imp`: on this server, the model is seen through another user's eyes.
    // The suffix sits BEFORE `-adm`, so the forms are
    // `serverRoot-connected-imp[-adm][.git]`. It affects exactly two menu
    // items: "Start impersonation" drops out, "End impersonation" is added.
    if (nodeType === 'serverRoot' && meta.connected === true
        && typeof meta.serverId === 'string' && _impersonationResolver(meta.serverId)) {
      this.contextValue = `${this.contextValue}-imp`;
    }
    if (nodeType === 'serverRoot' && meta.fromAdmin === true) {
      this.contextValue = `${this.contextValue}-adm`;
    }
    // `-paw`: a gateway entry cannot do everything a TM1 admin server can. TM1
    // Top talks to the TM1 port directly via the native C-API — that does
    // not work through a gateway, and the menu item used to also show up
    // under PAW (reported 2026-09-16). The remaining admin server menus
    // tolerate the suffix; guard: src/test/adminServerInlineMenu.test.ts.
    if (nodeType === 'adminServerRoot' && meta.adminKind === 'paw') {
      this.contextValue = `${this.contextValue}-paw`;
    }
    // `cube-v12` lets menus drop the v11-only cube actions (SaveData — the TI
    // function does not exist in v12). Every other cube menu matches the
    // `/^cube(-v12)?(-control)?$/` shape.
    if (nodeType === 'cube' && typeof meta.serverId === 'string' && _v12Resolver(meta.serverId)) {
      this.contextValue = 'cube-v12';
    }
    // Control objects: `dimension-control`, `hierarchy-control`, `cube-control`
    // or `cube-v12-control`. Must run after the v12 branch so both axes
    // combine; the delete commands match only the suffix-less form.
    if (isControlNode(nodeType, label, meta)) {
      this.contextValue = `${this.contextValue}-control`;
    }
    // `-haspick`: this base cube already has a `}PickList_<Cube>`. Controls
    // which of the two pick-list entries appears in the context menu (create
    // OR delete, never both). The information comes from the cube list the
    // provider fetches anyway — no query per node. Control cubes never get
    // the suffix: a `}PickList_X` itself has none.
    if (nodeType === 'cube' && meta.hasPicklistCube === true && !this.contextValue.endsWith('-control')) {
      this.contextValue = `${this.contextValue}-haspick`;
    }
    // `.loaded` / `.unloaded`: Load and Unload are either-or, the menu shows
    // the one that applies. No suffix = state unknown (performance monitor
    // off, v12) — then both stay, as before. See `fetchCubeLoadStates`.
    if (nodeType === 'cube' && typeof meta.loaded === 'boolean') {
      this.contextValue = `${this.contextValue}${meta.loaded ? '.loaded' : '.unloaded'}`;
    }
    const gitSuffixable =
      nodeType === 'process' || nodeType === 'cubeRule' ||
      (nodeType === 'serverRoot' && meta.connected === true);
    if (gitSuffixable
        && typeof meta.serverId === 'string'
        && _gitEnabledResolver(meta.serverId)) {
      this.contextValue = `${this.contextValue}.git`;
    }
    this.iconPath = extensionUri
      ? getIconForNodeType(nodeType, meta, extensionUri)
      : new vscode.ThemeIcon('circle-outline');
    this.description = getDescriptionForNode(nodeType, meta);
    this.tooltip = getTooltipForNode(nodeType, label, meta);
    // Carrier for the colored status dot (serverManager/sessionStatus.ts).
    // The symbol stays `iconPath`; the address only serves decoration.
    if (nodeType === 'serverRoot' && typeof meta.serverId === 'string') {
      this.resourceUri = vscode.Uri.parse(`${SERVER_STATE_SCHEME}:/${encodeURIComponent(meta.serverId)}`);
    }
    if (nodeType === 'cubeRule' && meta.cubeName) {
      this.command = { command: 'tm1.openCubeRules', title: 'Edit rules', arguments: [this] };
    }
    if (nodeType === 'subset' && meta.subsetName) {
      this.command = { command: 'tm1.openSubset', title: 'Open subset', arguments: [this] };
    }
    if ((nodeType === 'dimension' || nodeType === 'cubeDimension') && meta.dimName) {
      this.command = { command: 'tm1.browseElements', title: 'Browse elements', arguments: [this] };
    }
    if (nodeType === 'cubeView' && meta.viewName) {
      this.command = { command: 'tm1.openCubeViewer', title: 'Open view', arguments: [this] };
    }
    if (nodeType === 'chore' && meta.choreName) {
      this.command = { command: 'tm1.editChore', title: 'Edit chore', arguments: [this] };
    }
    if (nodeType === 'messageLog') {
      this.command = { command: 'tm1.showMessageLog', title: 'Show message log', arguments: [this] };
    }
    if (nodeType === 'transactionLog') {
      this.command = { command: 'tm1.showTransactionLog', title: 'Show transaction log', arguments: [this] };
    }
    if (nodeType === 'mdxRunner') {
      this.command = { command: 'tm1.mdx.open', title: 'Open MDX Runner', arguments: [this] };
    }
    if (nodeType === 'toolAction' && meta.toolCommand) {
      this.command = { command: meta.toolCommand, title: label, arguments: [this] };
    }
    if (nodeType === 'workbench' && meta.workbenchId) {
      this.command = { command: 'tm1.workbench.restore', title: 'Restore workbench', arguments: [this] };
    }
    if (nodeType === 'category' && meta.categoryKey === 'Threads') {
      this.command = { command: 'tm1.showThreads', title: 'Show threads', arguments: [this] };
    }
    if (nodeType === 'applicationDoc') {
      this.command = { command: 'tm1.app.openDocument', title: 'Open document', arguments: [this] };
    }
    if (nodeType === 'applicationLink' && meta.url) {
      this.command = { command: 'tm1.app.openLink', title: 'Open link', arguments: [this] };
    }
    if (nodeType === 'applicationRef') {
      const map: Record<string, string> = {
        cubeRef: 'tm1.openCubeViewer', viewRef: 'tm1.openCubeViewer',
        processRef: 'tm1.openProcessEditor', choreRef: 'tm1.editChore',
        subsetRef: 'tm1.openSubset', dimensionRef: 'tm1.editDimension',
      };
      const cmd = map[meta.refType as string];
      if (cmd) { this.command = { command: cmd, title: 'Open', arguments: [this] }; }
    }
  }

  private static _buildId(type: Tm1NodeType, meta: Record<string, any>, label: string): string {
    const s = meta.serverId ? `${meta.serverId}:` : '';
    switch (type) {
      case 'serverRoot':     return `serverRoot:${meta.serverId ?? label}`;
      case 'serverFolder':   return `serverFolder:${meta.folderName ?? label}`;
      case 'adminServerRoot': return `adminServerRoot:${meta.adminId ?? label}`;
      case 'root':           return `root:${meta.serverName ?? ''}`;
      case 'category':       return `${s}cat:${meta.categoryKey}`;
      case 'cube':           return `${s}cube:${meta.cubeName}`;
      case 'cubeSubCategory': return `${s}cubeSub:${meta.cubeName}:${meta.subKey}`;
      case 'cubeDimension':  return `${s}cubeDim:${meta.cubeName}:${meta.dimName}`;
      case 'dimension':      return `${s}dim:${meta.dimName}`;
      case 'dimSubCategory': return `${s}dimSub:${meta.dimName}:${meta.subKey}`;
      // Under a cube the same hierarchy shows once per cube: the cube keeps ids unique.
      case 'hierarchy':      return meta.cubeName
        ? `${s}cubeHier:${meta.cubeName}:${meta.dimName}:${meta.hierName}`
        : `${s}hier:${meta.dimName}:${meta.hierName}`;
      case 'attribute':      return `${s}attr:${meta.dimName}:${meta.attrName}`;
      case 'subset':         return `${s}subset:${meta.isPrivate ? 'priv:' : ''}${meta.dimName}:${meta.subsetName}`;
      case 'process':        return `${s}proc:${meta.processName}`;
      case 'processGroup':   return `${s}procGroup:${meta.groupName}`;
      // The cluster key, NOT the label: the label of the catch-all bucket is
      // translated and would discard the remembered expand state on a
      // language switch.
      case 'controlGroup':   return `${s}ctlGroup:${meta.categoryKey}:${meta.clusterId}`;
      case 'chore':          return `${s}chore:${meta.choreName}`;
      case 'thread':         return `${s}thread:${meta.threadId ?? label}`;
      case 'messageLog':     return `${s}messagelog`;
      case 'transactionLog': return `${s}transactionlog`;
      case 'mdxRunner':      return `${s}mdxrunner`;
      case 'cubeRule':       return `${s}rule:${meta.cubeName}`;
      // The MDX marker belongs in the id: a cube can carry a native AND an
      // MDX view of the same name (seen live on `Cube B`/`Standard`,
      // 2026-09-01). Without the marker there would be two nodes with one id,
      // and VS Code then leaves the whole "Views" branch empty. Views are
      // leaves, so the format costs no remembered expand state.
      case 'cubeView':       return `${s}view:${meta.isPrivate ? 'priv:' : ''}${meta.isMdx ? 'mdx:' : ''}${meta.cubeName}:${meta.viewName}`;
      case 'toolsRoot':       return `${s}tools`;
      case 'findReplaceRoot': return `${s}tools:findreplace`;
      case 'toolAction':      return `${s}tool:${meta.toolCommand}`;
      case 'workbenchesRoot': return `${s}workbenches`;
      case 'workbench':       return `${s}wb:${meta.workbenchId}`;
      case 'error':          return `${s}error:${meta.parentNode?.id ?? ''}:${meta.message ?? label}`;
      case 'snippetsRoot':   return 'snippets-root';
      case 'snippet':        return `snippet:${meta.snippetId ?? label}`;
      case 'addSnippet':     return 'snippet-add';
      case 'sandboxesRoot':  return `${s}sandboxes-root`;
      case 'sandbox':        return `${s}sandbox:${meta.sandboxName ?? label}`;
      case 'filesRoot':      return `${s}files:${(meta.folderPath ?? []).join('/')}`;
      case 'serverFile':     return `${s}file:${(meta.folderPath ?? []).join('/')}:${meta.fileName ?? label}`;
      case 'applicationsRoot':  return `${s}apps-root`;
      case 'applicationFolder': return `${s}app:${(meta.appPath ?? []).join('/')}`;
      case 'applicationDoc':    return `${s}appdoc:${(meta.appPath ?? []).join('/')}:${meta.appId ?? label}`;
      case 'applicationLink':   return `${s}applink:${(meta.appPath ?? []).join('/')}:${meta.appId ?? label}`;
      case 'applicationRef':    return `${s}appref:${(meta.appPath ?? []).join('/')}:${meta.appId ?? label}`;
      // Keyed by template id, not by name: two templates with the same name
      // would otherwise share one id and VS Code empties the branch. Root and
      // add leaf get fixed ids because their labels are translated.
      case 'processTemplatesRoot': return `${s}process-templates-root`;
      case 'processTemplate':      return `${s}process-template:${meta.templateId ?? label}`;
      case 'addProcessTemplate':   return `${s}process-template-add`;
      default: {
        const unhandled: never = type;
        return `${s}${String(unhandled)}:${label}`;
      }
    }
  }
}
