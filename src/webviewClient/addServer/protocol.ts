// src/webviewClient/addServer/protocol.ts
// Typed postMessage contracts for the add-/edit-server webview.
// vscode-free — structurally compatible with ServerFormData in serverManager.ts.

export type AuthType = 'Basic' | 'CAM' | 'integrated' | 'v12-basic' | 'browser';

export interface V12FormData {
  instance: string;
  database: string;
  authMode: 'basic-s2s' | 'basic-native' | 'saas';
  tm1User: string;
}

export interface ServerFormData {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
  authType: AuthType;
  camNamespace?: string;
  /** Integrated login only: Kerberos SPN override. */
  spn?: string;
  rejectUnauthorized: boolean;
  version?: 'v11' | 'v12';
  v12?: V12FormData;
  /** Set ⇒ the profile uses a named credential set instead of own
   *  credentials — see `ServerFormData.credentialId` in `serverManager/form.ts`. */
  credentialId?: string;
  /** Edit of a PAW gateway only: its tenant (`AdminFormData.tenant`). */
  tenant?: string;
  /** Edit only: the profile has a stored password. It never comes into the
   *  webview — the field stays empty, and empty means "unchanged" (the host
   *  fills in the stored secret, `serverManager/form.ts#withStoredPassword`). */
  hasPassword?: boolean;
}

/**
 * Credential set as the panel shows it to the webview and as the webview sends
 * it back for saving. Deliberately duplicated locally instead of imported from
 * `serverState/state.ts#CredentialSet`:
 * `webviewClient/` must not import from `commands/` (rule
 * `webview-no-commands`), not even type-only — `tsPreCompilationDeps:
 * true` in `.dependency-cruiser.js` counts `import type` edges.
 */
export interface CredentialSetInfo {
  id: string;
  name: string;
  username: string;
  authType: AuthType;
  camNamespace?: string;
}

/**
 * Form data for the "admin server" kind — deliberately separate from
 * `ServerFormData`: an admin server has no credentials of its own, it only
 * reports which instances are registered with it (`tm1Rest/adminServerApi`).
 */
export interface AdminFormData {
  kind: 'tm1' | 'paw';
  name: string;
  serverUrl: string;
  rejectUnauthorized: boolean;
  /** Credential set that NEWLY discovered instances receive (no reach-through to
   *  existing children) — see `AdminServerProfile.defaultCredentialId`. */
  defaultCredentialId?: string;
  /** PAW only: newly discovered instances log in through the browser. */
  defaultAuthType?: 'browser';
  /** PAW only: tenant id for the instance URLs. */
  tenant?: string;
  /** New entry only: reported names the user left unticked in the list. */
  hidden?: string[];
}

/** `f-cred` value for "browser login" on a PAW gateway — not a credential set. */
export const BROWSER_DEFAULT = '__browser__';

/** Enables Save/Test for the admin kind — just needs a name + URL. Pure — no DOM. */
export function isAdminFormValid(d: AdminFormData): boolean {
  return Boolean(d.name && d.serverUrl);
}

/** Is "Save" disabled? Pure — no DOM. Only while busy or incomplete: an
 *  untested instance runs the probe itself on Save (`saveRunsTestFirst`).
 *  Until 2026-11-01 Save stayed greyed out until a separate Test, and the
 *  click test found that nobody could tell why. */
export function isSaveDisabled(s: { busy: boolean; valid: boolean }): boolean {
  return s.busy || !s.valid;
}

/**
 * Does Save run the probe first? Pure — no DOM.
 *
 * The probe before saving is the rule for an INSTANCE: there credentials are
 * stored and a connection is established right away, and the probe may correct
 * the form (scheme/TLS fallback) before it is stored. An admin server carries
 * only name, URL and the certificate check; a wrong URL costs nothing except an
 * error child on expanding — it saves without a probe, so one whose machine is
 * currently down can still be renamed.
 */
export function saveRunsTestFirst(s: { testedOk: boolean; adminKind: boolean }): boolean {
  return !s.adminKind && !s.testedOk;
}

/** Root (management-plane) credentials + target, sent transiently per action. */
export interface MgmtReq {
  serverUrl: string;
  rejectUnauthorized: boolean;
  clientId: string;
  clientSecret: string;
  instance: string;
  /** database name, for create/delete */
  name?: string;
}

/**
 * Enables Save/Test. Pure — no DOM.
 */
export function isServerFormValid(d: ServerFormData, storedPassword = false): boolean {
  if (!d.name || !d.serverUrl) { return false; }
  const password = !!d.password || storedPassword;
  if (d.version === 'v12') {
    if (!d.v12?.database) { return false; }
    // Browser login against PA SaaS: tenant + database, no key.
    if (d.authType === 'browser') { return !!d.v12.instance; }
    if (d.v12.authMode === 'basic-s2s') {
      // App-Client ID (in the username field) + secret + impersonation user.
      if (!d.username || !password || !d.v12.tm1User) { return false; }
    } else if (d.v12.authMode === 'basic-native') {
      // Native TM1 users may have no password → require only the username.
      if (!d.username) { return false; }
    } else if (d.v12.authMode === 'saas') {
      // Tenant id (in the instance field) + API key.
      if (!d.v12.instance || !password) { return false; }
    }
    return true;
  }
  // Integrated login: empty fields are the normal case (the running
  // Windows session), typed data only the NTLM fallback.
  if (d.authType === 'integrated') { return true; }
  // Browser login through PAW: no credentials; the URL shape is checked by
  // buildTm1Config on the host.
  if (d.authType === 'browser') { return true; }
  if (!d.username) { return false; }
  if (d.authType === 'CAM' && !d.camNamespace) { return false; }
  return true;
}

/** Severity of the webview's inline status line (`''` = hidden). */
export type StatusSeverity = '' | 'ok' | 'err' | 'info' | 'warn';

/**
 * Severity of a connect-fallback notice. Pure — no DOM.
 *
 * `tls` (certificate verification OFF) and `http` (credentials in clear
 * text) mean the profile is about to be saved with a downgraded transport →
 * warn. Only the http→https swap is a pure correction → info.
 */
export function fallbackSeverity(note: 'http' | 'https' | 'tls'): StatusSeverity {
  return note === 'https' ? 'info' : 'warn';
}

export type HostToWebview =
  | { type: 'init'; mode: 'add' | 'edit'; data: ServerFormData; kind?: 'instance' | 'admin' | 'paw' }
  | { type: 'testResult'; ok: boolean; version?: string; message?: string; fallbackFollows?: boolean }
  /** `cancelled` = the host's insecure-transport modal was declined; nothing was persisted. */
  | { type: 'saveResult'; ok: boolean; message?: string; warning?: string; cancelled?: boolean }
  | { type: 'mgmtResult'; ok: boolean; databases?: string[]; instance?: string; message?: string }
  | { type: 'fallbackApplied'; serverUrl?: string; rejectUnauthorized?: boolean; note: 'http' | 'https' | 'tls' }
  /** Reply to `probeAdmin` — `count` is instances with `acceptingClients: true`. */
  /** `tenants`/`tenant`: PA SaaS gateway only — the logged-in user's tenants, and the one used when only one exists. */
  | { type: 'adminProbeResult'; ok: boolean; count?: number; message?: string; requestId?: number; tenants?: { id: string; name: string }[]; tenant?: string; databases?: { name: string; acceptingClients: boolean }[] }
  /** Answer to `credList` — per set only the `hasPassword` marker, never the secret itself. */
  | { type: 'credListResult'; sets: (CredentialSetInfo & { hasPassword: boolean })[] }
  /** Answer to `credSave`. `message` only on `ok: false` (e.g. duplicate name). */
  | { type: 'credSaveResult'; ok: boolean; message?: string; id?: string }
  /** Answer to `credDelete`. `inUseBy` = profile names that still point to the set (delete protection). */
  | { type: 'credDeleteResult'; ok: boolean; inUseBy?: string[] }
  | { type: 'saasListsResult'; ok: boolean; tenants?: { id: string; name: string }[]; databases?: string[]; message?: string }
  | ({ type: 'detectResult'; requestId: number } & DetectResultData);

/** Anonymous type detection (`serverManager/serverDetect.ts`). */
export interface DetectResultData {
  ok: boolean;
  kind?: 'v11' | 'v12' | 'admin' | 'paw' | 'saas';
  auth?: 'Basic' | 'CAM' | 'integrated';
  /** Origin that answered — may differ from the typed one in its scheme. */
  serverUrl?: string;
  /** Answered only with certificate verification off. */
  certUntrusted?: boolean;
  databases?: { name: string; acceptingClients: boolean }[];
  v12?: { instance: string; database?: string };
  saas?: { tenant: string; database?: string };
  /** A PAW instance URL was pasted: tick only this database. */
  pawDatabase?: string;
  message?: string;
}

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'test'; data: ServerFormData }
  | { type: 'save'; data: ServerFormData }
  | { type: 'delete' }
  | { type: 'cancel' }
  | { type: 'mgmtLoad'; req: MgmtReq }
  | { type: 'mgmtCreate'; req: MgmtReq }
  | { type: 'mgmtDelete'; req: MgmtReq }
  | ({ type: 'probeAdmin'; requestId?: number } & AdminFormData)
  | ({ type: 'saveAdmin' } & AdminFormData)
  | { type: 'credList' }
  | { type: 'credSave'; set: CredentialSetInfo; password?: string }
  | { type: 'credDelete'; id: string }
  | { type: 'saasLists'; serverUrl: string; rejectUnauthorized: boolean }
  | { type: 'detect'; requestId: number; serverUrl: string; rejectUnauthorized: boolean };
