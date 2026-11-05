import { setPanelIcon } from '../webviews/panelIcons';
import { muteWebviewOnDispose } from '../webviews/webviewPanelHost';
import * as vscode from 'vscode';
import { Tm1TopBridge, Tm1TopBridgeError } from '../tm1top/bridge';
import { resolveNativeRuntime, Tm1TopUnavailable } from '../tm1top/discovery';
import { parseState } from '../tm1top/tm1TopPure';
import { getServerProfile } from '../serverState/profiles';
import { loadCredentials } from './serverManager/connection';
import { getAdminServer } from '../serverState/adminServers';
import { getServerConfig, onProfileRemoved, type ServerProfile } from '../serverState/state';
import { apiRequest } from '../tm1Rest/client';
import { parseBodySafe } from '../tm1Rest/parseRest';
import type { Tm1TreeNode } from '../providers/tm1TreeNodes';
import { registerWindow, unregisterWindow } from '../workbench/windowRegistry';
import { renderWebviewShell } from '../webviews/webviewShell';
import { COLUMN_RESIZE_CSS, columnResizeScript } from '../webviews/columnResize';
import { savedColumnWidths, rememberColumnWidths } from '../webviews/columnWidthStore';
import { errMsg } from '../utils/errMsg';
import { registerServerDisposer } from '../serverState/serverDisposeRegistry';
import { postTo } from '../webviews/typedPost';
import type { HostToWebview as Tm1TopToWebview, Tm1TopBootstrap, WebviewToHost } from '../webviewClient/tm1Top/protocol';


const panels = new Map<string, vscode.WebviewPanel>();

export function nativeErrorMessage(error: unknown): string {
  if (!(error instanceof Tm1TopUnavailable) && !(error instanceof Tm1TopBridgeError)) { return errMsg(error); }
  const t = vscode.l10n.t;
  const messages: Record<string, string> = {
    'unsupported-platform': t('TM1 Top requires Windows x64.'),
    'dll-missing': t('TM1 native API not found. Set tm1.nativeApiPath to the IBM TM1 bin64 directory, then refresh.'),
    'keystore-missing': t('TM1 SSL keystore or stash is missing. Restore ssl/ibmtm1.kdb and ssl/ibmtm1.sth in the configured bin64 directory, then refresh.'),
    'dotnet-missing': t('TM1 Top requires the Windows .NET Framework 4.x x64 runtime.'),
    'compiler-missing': t('The .NET Framework x64 compiler is missing. Install .NET Framework 4.x or reinstall the extension with its prebuilt helper.'),
    'source-missing': t('TM1 Top helper source is missing. Reinstall the extension.'),
    'cache-unwritable': t('TM1 Top cannot write its helper cache. Check extension storage permissions, then refresh.'),
    'compile-failed': t('TM1 Top helper compilation failed. Check the .NET Framework installation, then refresh.'),
    timeout: t('TM1 Top timed out. Check the admin host and server availability, then refresh.'),
    'helper-failed': t('TM1 Top helper exited unexpectedly. Check the native API installation, then refresh.'),
    'invalid-json': t('TM1 Top helper returned invalid JSON. Reinstall the extension.'),
    'invalid-response': t('TM1 Top helper returned an invalid response. Reinstall the extension.'),
    'invalid-request': t('TM1 Top rejected the request. Check the server name and administrator credentials, then retry.'),
    'output-too-large': t('TM1 Top returned too much data. Pause polling and check the server thread count.'),
    'verify-failed': t('Administrator verification failed.'),
    'kill-rejected': t('Thread cancellation was rejected. The thread may have already finished. Refresh the thread list.'),
    // Not "failed": the instruction reached TM1, only the helper process's
    // confirmation did not arrive. Someone reading "cancellation failed"
    // here would send it a second time.
    'kill-unconfirmed': t('Thread cancellation was sent, but the helper did not confirm it. Refresh the thread list to see whether the thread ended.'),
    'helper-request': t('The native helper could not complete this request. Refresh and retry.'),
    'native-api': t('The native TM1 server rejected the request. Check the server name, availability and permissions.'),
    'dll-load': t('The TM1 native DLL or a required runtime could not be loaded. Check the configured bin64 directory and its dependencies.'),
    'missing-export': t('The TM1 native DLL is missing a required function. Use a compatible TM1 v11 bin64 directory.'),
    architecture: t('TM1 Top requires compatible Windows x64 native binaries.'),
  };
  const message = messages[error.reason] ?? t('TM1 Top failed ({0}). Check the native API installation and admin server registration, then refresh.', error.reason);
  return error instanceof Tm1TopBridgeError && error.code !== undefined ? t('{0} Native error code: {1}.', message, error.code) : message;
}

/**
 * IBM's native API ships with TM1, never with this extension, so a missing bin64 directory is
 * something only the user can point us at. Offer the folder picker instead of naming a setting.
 */
function isLocatable(error: unknown): boolean {
  const reason = error instanceof Tm1TopUnavailable || error instanceof Tm1TopBridgeError ? error.reason : '';
  return reason === 'dll-missing' || reason === 'keystore-missing';
}

/** Returns true once a directory was picked and stored, so the caller can retry. */
async function pickBin64Directory(): Promise<boolean> {
  const t = vscode.l10n.t;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: t('Select bin64 folder…'), title: t('Select the IBM TM1 bin64 directory containing tm1api.dll'),
  });
  if (!picked?.length) { return false; }
  await vscode.workspace.getConfiguration('tm1').update('nativeApiPath', picked[0].fsPath, vscode.ConfigurationTarget.Global);
  return true;
}

async function showNativeError(error: unknown): Promise<void> {
  const choose = vscode.l10n.t('Select bin64 folder…');
  const answer = await vscode.window.showErrorMessage(nativeErrorMessage(error), ...(isLocatable(error) ? [choose] : []));
  if (answer === choose) { await pickBin64Directory(); }
}

export function disposeTm1TopPanelForServer(serverUrl: string): void {
  panels.get(serverUrl)?.dispose();
}

registerServerDisposer('tm1TopPanel', (url) => disposeTm1TopPanelForServer(url));

export function getTm1TopHtml(webview: vscode.Webview, prefill: { user: string; saved: boolean }, scriptUri: string): string {
  const t = vscode.l10n.t;
  return renderWebviewShell({
    cspSource: webview.cspSource,
    title: 'TM1 Top',
    css: `body {
      font-family:var(--vscode-font-family);
      font-size:var(--vscode-font-size);
      color:var(--vscode-foreground);
      background:var(--vscode-editor-background);
      margin:0
    }
    .toolbar {
      display:flex;
      align-items:center;
      gap:8px;
      padding:8px 12px;
      border-bottom:1px solid var(--vscode-panel-border);
      background:var(--vscode-sideBar-background);
      flex-wrap:wrap
    }
    button,input {
      font:inherit;
      color:var(--vscode-input-foreground);
      background:var(--vscode-input-background);
      border:1px solid var(--vscode-input-border);
      padding:4px 8px
    }
    button {
      cursor:pointer
    }
    button:disabled {
      opacity:.4;
      cursor:default
    }
    table {
      width:100%;
      border-collapse:collapse;
      font-size:12px
    }
    th,td {
      text-align:left;
      padding:5px 8px;
      border-bottom:1px solid var(--vscode-editorGroup-border);
      white-space:pre-wrap
    }
    th {
      background:var(--vscode-editorGroupHeader-tabsBackground)
    }
    .s-wait {
      color:var(--vscode-editorWarning-foreground)
    }
    .s-run {
      color:var(--vscode-testing-iconPassed)
    }
    .s-idle,#status {
      color:var(--vscode-descriptionForeground)
    }
    #error {
      color:var(--vscode-errorForeground);
      padding:8px 12px
    }
    tbody tr:hover { background: var(--vscode-list-hoverBackground); }
    td:first-child, td:nth-child(2), td:nth-child(7) { font-variant-numeric: tabular-nums; }
    td:nth-child(7) { text-align: right; }
    button.kill { color: var(--vscode-errorForeground); border-color: var(--vscode-errorForeground); }
    button:hover:not(:disabled) { background: var(--vscode-toolbar-hoverBackground); }
    [hidden] { display: none !important; }
    ${COLUMN_RESIZE_CSS}
    `,
    body: `<div class="toolbar"><strong>TM1 Top</strong><button id="refresh"></button><button id="locate" hidden></button><label><input type="checkbox" id="paused"><span id="pause-label"></span></label><span id="status" role="status"></span></div><form class="toolbar" id="login"><label><span id="user-label"></span> <input id="user" autocomplete="off"></label><label><span id="password-label"></span> <input id="password" type="password" autocomplete="off"></label><button id="verify" type="submit"></button></form><div id="error" role="alert"></div><table data-resizable><thead><tr id="head"></tr></thead><tbody id="rows"></tbody></table>`,
    globals: { prefill, labels: { refresh: t('Refresh'), locate: t('Select bin64 folder…'), pause: t('Pause'), user: t('Admin user'), password: t('Password'), verify: t('Verify administrator'), kill: t('Cancel thread'), verified: t('Administrator verified'), unverified: t('Administrator not verified'), empty: t('No threads'), columns: [t('Thread ID'), t('Session'), t('User'), t('Context'), t('State'), t('Details'), t('Elapsed'), t('Action')] } } satisfies Tm1TopBootstrap,
    scriptUris: [scriptUri],
    // Column width by dragging (webviews/columnResize.ts) — after the bundle, because the bundle builds the header row.
    inlineScript: columnResizeScript('tm1Top', savedColumnWidths('tm1Top')),
  });
}

export async function openTm1TopPanelForProfile(context: vscode.ExtensionContext, profile: ServerProfile): Promise<void> {
  if (profile.version === 'v12' || profile.authType.startsWith('v12-')) {
    throw new Error(vscode.l10n.t('TM1 Top requires a native TM1 v11 server.'));
  }
  const existing = panels.get(profile.serverUrl);
  if (existing) { existing.reveal(undefined, true); return; }
  const parent = profile.parentAdminId ? getAdminServer(profile.parentAdminId) : undefined;
  const adminHost = nativeHost(parent?.serverUrl ?? profile.serverUrl);
  const server = await resolveNativeServerName(context, profile, adminHost);
  if (!server) { return; }
  const cred = await loadCredentials(context, profile);
  const basic = cred.ok && cred.authType === 'Basic' ? cred : undefined;
  await openTm1TopPanel(context, {
    key: profile.serverUrl,
    title: `${profile.name} : TM1 Top`,
    adminHost,
    server,
    serverId: profile.id,
    storedUser: basic?.username ?? '',
    storedPassword: basic?.password ?? '',
  });
}

interface Tm1TopTarget {
  key: string;
  title: string;
  adminHost: string;
  /** The concrete native server name to connect to. Both entry points resolve
   *  it before opening, from discovery or native server selection. */
  server: string;
  serverId?: string;
  adminId?: string;
  storedUser: string;
  storedPassword: string;
}

async function openTm1TopPanel(context: vscode.ExtensionContext, target: Tm1TopTarget): Promise<void> {
  const key = target.key;
  const existing = panels.get(key);
  if (existing) { existing.reveal(undefined, true); return; }
  const adminHost = target.adminHost;
  const storedUser = target.storedUser;
  const storedPassword = target.storedPassword;
  const panel = vscode.window.createWebviewPanel('tm1Top', target.title,
    // ViewColumn: deliberate
    // Fixed column on purpose: side-by-side monitoring preserves the working editor's focus.
    { viewColumn: vscode.ViewColumn.Two, preserveFocus: true },
    { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'out')] });
  setPanelIcon(panel, 'tm1Top');
  muteWebviewOnDispose(panel);
  panels.set(key, panel);
  registerWindow({ kind: 'tm1Top', rawKey: key, panel, serverId: target.serverId ?? key });
  panel.webview.html = getTm1TopHtml(panel.webview, { user: storedUser, saved: storedPassword !== '' },
    String(panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'out', 'webview', 'tm1Top.js'))));
  rememberColumnWidths(panel, 'tm1Top');
  let bridge: Tm1TopBridge | undefined;
  let ready = false;
  const server = target.server;
  let inFlight = false;
  let poll: Promise<void> | undefined;
  let paused = false;
  let timer: NodeJS.Timeout | undefined;
  let credentials: { username: string; password: string } | undefined;
  let authGeneration = 0;
  const alive = () => panels.get(key) === panel;
  const post = (message: Tm1TopToWebview) => { if (alive()) { void postTo<Tm1TopToWebview>(panel.webview, message); } };
  const invalidate = () => { credentials = undefined; authGeneration++; post({ verified: false }); };
  // Name the affected server in every error so a failure (e.g. native code 84)
  // says WHICH instance it was — the panel may be one of several.
  const postError = (error: unknown) => post({
    error: server ? `${server}: ${nativeErrorMessage(error)}` : nativeErrorMessage(error),
    locate: isLocatable(error),
  });
  async function refresh(): Promise<void> {
    if (!alive() || !ready || !bridge || !server || inFlight || poll || !panel.visible) { return; }
    // Background polling must NOT toggle the webview `busy` flag: that flips the
    // verify/kill buttons' disabled state every cycle and makes them blink. It
    // also must not `invalidate()` a transient read error — kill re-authenticates
    // each time, so a blip should not silently drop an admin verification.
    const currentBridge = bridge;
    poll = (async () => {
      try { const rows = await currentBridge.getState(adminHost, server); post({ rows: parseState(rows), error: '' }); }
      catch (error) { postError(error); }
    })();
    try { await poll; } finally { poll = undefined; }
  }
  function schedule(): void {
    if (timer) { clearInterval(timer); timer = undefined; }
    if (!paused && panel.visible && alive()) {
      const ms = Math.max(250, vscode.workspace.getConfiguration('tm1').get<number>('threadRefreshMs') ?? 2000);
      timer = setInterval(() => { void refresh(); }, ms);
      void refresh();
    }
  }
  const messages = panel.webview.onDidReceiveMessage(async (msg: WebviewToHost) => {
    if (!alive()) { return; }
    if (msg.command === 'invalidate') { invalidate(); return; }
    if (msg.command === 'pause') { paused = msg.paused === true; schedule(); return; }
    if (msg.command === 'refresh') { if (!ready) { await initialize(); } else { await refresh(); } return; }
    if (msg.command === 'locate') { if (await pickBin64Directory() && alive()) { await initialize(); } return; }
    if (!ready || !bridge || !server || inFlight) { return; }
    if (msg.command !== 'verify' && msg.command !== 'kill') { return; }
    inFlight = true;
    post({ busy: true });
    const queuedGeneration = authGeneration;
    try {
      if (poll) { await poll; }
      if (!alive() || queuedGeneration !== authGeneration) { return; }
      if (msg.command === 'verify') {
        invalidate();
        // Empty field ⇒ fall back to the profile's stored login, so a user with
        // credentials on file need not retype the admin user and password.
        const username = (typeof msg.username === 'string' && msg.username !== '') ? msg.username : storedUser;
        const password = (typeof msg.password === 'string' && msg.password !== '') ? msg.password : storedPassword;
        if (username === '' || password === '') { throw new Error(vscode.l10n.t('Administrator verification failed.')); }
        const attempt = { username, password };
        const generation = authGeneration;
        const verified = await bridge.verifyAdmin(adminHost, server, attempt.username, attempt.password);
        if (!alive() || generation !== authGeneration) { return; }
        if (!verified) { throw new Error(vscode.l10n.t('Administrator verification failed.')); }
        credentials = attempt;
        post({ verified: true, error: '' });
      } else {
        if (!credentials || typeof msg.threadId !== 'string' || !/^\d+$/.test(msg.threadId)) { return; }
        const generation = authGeneration;
        const yes = vscode.l10n.t('Yes, cancel');
        const answer = await vscode.window.showWarningMessage(vscode.l10n.t('Really cancel thread {0}?', msg.threadId), { modal: true }, yes);
        if (!alive() || answer !== yes || !credentials || generation !== authGeneration) { return; }
        await bridge.kill(adminHost, server, msg.threadId, credentials.username, credentials.password);
        post({ error: '' });
      }
    } catch (error) {
      if (msg.command === 'verify' || (error instanceof Tm1TopBridgeError && error.reason === 'verify-failed')) { invalidate(); }
      postError(error);
    }
    finally { inFlight = false; post({ busy: false }); }
  });
  const visibility = panel.onDidChangeViewState(schedule);
  const removal = onProfileRemoved.event(owner => {
    if (owner.kind === 'server' ? owner.id === target.serverId : owner.id === target.adminId) {
      panel.dispose();
    }
  });
  panel.onDidDispose(() => {
    credentials = undefined;
    authGeneration++;
    if (timer) { clearInterval(timer); }
    if (alive()) { panels.delete(key); }
    bridge?.dispose();
    unregisterWindow(panel);
    messages.dispose(); visibility.dispose(); removal.dispose();
  // No `context.subscriptions`: the array only grows — the listener dies with
  // the panel it is registered on, like the three disposables above.
  });
  async function initialize(): Promise<void> {
    if (!alive() || inFlight) { return; }
    try {
      inFlight = true;
      post({ busy: true });
      ready = false;
      bridge?.dispose();
      bridge = undefined;
      const runtime = await resolveNativeRuntime({ nativeApiPath: vscode.workspace.getConfiguration('tm1').get<string>('nativeApiPath'), extensionPath: context.extensionPath, storagePath: context.globalStorageUri.fsPath });
      if (!alive()) { return; }
      bridge = new Tm1TopBridge({ ...runtime, timeoutMs: vscode.workspace.getConfiguration('tm1').get<number>('threadRefreshTimeoutMs') ?? 5000 });
      if (!alive()) { return; }
      ready = true;
    } catch (error) { postError(error); }
    finally { inFlight = false; post({ busy: false }); }
    if (alive()) { schedule(); }
  }
  await initialize();
}

export async function showTm1TopCommand(context: vscode.ExtensionContext, node?: Tm1TreeNode): Promise<void> {
  const id = node?.meta?.serverId;
  const profile = typeof id === 'string' ? getServerProfile(id) : undefined;
  if (!profile) { void vscode.window.showErrorMessage(vscode.l10n.t('Select a native TM1 v11 server in the TM1 tree.')); return; }
  try { await openTm1TopPanelForProfile(context, profile); }
  catch (error) { void showNativeError(error); }
}

/** Native APIs take a host literal, unlike URLs which require IPv6 brackets. */
function nativeHost(url: string): string {
  return new URL(url).hostname.replace(/^\[|\]$/g, '');
}

async function listNativeServers(context: vscode.ExtensionContext, adminHost: string): Promise<string[]> {
  const runtime = await resolveNativeRuntime({ nativeApiPath: vscode.workspace.getConfiguration('tm1').get<string>('nativeApiPath'), extensionPath: context.extensionPath, storagePath: context.globalStorageUri.fsPath });
  const probe = new Tm1TopBridge({ ...runtime, timeoutMs: vscode.workspace.getConfiguration('tm1').get<number>('threadRefreshTimeoutMs') ?? 5000 });
  let servers: string[];
  try { servers = await probe.enumServers(adminHost); } finally { probe.dispose(); }
  if (servers.length === 0) { throw new Error(vscode.l10n.t('No native TM1 servers are registered on admin host {0}. Check the registration, then refresh.', adminHost)); }
  return servers;
}

async function selectNativeServer(context: vscode.ExtensionContext, adminHost: string): Promise<string | undefined> {
  const servers = await listNativeServers(context, adminHost);
  return servers.length === 1 ? servers[0] : await vscode.window.showQuickPick(servers, { title: vscode.l10n.t('Select the native TM1 server') });
}

/**
 * The native name of the server behind a PROFILE. A profile's `name` is a
 * display label the user chose and may be anything ("Test (11.8)"), so it is
 * only accepted when it literally matches a registered native name.
 *
 * Order: the discovered name (already the native one) — the connected server's
 * own `ServerName` — the label if it matches a registration — and only then the
 * picker. Without that middle step every open of a hand-made profile asked
 * again which instance was meant, although the user had clicked one.
 */
async function resolveNativeServerName(context: vscode.ExtensionContext, profile: ServerProfile, adminHost: string): Promise<string | undefined> {
  if (profile.discoveredName) { return profile.discoveredName; }
  const cfg = getServerConfig(profile.id);
  if (cfg) {
    // Not connected, no permission, v12 — every failure just falls through to
    // the registration list, which needs no login at all.
    try {
      // Plain GET, no `$select`: this is the shape `serverConfig/configApi.ts`
      // runs against live 11.8. A few KB once per open is cheaper than an
      // untested projection that answers 400.
      const res = await apiRequest('GET', 'Configuration', undefined, undefined, cfg);
      const name = parseBodySafe<{ ServerName?: unknown }>(res, {}).ServerName;
      if (typeof name === 'string' && name !== '') { return name; }
    } catch { /* fall through */ }
  }
  const servers = await listNativeServers(context, adminHost);
  const match = servers.find(s => s.toLowerCase() === profile.name.trim().toLowerCase());
  if (match) { return match; }
  return servers.length === 1 ? servers[0] : await vscode.window.showQuickPick(servers, { title: vscode.l10n.t('Select the native TM1 server') });
}

/** Admin-node entry point: open TM1 Top against the admin host and let the user
 *  pick one of its registered instances — works without a per-instance profile
 *  or REST login, which is the whole point when a server cannot be logged into. */
export async function showTm1TopForAdminCommand(context: vscode.ExtensionContext, node?: Tm1TreeNode): Promise<void> {
  const adminId = node?.meta?.adminId;
  const admin = typeof adminId === 'string' ? getAdminServer(adminId) : undefined;
  if (!admin) { void vscode.window.showErrorMessage(vscode.l10n.t('Select a native TM1 v11 server in the TM1 tree.')); return; }
  const adminHost = nativeHost(admin.serverUrl);
  try {
    // Pick the instance BEFORE opening, so each pick maps to its own per-server
    // panel: opening the admin node again lets the user choose a DIFFERENT
    // instance, while re-picking the same one just reveals its existing panel.
    const server = await selectNativeServer(context, adminHost);
    if (!server) { return; }
    await openTm1TopPanel(context, {
      key: `admin:${admin.id}::${server}`,
      adminId: admin.id,
      title: `${server} : TM1 Top`,
      adminHost,
      server,
      storedUser: '',
      storedPassword: '',
    });
  } catch (error) { void showNativeError(error); }
}
