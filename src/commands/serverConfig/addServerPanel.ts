// src/commands/serverConfig/addServerPanel.ts
import * as vscode from 'vscode';
import { getHtml } from './addServerWebview';
import { testServerConnection, saveServerFromForm, getServerFormData, withStoredPassword, deleteServer, confirmInsecureSave } from '../serverManager';
import { listDatabases, createDatabase, deleteDatabase, type RootCreds } from '../../tm1Rest/managementApi';
import { saveAdminServer, newAdminServerId, getAdminServer } from '../../serverState/adminServers';
import { onServerChanged, getAllServers, credKey } from '../../serverState/state';
import { removeAdminServerWithChildren } from '../serverManager/adminRemove';
import { loadSaasLists } from '../serverManager/browserConnect';
import { validateServerUrl, normalizeServerUrl } from '../../utils/serverUrl';
import type { HostToWebview, WebviewToHost, ServerFormData, MgmtReq } from '../../webviewClient/addServer/protocol';
import { BROWSER_DEFAULT } from '../../webviewClient/addServer/protocol';
import { WebviewPanelHost } from '../../webviews/webviewPanelHost';
import { errMsg } from '../../utils/errMsg';
import { listCredentials, saveCredential, deleteCredential, newCredentialId, getCredential } from '../serverManager/credentials';
import { resolveCredentials } from '../serverManager/credentialResolvePure';
import { describeInstanceListError, listInstancesFor } from '../../providers/adminInstances';
import { normalizePawGatewayUrl, PawGatewayError } from '../../tm1Rest/pawGatewayUrl';
import { describePawError } from '../../utils/pawErrorText';
import { postTo } from '../../webviews/typedPost';
import { detectServer } from '../serverManager/serverDetect';

/**
 * Login-profile messages (task 4/5). The three shapes now live in the
 * shared protocol (`webviewClient/addServer/protocol.ts#WebviewToHost`/
 * `HostToWebview`) instead of locally here — task 4 had still added them
 * locally, because `webviewClient/` was locked there at the time (see the
 * task-4 report). Without the move, TypeScript no longer checked the host
 * and webview sides against each other, and a field drift would only
 * surface at runtime.
 */
type CredMsgIn = Extract<WebviewToHost, { type: 'credList' | 'credSave' | 'credDelete' }>;
type CredMsgOut = Extract<HostToWebview, { type: 'credListResult' | 'credSaveResult' | 'credDeleteResult' }>;

const host = new WebviewPanelHost<WebviewToHost>('tm1.addServer', vscode.l10n.t('Add server'));

export function initializeAddServerPanel(extensionUri: vscode.Uri): void {
  host.initialize(extensionUri);
}

export function disposeAllAddServerPanels(): void {
  host.disposeAll();
}

/** An admin-server entry that disappeared while a window was open. As a
 *  function rather than a constant, so that `vscode.l10n` is read at call
 *  time and not when the module loads. */
function ADMIN_GONE(): string {
  return vscode.l10n.t('TM1: Admin server not found.');
}

function post(panel: vscode.WebviewPanel, msg: HostToWebview): void {
  postTo<HostToWebview>(panel.webview, msg);
}

/**
 * Answers `credList`/`credSave`/`credDelete` — pulled out into its own
 * function (no behavior change) so it is testable without a real webview
 * panel: this is exactly where it is decided whether a set's password goes
 * into the panel (`hasPassword` instead of the value), and this guarantee
 * needs its own test instead of just the detour through `onMessage`.
 */
export async function handleCredMessage(
  ctx: vscode.ExtensionContext,
  msg: CredMsgIn,
): Promise<CredMsgOut> {
  if (msg.type === 'credList') {
    return {
      type: 'credListResult',
      sets: await Promise.all(listCredentials().map(async c => ({
        ...c,
        // A set's password NEVER goes into the webview: it is attached to N
        // profiles, and an edit window would otherwise show a secret that
        // the viewer never entered for this profile.
        hasPassword: !!(await ctx.secrets.get(credKey(c.id))),
      }))),
    };
  } else if (msg.type === 'credSave') {
    const id = msg.set.id || newCredentialId();
    const res = await saveCredential({ ...msg.set, id }, msg.password === '' ? undefined : msg.password);
    return { type: 'credSaveResult', ok: !res.error, message: res.error, id };
  } else {
    const res = await deleteCredential(ctx, msg.id);
    return { type: 'credDeleteResult', ok: !res.inUseBy, inUseBy: res.inUseBy };
  }
}

/** The referenced login profile is gone (another window). As a function, so
 *  that `vscode.l10n` is read at call time — the same string the web
 *  interface already knows for the save path (`credGoneOnSave`). */
function CRED_GONE(): string {
  return vscode.l10n.t('The selected login profile was deleted. Please pick another one.');
}

/**
 * Resolves a reference to a login profile on the HOST side, before the
 * form data goes into a real connection.
 *
 * When a set is selected, the web interface only writes a display
 * placeholder into the locked password field and no longer sends any
 * password at all (see `webviewClient/addServer/index.ts#collect`). Without
 * this resolution, the connection test would go to the real server with the
 * set's real username and a wrong password: every press of "Test" a failed
 * attempt, and with a group account only a few clicks away from an account
 * lockout — and because "Save" for an instance is tied to a successful test
 * (`protocol.ts#isSaveDisabled`), it was not possible to save an instance
 * profile with a login profile at all (final review 2026-08-28, finding 2).
 *
 * A webview is NEVER a password source — the secret comes from
 * SecretStorage here, via the same pure rule as when connecting
 * (`credentialResolvePure#resolveCredentials`): either everything from the
 * set or everything from the profile, never mixed.
 */
export async function resolveFormCredentials(
  ctx: vscode.ExtensionContext,
  data: ServerFormData,
): Promise<{ ok: true; data: ServerFormData } | { ok: false; message: string }> {
  if (!data.credentialId) { return { ok: true, data }; }
  const set = getCredential(data.credentialId);
  const setPassword = await ctx.secrets.get(credKey(data.credentialId)) ?? '';
  const cred = resolveCredentials(data, set, data.password, setPassword);
  // No fallback to the form fields: when a set is selected, they only carry
  // the set's display values, not the user's.
  if (!cred.ok) { return { ok: false, message: CRED_GONE() }; }
  return {
    ok: true,
    data: {
      ...data,
      username: cred.username,
      password: cred.password,
      authType: cred.authType,
      camNamespace: cred.camNamespace,
    },
  };
}

const DEFAULTS: ServerFormData = {
  name: '',
  // Empty on purpose (click-test feedback, 2026-08-27, round B/2): the
  // kind-specific example URL lives in the webview's `placeholder` only
  // (`syncUrlPlaceholder()`), never pre-filled as a value the user would
  // have to delete first.
  serverUrl: '',
  username: '',
  password: '',
  authType: 'Basic',
  camNamespace: '',
  rejectUnauthorized: true,
};

interface PanelSpec {
  key: string;
  title: string;
  mode: 'add' | 'edit';
  /** Preset; DEFAULTS for 'add'. */
  data: ServerFormData;
  /** Profile id when editing — otherwise create new. */
  existingId?: string;
  /** Preselected kind in the form's kind switch; missing = 'instance'. */
  kind?: 'instance' | 'admin' | 'paw';
  /** Admin-server id when editing — otherwise a new entry is created. */
  existingAdminId?: string;
}

/**
 * Does the entry this window is editing even still exist?
 *
 * A window in "add" mode edits nothing and always counts as alive. If the
 * access throws (test doubles without `globalState`), that counts as alive
 * too — closing a window because of a read error would be worse than
 * leaving one window too many open.
 */
function _specStillExists(ctx: vscode.ExtensionContext, spec: PanelSpec): boolean {
  try {
    if (spec.existingAdminId) { return !!getAdminServer(spec.existingAdminId); }
    if (spec.existingId) { return getAllServers(ctx).some(s => s.id === spec.existingId); }
  } catch { /* see above */ }
  return true;
}

function openPanel(ctx: vscode.ExtensionContext, spec: PanelSpec): void {
  if (host.reveal(spec.key)) { return; }

  const panel = host.open({
    key: spec.key,
    title: spec.title,
    html: getHtml,
    onMessage: async (msg, panel) => {
      if (msg.type === 'ready') {
        post(panel, { type: 'init', mode: spec.mode, data: spec.data, kind: spec.kind });
      } else if (msg.type === 'test') {
        const data = spec.existingId ? await withStoredPassword(ctx, spec.existingId, msg.data) : msg.data;
        const resolved = await resolveFormCredentials(ctx, data);
        if (!resolved.ok) {
          post(panel, { type: 'testResult', ok: false, message: resolved.message });
          return;
        }
        const result = await testServerConnection(resolved.data);
        // `fallbackFollows`: a Save waiting on this probe must store the
        // corrected fields, so it waits for the message below.
        post(panel, {
          type: 'testResult', ok: result.ok, version: result.version, message: result.message,
          ...(result.appliedFallback ? { fallbackFollows: true } : {}),
        });
        if (result.appliedFallback) {
          post(panel, { type: 'fallbackApplied', ...result.appliedFallback });
        }
      } else if (msg.type === 'save') {
        if (spec.existingAdminId) {
          post(panel, { type: 'saveResult', ok: false, message: vscode.l10n.t('The entry type cannot be changed.') });
          return;
        }
        // Insecure transport (plain HTTP and/or certificate verification off)
        // needs an explicit modal OK before anything is persisted — one modal
        // covers both cases (see classifyInsecureSave).
        if (!await confirmInsecureSave(msg.data)) {
          post(panel, {
            type: 'saveResult',
            ok: false,
            cancelled: true,
            message: vscode.l10n.t('Not saved — the insecure connection was not confirmed.'),
          });
          return;
        }
        const data = spec.existingId ? await withStoredPassword(ctx, spec.existingId, msg.data) : msg.data;
        const result = await saveServerFromForm(ctx, data, spec.existingId);
        // Both form errors mean the same thing: NOTHING was saved.
        if (typeof result.urlError === 'string' || typeof result.credentialError === 'string') {
          post(panel, {
            type: 'saveResult', ok: false,
            message: result.urlError ?? result.credentialError,
          });
          return;
        }
        if (result.connectError) {
          // Profile saved, but connection failed — leave the panel open.
          post(panel, {
            type: 'saveResult',
            ok: true,
            warning: vscode.l10n.t('Saved, but connection failed: {0}', result.connectError),
          });
        } else {
          post(panel, { type: 'saveResult', ok: true, message: vscode.l10n.t('Saved and connected.') });
          vscode.window.showInformationMessage(
            spec.mode === 'edit'
              ? vscode.l10n.t('TM1: Server "{0}" updated and connected.', result.profile.name)
              : vscode.l10n.t('TM1: Server "{0}" added and connected.', result.profile.name)
          );
          panel.dispose();
        }
      } else if (msg.type === 'delete') {
        if (spec.existingAdminId) {
          // An admin server brings its own confirmation prompt — what
          // happens to the instances discovered through it is decided by
          // the user there. The context-menu entry takes the same path.
          if (!getAdminServer(spec.existingAdminId)) {
            post(panel, { type: 'saveResult', ok: false, message: ADMIN_GONE() });
            return;
          }
          if (await removeAdminServerWithChildren(ctx, spec.existingAdminId)) { panel.dispose(); }
          return;
        }
        if (!spec.existingId) { return; }
        const REMOVE = vscode.l10n.t('Remove');
        const answer = await vscode.window.showWarningMessage(
          vscode.l10n.t('Really remove server "{0}"?', spec.data.name),
          { modal: true }, REMOVE,
        );
        if (answer !== REMOVE) { return; }
        const name = await deleteServer(ctx, spec.existingId);
        vscode.window.showInformationMessage(vscode.l10n.t('TM1: Server "{0}" removed.', name ?? spec.data.name));
        panel.dispose();
      } else if (msg.type === 'mgmtLoad' || msg.type === 'mgmtCreate' || msg.type === 'mgmtDelete') {
        await handleMgmt(msg.type, msg.req, panel);
      } else if (msg.type === 'probeAdmin') {
        let kind: 'tm1' | 'paw' = msg.kind === 'paw' ? 'paw' : 'tm1';
        let tenants: { id: string; name: string }[] | undefined;
        try {
          kind = checkedAdminKind(msg.kind, spec);
          const adminUrl = kind === 'paw' ? normalizePawGatewayUrl(msg.serverUrl) : normalizeServerUrl(msg.serverUrl);
          const urlError = validateServerUrl(adminUrl);
          if (urlError) { throw new Error(urlError); }
          let tenant = msg.tenant?.trim() || undefined;
          const endpoint = { kind, serverUrl: adminUrl, rejectUnauthorized: msg.rejectUnauthorized };
          let list: Awaited<ReturnType<typeof listInstancesFor>>;
          try {
            list = await listInstancesFor({ ...endpoint, tenant });
          } catch (err) {
            // A gateway that lists only to a logged-in browser — PA SaaS
            // always, PAW Local when anonymous access is off. Decided by the
            // answer, not by the host name. The test click is the explicit
            // connect that may open the browser.
            if (kind !== 'paw' || !(err instanceof PawGatewayError) || err.statusCode !== 401) { throw err; }
            tenants = (await loadSaasLists(adminUrl, msg.rejectUnauthorized)).tenants;
            if (!tenant && tenants.length === 1) { tenant = tenants[0].id; }
            list = await listInstancesFor({ ...endpoint, tenant });
          }
          post(panel, {
            type: 'adminProbeResult', requestId: msg.requestId, ok: true,
            count: list.filter(i => i.acceptingClients).length, tenants, tenant,
            // PA SaaS lists its databases only after the browser login, so
            // the tick list for it can only come from here, not from detection.
            databases: list.map(i => ({ name: i.name, acceptingClients: i.acceptingClients })),
          });
        } catch (err) {
          post(panel, { type: 'adminProbeResult', requestId: msg.requestId, ok: false, message: describeInstanceListError(kind, err, msg.serverUrl), tenants });
        }
      } else if (msg.type === 'saveAdmin') {
        let kind: 'tm1' | 'paw';
        let url: string;
        try {
          kind = checkedAdminKind(msg.kind, spec);
          url = kind === 'paw' ? normalizePawGatewayUrl(msg.serverUrl) : normalizeServerUrl(msg.serverUrl);
        } catch (error) {
          post(panel, { type: 'saveResult', ok: false, message: describePawError(error, msg.serverUrl) });
          return;
        }
        const urlErr = validateServerUrl(url);
        if (urlErr) {
          post(panel, { type: 'saveResult', ok: false, message: urlErr });
          return;
        }
        const name = msg.name.trim() || url;
        // When editing, write back into the SAME entry — and carry `hidden`
        // along: the removed instances are not in the form, and saving
        // without them would silently bring them back on the next
        // discovery.
        const existingAdmin = spec.existingAdminId ? getAdminServer(spec.existingAdminId) : undefined;
        if (spec.existingAdminId && !existingAdmin) {
          // The entry disappeared while the window was open. Without this
          // check, the path below falls back to `newAdminServerId()` and
          // silently creates a SECOND entry — the user wanted to edit
          // (review 2026-08-28, finding 3).
          post(panel, { type: 'saveResult', ok: false, message: ADMIN_GONE() });
          return;
        }
        // As with the server profile (finding 7): an id for which no set
        // exists anymore would get stamped by `adminDiscovery` onto every
        // newly discovered instance — it would then count as provisioned
        // and only fail when connecting.
        if (msg.defaultCredentialId && !getCredential(msg.defaultCredentialId)) {
          post(panel, { type: 'saveResult', ok: false, message: CRED_GONE() });
          return;
        }
        await saveAdminServer({
          id: existingAdmin?.id ?? newAdminServerId(),
          kind,
          name,
          serverUrl: url,
          rejectUnauthorized: msg.rejectUnauthorized,
          // The tick list only exists while adding; editing keeps the
          // tree's hide/restore commands as the one place for it.
          hidden: existingAdmin?.hidden ?? (msg.hidden ?? []).filter(n => typeof n === 'string'),
          defaultCredentialId: msg.defaultCredentialId || undefined,
          // The wire value is not trusted: only a PAW gateway has a browser route.
          defaultAuthType: kind === 'paw' && msg.defaultAuthType === 'browser' ? 'browser' : undefined,
          tenant: kind === 'paw' ? msg.tenant?.trim() || undefined : undefined,
        });
        post(panel, { type: 'saveResult', ok: true, message: vscode.l10n.t('Saved.') });
        vscode.window.showInformationMessage(
          existingAdmin
            ? vscode.l10n.t('TM1: Admin server "{0}" updated.', name)
            : vscode.l10n.t('TM1: Admin server "{0}" added.', name),
        );
        panel.dispose();
      } else if (msg.type === 'detect') {
        post(panel, { type: 'detectResult', requestId: msg.requestId, ...await detectServer(msg.serverUrl, msg.rejectUnauthorized) });
      } else if (msg.type === 'saasLists') {
        try {
          const lists = await loadSaasLists(normalizeServerUrl(msg.serverUrl), msg.rejectUnauthorized);
          post(panel, { type: 'saasListsResult', ok: true, ...lists });
        } catch (err) {
          post(panel, { type: 'saasListsResult', ok: false, message: errMsg(err) });
        }
      } else if (msg.type === 'cancel') {
        panel.dispose();
      } else if (msg.type === 'credList' || msg.type === 'credSave' || msg.type === 'credDelete') {
        post(panel, await handleCredMessage(ctx, msg));
      }
    },
  });

  // If the entry being edited disappears elsewhere — deleted in the tree,
  // cleaned up along with the admin server — the window has no target
  // left. Leaving it standing means letting the user keep typing until
  // "Save" tells them (click test, flameY3T1, 2026-08-28).
  // `null` if the host is not initialized — then there is also no window
  // that would need closing.
  if (!panel) { return; }
  const sub = onServerChanged.event(() => {
    if (!_specStillExists(ctx, spec)) { panel.dispose(); }
  });
  panel.onDidDispose(() => sub.dispose());
}

/** Validate the wire value too: hidden radio buttons are not a host-side guard. */
function checkedAdminKind(value: unknown, spec: PanelSpec): 'tm1' | 'paw' {
  const kind = value === undefined ? 'tm1' : value;
  if (kind !== 'tm1' && kind !== 'paw') { throw new Error(vscode.l10n.t('Unknown admin server type.')); }
  const existing = spec.existingAdminId ? getAdminServer(spec.existingAdminId) : undefined;
  if (spec.existingAdminId && !existing) { throw new Error(ADMIN_GONE()); }
  if (spec.existingId || (existing && (existing.kind ?? 'tm1') !== kind)) {
    throw new Error(vscode.l10n.t('The entry type cannot be changed.'));
  }
  return kind;
}

/**
 * Handles the inline v12 database management (list/create/delete) from the
 * add/edit-server webview. Root creds arrive transiently in the message and are
 * never persisted. Delete is guarded by a modal confirmation here (host side).
 */
async function handleMgmt(
  action: 'mgmtLoad' | 'mgmtCreate' | 'mgmtDelete',
  req: MgmtReq,
  panel: vscode.WebviewPanel,
): Promise<void> {
  const root: RootCreds = {
    serverUrl: req.serverUrl,
    clientId: req.clientId,
    clientSecret: req.clientSecret,
    rejectUnauthorized: req.rejectUnauthorized,
  };
  const instance = req.instance || 'tm1';
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  try {
    if (action === 'mgmtCreate' && req.name) {
      await createDatabase(root, instance, req.name);
      // v12 provisions a new database asynchronously — poll briefly until it
      // shows up so the list reflects the create without a manual reload.
      for (let i = 0; i < 8; i++) {
        const dbs = await listDatabases(root, instance);
        if (dbs.includes(req.name)) {
          post(panel, { type: 'mgmtResult', ok: true, databases: dbs, instance });
          return;
        }
        await sleep(500);
      }
    } else if (action === 'mgmtDelete' && req.name) {
      const DELETE = vscode.l10n.t('Delete');
      const ok = await vscode.window.showWarningMessage(
        vscode.l10n.t('Permanently delete database "{0}"?', req.name),
        { modal: true }, DELETE,
      );
      if (ok === DELETE) { await deleteDatabase(root, instance, req.name); }
    }
    const databases = await listDatabases(root, instance);
    post(panel, { type: 'mgmtResult', ok: true, databases, instance });
  } catch (err) {
    post(panel, { type: 'mgmtResult', ok: false, message: errMsg(err) });
  }
}

/** Opens the add-server web interface (toolbar button `tm1.addServer`). */
export function openAddServerPanel(ctx: vscode.ExtensionContext): void {
  openPanel(ctx, { key: 'add', title: vscode.l10n.t('Add TM1 Server'), mode: 'add', data: DEFAULTS });
}

/** Preset for the admin-server form — shares DEFAULTS' empty `serverUrl`;
 *  the example (port 5895, plain HTTP) is shown by the webview placeholder. */
const ADMIN_DEFAULTS: ServerFormData = { ...DEFAULTS };

/** Opens the same form with the kind preselected as "admin" (`tm1.adminServer.add`). */
export function openAddAdminServerPanel(ctx: vscode.ExtensionContext): void {
  openPanel(ctx, {
    key: 'add-admin',
    title: vscode.l10n.t('Add TM1 Admin Server'),
    mode: 'add',
    data: ADMIN_DEFAULTS,
    kind: 'admin',
  });
}

/** Opens the edit web interface for an existing profile (`tm1.editServer`). */
export async function openEditServerPanel(ctx: vscode.ExtensionContext, serverId: string): Promise<void> {
  const data = await getServerFormData(ctx, serverId);
  if (!data) {
    vscode.window.showWarningMessage(vscode.l10n.t('TM1: Server profile not found.'));
    return;
  }
  openPanel(ctx, {
    key: `edit:${serverId}`,
    title: vscode.l10n.t('Edit TM1 Server — {0}', data.name),
    mode: 'edit',
    data,
    existingId: serverId,
  });
}

/**
 * Opens the same edit view for an existing admin server
 * (`tm1.adminServer.edit`).
 *
 * The kind switch is hidden in edit mode, so the kind is fixed;
 * `syncKind()` hides the OWN credentials, version, and v12 databases for an
 * admin server anyway. What remains is name, URL, certificate verification,
 * and the selection field for the default set (`f-cred`, reused via
 * `ServerFormData.credentialId`) — exactly the four fields an
 * `AdminServerProfile` carries.
 */
export async function openEditAdminServerPanel(ctx: vscode.ExtensionContext, adminId: string): Promise<void> {
  const admin = getAdminServer(adminId);
  if (!admin) {
    vscode.window.showWarningMessage(ADMIN_GONE());
    return;
  }
  openPanel(ctx, {
    key: `edit-admin:${adminId}`,
    title: vscode.l10n.t('Edit TM1 Admin Server — {0}', admin.name),
    mode: 'edit',
    kind: admin.kind === 'paw' ? 'paw' : 'admin',
    data: {
      ...DEFAULTS,
      name: admin.name,
      serverUrl: admin.serverUrl,
      rejectUnauthorized: admin.rejectUnauthorized,
      // Reuses `ServerFormData.credentialId` (instead of its own field) —
      // `applyInit()` reads it kind-independently as the preselection for
      // `f-cred`.
      credentialId: admin.defaultAuthType === 'browser' ? BROWSER_DEFAULT : admin.defaultCredentialId,
      tenant: admin.tenant,
    },
    existingAdminId: adminId,
  });
}
