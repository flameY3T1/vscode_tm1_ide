// src/webviewClient/addServer/index.ts
// Client-Logik des Add-/Edit-Server-Webinterfaces. vscode-frei (Webview-Sandbox).
import type { HostToWebview, WebviewToHost, ServerFormData, AuthType, MgmtReq, StatusSeverity, AdminFormData, CredentialSetInfo, DetectResultData } from './protocol';
import { isServerFormValid, isAdminFormValid, fallbackSeverity, isSaveDisabled, saveRunsTestFirst, BROWSER_DEFAULT } from './protocol';
import { computeFormVisibility, type FormState, type SignInChoice } from './formVisibilityPure';
import { clearDatabases, hiddenDatabases, initDbPick, renderDatabases, syncDbPick, tickedDatabases, tickOnly } from './dbPick';
import { getL10n, fmt } from '../_shared/l10n';
// Same function as the host: a stripped `user:pass@` must not depend on who normalizes.
import { isSaasHost, normalizeServerUrl } from '../../utils/serverUrl';
import { pawInstanceRoute, pawTarget } from '../../utils/pawTarget';
import { getVsCodeApi } from '../_shared/vscodeApi';

const vscode = getVsCodeApi<WebviewToHost>();
const L = getL10n();

// Text of the default choice "own credentials" (value '' in the selection field).
const OWN_CREDENTIALS_LABEL = L.credOwn;
// Only the `placeholder` of a password field (login profile edit field, edited
// server profile),
// never `.value` — otherwise a field left unchanged would overwrite the stored
// secret with exactly these dots.
const PASSWORD_PLACEHOLDER = '••••••••';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) { throw new Error(`Missing #${id}`); }
  return el;
}
function input(id: string): HTMLInputElement { return $(id) as HTMLInputElement; }
function select(id: string): HTMLSelectElement { return $(id) as HTMLSelectElement; }

let busy = false;
// Test-before-Save gate: an instance is saved only after a successful
// `testResult` for the CURRENT connection-relevant field values — Save runs
// that probe itself when it is missing. Any edit to those fields (but not the
// display-name field) invalidates a prior successful test.
let testedOk = false;
/** Save was clicked on an untested instance: the probe runs first, and its
 *  success (after any fallback has been applied) continues into the save. */
let saveAfterTest = false;
/** `instanceFingerprint()` of the last instance test sent (or corrected by a
 *  fallback): its success counts only while the form still matches it. */
let testFp: string | undefined;
/** The last `testResult` was current and announced a `fallbackApplied`. Any
 *  other fallback belongs to values the form no longer holds. */
let fallbackExpected = false;
let nextAdminProbeRequestId = 1;
/** `fp` = `adminProbeFingerprint()` when the probe was sent. */
let activeAdminProbe: { requestId: number; fp: string } | undefined;

// ── Type detection (anonymous probe on URL blur, add mode only) ──────────────
let formMode: 'add' | 'edit' = 'add';
let detectRequestId = 0;
/** URL the last detection ran for — a blur without a change asks nothing. */
let detectedFor = '';

function collect(): ServerFormData {
  const version = (select('f-version').value as 'v11' | 'v12');
  if (version === 'v12') {
    // `saas-browser` is a form-only choice: authMode saas + authType browser.
    const browser = select('f-authmode').value === 'saas-browser';
    const authMode = (browser ? 'saas' : select('f-authmode').value) as FormState['authMode'];
    const authType: AuthType = browser ? 'browser' : 'v12-basic';
    return {
      name: input('f-name').value.trim() || input('f-database').value.trim() || formName(),
      serverUrl: input('f-url').value.trim(),
      // PA as a Service: the user name of an API key is always `apikey`. The
      // username row is hidden then — a stale value in it must not count.
      username: browser ? '' : authMode === 'saas' ? 'apikey' : input('f-user').value,
      // A pasted API key often carries a trailing space or line break — a
      // bare 401 then (2026-10-14). A key never contains whitespace.
      password: browser ? '' : authMode === 'saas' ? input('f-pass').value.trim() : input('f-pass').value,
      authType,
      rejectUnauthorized: input('f-ssl').checked,
      version: 'v12',
      v12: {
        // The tenant id has no default — 'tm1' would only build a wrong URL.
        instance: input('f-instance').value.trim() || (authMode === 'saas' ? '' : 'tm1'),
        database: input('f-database').value.trim(),
        authMode,
        // S2S needs an explicit TM1 user to impersonate — must NOT fall back to
        // the username field (that holds the App-Client ID, not a TM1 user, and
        // would mint OK but 403 on every data call). Native derives it from the
        // login username.
        tm1User: authMode === 'basic-native'
          ? (input('f-tm1user').value.trim() || input('f-user').value.trim())
          : input('f-tm1user').value.trim(),
      },
    };
  }
  const ownAuthType = select('f-auth').value as AuthType;
  // Integrated login: no credential set, even if one is still in the (hidden)
  // selection field — otherwise its `authType` would apply.
  const credentialId = ownAuthType === 'integrated' || ownAuthType === 'browser'
    ? undefined : (select('f-cred').value || undefined);
  // With a login profile chosen, the own fields are hidden and only carry what
  // was last typed in independently. The data then comes from the profile
  // itself — otherwise the validity probe (`isServerFormValid` demands a user
  // name) would hang on fields that the user no longer sees at all.
  const set = credentialId ? credSets.find(c => c.id === credentialId) : undefined;
  const authType = set ? set.authType : ownAuthType;
  return {
    name: formName(),
    serverUrl: input('f-url').value.trim(),
    username: set ? set.username : ownAuthType === 'browser' ? '' : input('f-user').value,
    // The web interface is NEVER a password source: with a profile chosen only
    // the id goes out, the host fetches the secret from SecretStorage
    // (`addServerPanel.ts#resolveFormCredentials`).
    password: credentialId || ownAuthType === 'browser' ? '' : input('f-pass').value,
    authType,
    camNamespace: authType === 'CAM'
      ? (set ? (set.camNamespace ?? '') : input('f-cam').value.trim())
      : undefined,
    spn: authType === 'integrated' ? input('f-spn').value.trim() || undefined : undefined,
    rejectUnauthorized: input('f-ssl').checked,
    version: 'v11',
    // v11 only — v12 has its own login route (token mint) and is
    // explicitly left out (see design spec, section "Not included").
    credentialId,
  };
}

// ── Anmeldesaetze (benannte Zugangsdaten, an mehreren Profilen genutzt) ─────

let credSets: (CredentialSetInfo & { hasPassword: boolean })[] = [];
// Remembered from `init`, so that the preselection is also right when `credListResult`
// only arrives AFTER `init` (the host answers `credList` asynchronously via
// `ctx.secrets.get`, whereas the host writes `init` back synchronously).
let initialCredentialId = '';
// While the edit field is open: empty id = new set, otherwise the id of the
// set currently being edited (for `credSave`).
let credEditingId = '';

/** The "Browser login" entry of `f-cred`; `syncForm` hides it outside PAW. */
let browserOpt: HTMLOptionElement | undefined;
/** The profile was opened with the SaaS browser login: keep that choice on offer after switching away. */
let openedWithSaasBrowser = false;
// Edit only: the profile has a stored password (shown as placeholder, never as value).
let storedPassword = false;

function renderCredOptions(selected: string): void {
  const sel = select('f-cred');
  sel.innerHTML = '';
  const own = document.createElement('option');
  own.value = '';
  own.textContent = OWN_CREDENTIALS_LABEL;
  sel.appendChild(own);
  for (const c of credSets) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = c.name + ' (' + c.username + ')';
    sel.appendChild(o);
  }
  browserOpt = document.createElement('option');
  browserOpt.value = BROWSER_DEFAULT;
  browserOpt.textContent = L.credBrowserDefault;
  sel.appendChild(browserOpt);
  sel.value = selected;
  syncForm();
}

function syncCredCamRow(): void {
  $('row-cred-cam').style.display = select('f-cred-auth').value === 'CAM' ? '' : 'none';
}

/** Shows the edit field — empty for a new set, otherwise prefilled with the
 *  values of the given set. The password is NEVER present as
 *  `.value` (only as `placeholder`, if one is stored) — a field left empty
 *  means "unchanged" on saving, see `onCredSave`. */
function openCredEditPanel(set?: CredentialSetInfo & { hasPassword: boolean }): void {
  credEditingId = set?.id ?? '';
  $('cred-edit-title').textContent = set ? L.credEditExisting : L.credEditNew;
  input('f-cred-name').value = set?.name ?? '';
  input('f-cred-user').value = set?.username ?? '';
  input('f-cred-pass').value = '';
  input('f-cred-pass').placeholder = set?.hasPassword ? PASSWORD_PLACEHOLDER : '';
  select('f-cred-auth').value = set?.authType === 'CAM' ? 'CAM' : 'Basic';
  input('f-cred-cam').value = set?.camNamespace ?? '';
  syncCredCamRow();
  $('cred-edit-panel').style.display = '';
}

function closeCredEditPanel(): void {
  $('cred-edit-panel').style.display = 'none';
}

function onCredNew(): void {
  openCredEditPanel();
}

function onCredEdit(): void {
  const set = credSets.find(c => c.id === select('f-cred').value);
  if (!set) { return; }
  openCredEditPanel(set);
}

function onCredSave(): void {
  const name = input('f-cred-name').value.trim();
  if (!name) { return; }
  const authType = select('f-cred-auth').value as AuthType;
  onConnectionFieldChanged();
  setBusy(true, L.saving);
  vscode.postMessage({
    type: 'credSave',
    set: {
      id: credEditingId,
      name,
      username: input('f-cred-user').value,
      authType,
      camNamespace: authType === 'CAM' ? input('f-cred-cam').value.trim() : undefined,
    },
    // Leer = "unveraendert lassen" (Host: `password === '' ? undefined : password`).
    password: input('f-cred-pass').value,
  });
}

function onCredDelete(): void {
  const id = select('f-cred').value;
  if (!id) { return; }
  setBusy(true);
  vscode.postMessage({ type: 'credDelete', id });
}

function isAdminKind(): boolean {
  return selectedKind() !== 'instance';
}

/**
 * PAW tile, adding, exactly one database ticked: that database becomes an
 * instance profile with browser login, named as typed — Test then logs in to
 * that very instance. A gateway entry is only worth it for several.
 * ponytail: tenant (PA SaaS) stays on the gateway route; add it when needed.
 */
function singlePawDb(): string | undefined {
  if (formMode !== 'add' || selectedKind() !== 'paw' || input('f-paw-tenant').value.trim()) { return undefined; }
  const ticked = tickedDatabases();
  return ticked?.length === 1 ? ticked[0] : undefined;
}

/** Test and Save go the gateway route (`probeAdmin`/`saveAdmin`). */
function gatewayRoute(): boolean {
  return isAdminKind() && singlePawDb() === undefined;
}

/** Instance data Test and Save send: the form, or the one ticked PAW database. */
function instanceForm(): ServerFormData {
  const db = singlePawDb();
  if (db === undefined) { return collect(); }
  let gateway = '';
  try { gateway = new URL(input('f-url').value.trim()).origin; } catch { /* invalid URL: isValid rejects the empty one */ }
  return {
    name: input('f-name').value.trim() || db,
    serverUrl: gateway && pawInstanceRoute(gateway, encodeURIComponent(db)),
    username: '',
    password: '',
    authType: 'browser',
    rejectUnauthorized: input('f-ssl').checked,
    version: 'v11',
  };
}

const SIGN_IN_CHOICES: readonly SignInChoice[] = ['basic', 'cam', 'integrated', 'browser', 'saas-browser', 'saas', 's2s', 'native'];

/** A type tile was picked: instance, PA as a Service and v12 differ only in
 *  the hidden version and auth-mode selects, which stay the source of truth. */
function applyTile(): void {
  const tile = (document.querySelector('input[name="kind"]:checked') as HTMLInputElement | null)?.value;
  if (tile === 'instance') { select('f-version').value = 'v11'; }
  // A PAW gateway signs in through the browser almost always: preselect it when
  // adding, once per switch to the tile — the user can still pick a profile.
  if (tile === 'paw' && formMode === 'add' && select('f-cred').value === '') { select('f-cred').value = BROWSER_DEFAULT; }
  if (tile === 'saas' || tile === 'v12') {
    select('f-version').value = 'v12';
    const isSaas = select('f-authmode').value.startsWith('saas');
    // Browser login on SaaS goes through the gateway tile; this tile is the API key.
    if (tile === 'saas' && !isSaas) { select('f-authmode').value = 'saas'; }
    if (tile === 'v12' && isSaas) { select('f-authmode').value = 'basic-s2s'; }
  }
}

/** A sign-in choice was picked: its value names the select it sets. */
function applySignIn(value: string): void {
  const [target, v] = value.split(':');
  select(target === 'auth' ? 'f-auth' : 'f-authmode').value = v;
}

function selectedKind(): 'instance' | 'admin' | 'paw' {
  const value = (document.querySelector('input[name="kind"]:checked') as HTMLInputElement | null)?.value;
  return value === 'admin' || value === 'paw' ? value : 'instance';
}

// Example URLs shown as `placeholder` only — never written into `.value`, so a
// URL the user already typed survives a kind switch untouched. Admin servers
// default to a different port/scheme than a regular TM1 instance.
const URL_PLACEHOLDER_INSTANCE = 'https://localhost:8010';
const URL_PLACEHOLDER_ADMIN = 'http://localhost:5895';
const URL_PLACEHOLDER_PAW = 'https://paw-host:9443';

function syncUrlPlaceholder(): void {
  const kind = selectedKind();
  const v = computeFormVisibility(readFormState());
  input('f-url').placeholder = kind === 'paw'
    ? URL_PLACEHOLDER_PAW
    : kind === 'admin' ? URL_PLACEHOLDER_ADMIN
    : v.saasLabels ? 'https://eu-central-1.planninganalytics.saas.ibm.com'
    : v.v12Rows ? 'http://localhost:4444' : URL_PLACEHOLDER_INSTANCE;
}

/** The display name, or the host of the address when it is left empty: the
 *  required name went unnoticed and kept Test and Save greyed out
 *  (click test 2026-11-01). */
function formName(): string {
  return input('f-name').value.trim() || urlHost();
}

function urlHost(): string {
  try { return new URL(input('f-url').value.trim()).hostname; } catch { return ''; }
}

let namePlaceholder: string | undefined;
/** The empty name field shows the name it will get. */
function syncNamePlaceholder(): void {
  const el = input('f-name');
  namePlaceholder ??= el.placeholder;
  el.placeholder = urlHost() || namePlaceholder;
}

function collectAdmin(): AdminFormData {
  return {
    kind: selectedKind() === 'paw' ? 'paw' : 'tm1',
    name: formName(),
    serverUrl: input('f-url').value.trim(),
    rejectUnauthorized: input('f-ssl').checked,
    // Default set for newly discovered instances — the same selection field as
    // for an instance, but here without own credentials behind it.
    ...(select('f-cred').value === BROWSER_DEFAULT
      ? { defaultAuthType: 'browser' as const }
      : { defaultCredentialId: select('f-cred').value || undefined }),
    ...(selectedKind() === 'paw' && input('f-paw-tenant').value.trim()
      ? { tenant: input('f-paw-tenant').value.trim() } : {}),
    hidden: hiddenDatabases(),
  };
}

/**
 * Top of the form, one state at a time: `awaiting` = add mode before
 * detection (address only), `detected` = result line with "Change type",
 * `tiles` = the type tiles, `fixed` = edit mode (the kind cannot change).
 */
function setKindView(view: 'awaiting' | 'detected' | 'tiles' | 'fixed', text?: string): void {
  $('wrap').className = view === 'awaiting' ? 'wrap awaiting' : 'wrap';
  $('kind-switch').style.display = view === 'tiles' ? '' : 'none';
  $('detected').hidden = view !== 'awaiting' && view !== 'detected';
  if (text !== undefined) { $('detected-text').textContent = text; }
}

function showKindTiles(): void { setKindView('tiles'); }

function startDetect(): void {
  const url = input('f-url').value.trim();
  if (formMode !== 'add' || !url || url === detectedFor) { return; }
  detectedFor = url;
  detectRequestId += 1;
  clearDatabases();
  syncForm();
  setStatus('info', L.detecting);
  vscode.postMessage({ type: 'detect', requestId: detectRequestId, serverUrl: url, rejectUnauthorized: input('f-ssl').checked });
}

const AUTH_LABEL: Record<NonNullable<DetectResultData['auth']>, () => string> = {
  Basic: () => L.authBasic, CAM: () => L.authCam, integrated: () => L.authIntegrated,
};

function applyDetect(r: DetectResultData): void {
  if (!r.ok || !r.kind) {
    showKindTiles();
    setStatus(r.message ? 'err' : 'info', r.message ?? L.detectedNone);
    return;
  }
  if (r.serverUrl && r.serverUrl !== input('f-url').value.trim()) {
    input('f-url').value = r.serverUrl;
    detectedFor = r.serverUrl;
    syncNamePlaceholder();
  }
  if (r.certUntrusted) { input('f-ssl').checked = false; }
  // PA SaaS goes to the gateway entry with browser login, as the URL blur
  // switch always did: Test then lists tenants and databases.
  const tile = r.kind === 'v11' ? 'instance' : r.kind === 'saas' ? 'paw' : r.kind;
  input('kind-' + tile).checked = true;
  applyTile();
  let text: string;
  if (r.kind === 'v11') {
    select('f-auth').value = r.auth ?? 'Basic';
    text = fmt(L, 'detectedV11', AUTH_LABEL[r.auth ?? 'Basic']());
  } else if (r.kind === 'v12') {
    if (r.v12 && !input('f-instance').value.trim()) { input('f-instance').value = r.v12.instance; }
    if (r.v12?.database && !input('f-database').value.trim()) { input('f-database').value = r.v12.database; }
    text = L.detectedV12;
  } else if (r.kind === 'saas') {
    if (r.saas && !input('f-paw-tenant').value.trim()) { input('f-paw-tenant').value = r.saas.tenant; }
    text = L.detectedSaas;
  } else {
    renderDatabases(r.databases ?? []);
    if (r.pawDatabase) { tickOnly(r.pawDatabase); }
    text = fmt(L, r.kind === 'paw' ? 'detectedPaw' : 'detectedAdmin', String(r.databases?.length ?? 0));
  }
  setKindView('detected', text);
  syncForm();
  if (r.certUntrusted) { setStatus('warn', L.detectedCertUntrusted); } else if (r.kind === 'saas') { setStatus('info', L.saasDetected); } else { setStatus('', ''); }
  refreshButtons();
}

/** Reads the state of the form from the controls — the only place that
 *  translates DOM into `FormState`. */
function readFormState(): FormState {
  return {
    adminKind: isAdminKind(),
    version: select('f-version').value === 'v12' ? 'v12' : 'v11',
    authMode: (select('f-authmode').value === 'saas-browser' ? 'saas' : select('f-authmode').value) as FormState['authMode'],
    ownAuthType: select('f-auth').value as AuthType,
    credSelected: credSets.some(c => c.id === select('f-cred').value),
    pawKind: selectedKind() === 'paw',
    browser: select('f-version').value === 'v12'
      ? select('f-authmode').value === 'saas-browser'
      : select('f-auth').value === 'browser',
    saasBrowserOffered: openedWithSaasBrowser,
    pawInstanceUrl: pawTarget(input('f-url').value) !== undefined,
  };
}

/**
 * Brings the whole form into the state that `computeFormVisibility` describes —
 * the ONLY place that shows and hides field groups.
 *
 * Previously four procedures did that (`syncKind`, `syncVersionRows`,
 * `syncCredPicker`, `syncCamRow`), which called each other mutually so that
 * nothing stuck when switching. Every new condition had to be fitted into all
 * four, and whoever forgot one got a state that no path cleaned up anymore —
 * several of the click-test findings sat exactly there. Now a pure table
 * answers the question, and here is only how to attach it to the DOM.
 */
function syncForm(): void {
  const state = readFormState();
  const v = computeFormVisibility(state);
  const show = (id: string, on: boolean): void => { $(id).style.display = on ? '' : 'none'; };

  show('cred-select-group', v.credSelectGroup);
  show('credentials-group', v.credentialsGroup);
  show('row-cam', v.camRow);
  show('hint-integrated', v.integratedHint);
  // The SPN belongs to the integrated login and nothing else.
  show('row-spn', v.integratedHint);
  show('hint-spn', v.integratedHint);
  show('hint-browser', v.browserHint);
  show('btn-saas-lists', v.saasListsButton);
  if (browserOpt) {
    browserOpt.hidden = !v.credBrowserOption;
    if (browserOpt.hidden && select('f-cred').value === BROWSER_DEFAULT) { select('f-cred').value = ''; }
  }
  show('kind-hint', v.kindHint);
  show('row-paw-tenant', state.pawKind);
  // The v11 hints (port 8010, gateway paths) mislead under v12 — the auth
  // mode hint further down says what the URL is there.
  show('url-hint', !v.v12Rows);
  show('url-hint-gateway', !state.adminKind && !v.v12Rows);
  // The base hint names an INSTANCE port (8010). Under the two group types
  // that is the wrong number — an admin server listens on 5895, a PAW gateway
  // wants no instance path at all (reported 2026-09-16).
  $('url-hint').textContent = selectedKind() === 'paw' ? L.urlHintPaw
    : selectedKind() === 'admin' ? L.urlHintAdmin : L.urlHint;
  show('v12-rows', v.v12Rows);
  // Tiles and sign-in choices mirror the hidden selects (never the reverse,
  // except through their own change handlers).
  if (!state.adminKind) { input('kind-' + v.tile).checked = true; }
  syncDbPick();
  for (const c of SIGN_IN_CHOICES) {
    show('si-row-' + c, v.signIn.includes(c));
    input('si-' + c).checked = c === v.signInChecked;
  }
  show('row-tm1user', v.rowTm1User);
  show('btn-mgmt', v.btnMgmt);
  if (v.forceHideMgmtPanel) { $('mgmt-panel').style.display = 'none'; }

  // Labels that depend on the same state.
  // An admin server carries no own credentials — the same selection field
  // means the default set for newly discovered instances there.
  $('lbl-cred').textContent = state.adminKind ? L.credDefaultLabel : L.credLabel;
  $('kind-hint').textContent = selectedKind() === 'paw' ? L.kindHintPaw : L.kindHint;
  $('btn-save').textContent = state.adminKind ? L.saveGroup : L.saveConnect;
  // v12/S2S benutzt Benutzer/Passwort als App-Client-Id + Geheimnis.
  $('lbl-user').textContent = v.s2sLabels ? L.appClientId : L.username;
  $('lbl-pass').textContent = v.s2sLabels ? L.appSecret : v.saasLabels ? L.apiKey : L.password;
  $('lbl-instance').textContent = v.saasLabels ? L.tenantId : L.instance;
  input('f-instance').placeholder = v.saasLabels ? 'ABCDEFGH1234' : 'tm1';
  input('f-database').placeholder = v.saasLabels ? 'MyDatabase' : 'tm1db';
  show('row-user', v.rowUser);
  show('row-pass', v.rowPass);
  const mode = state.authMode;
  $('authmode-hint').textContent = state.browser && v.v12Rows ? L.authModeHintSaasBrowser
    : mode === 'saas' ? L.authModeHintSaas
    : mode === 'basic-native' ? L.authModeHintNative
    : mode === 'basic-s2s' ? L.authModeHintS2s : '';
  // Convenience: S2S almost always identifies itself as admin.
  if (v.s2sLabels && !input('f-tm1user').value) { input('f-tm1user').value = 'admin'; }

  syncUrlPlaceholder();
  syncUrlPreview();
  // Each of these switches changes what would actually be connected to —
  // like any other connection-relevant field change, it invalidates a
  // previous successful probe.
  onConnectionFieldChanged();
}

function syncUrlPreview(): void {
  const kind = selectedKind();
  const n = kind === 'paw'
    ? input('f-url').value.trim().replace(/\/+$/, '')
    : normalizeServerUrl(input('f-url').value);
  const version = select('f-version').value;
  $('url-preview').textContent = n
    ? L.previewPrefix + ' ' + n + (kind === 'paw'
      ? '/api/v1/tm1/Servers'
      : kind === 'admin' ? '/api/v1/Servers' : (version === 'v12' ? '' : '/api/v1'))
    : '';
  const showWarn = /^http:\/\//i.test(n);
  $('http-warn').hidden = !showWarn;
  if (showWarn) { $('http-warn').textContent = L.httpWarn; }
}

// Every validity check (buttons, Test, Save) knows about a stored password.
const isValid = (d: ServerFormData): boolean => isServerFormValid(d, storedPassword);

function refreshButtons(): void {
  const adminKind = gatewayRoute();
  const admin = adminKind ? collectAdmin() : undefined;
  const valid = admin ? isAdminFormValid(admin) : isValid(instanceForm());
  // A PAW whose list is already shown has nothing left to test for several
  // databases — a second browser login there only ran into the timeout.
  const pawListed = adminKind && selectedKind() === 'paw' && tickedDatabases() !== undefined && !$('db-list').hidden;
  (input('btn-test') as HTMLButtonElement).disabled = busy || !valid || pawListed;
  // Says which of the two the ticks make: one instance, or the gateway.
  const single = singlePawDb();
  const ticked = tickedDatabases()?.length ?? 0;
  $('db-pick-mode').hidden = !(single !== undefined || pawListed && ticked > 1);
  $('db-pick-mode').textContent = single !== undefined ? fmt(L, 'dbModeInstance', instanceForm().name)
    : fmt(L, 'dbModeGateway', String(ticked));
  (input('btn-saas-lists') as HTMLButtonElement).disabled = busy;
  // For an instance, saving additionally requires a successful probe of the
  // current field values; for an admin server it does not (see `isSaveDisabled`).
  (input('btn-save') as HTMLButtonElement).disabled = isSaveDisabled({ busy, valid });
}

/** Connection-relevant fields to a live TM1 connection are excluded here: `f-name`
 *  is the display-name only, so renaming a saved profile must not reset the gate. */
function onConnectionFieldChanged(): void {
  // Only a change of what the probe sent voids it. `syncForm()` ends here on
  // every redraw (a detection answer, a credential list), and the probe does
  // not use the credential (`probeAdmin` in addServerPanel.ts) — dropping it
  // there threw away a finished browser login (review 2026-11-02).
  if (activeAdminProbe && activeAdminProbe.fp !== adminProbeFingerprint()) {
    activeAdminProbe = undefined;
    setBusy(false);
  }
  // `syncForm()` ends here on every redraw, a detection answer included. For
  // an instance only a real change of what would be connected to voids the
  // test; a pending Save stays and re-tests the new values (review
  // 2026-11-01 evening: a detection answer during the Save probe dropped the
  // save).
  if (gatewayRoute() || instanceFingerprint() !== testFp) { testedOk = false; }
  refreshButtons();
}

/** What a gateway probe depends on: its route and the fields the host reads. */
function adminProbeFingerprint(): string {
  return JSON.stringify({
    gateway: gatewayRoute(),
    kind: selectedKind(),
    serverUrl: input('f-url').value.trim(),
    rejectUnauthorized: input('f-ssl').checked,
    tenant: input('f-paw-tenant').value.trim(),
  });
}

/** What an instance test checks: the form without the display name. */
function instanceFingerprint(): string {
  return JSON.stringify({ ...instanceForm(), name: '' });
}

function setStatus(kind: StatusSeverity, text: string): void {
  const el = $('status');
  el.className = 'status' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function setBusy(b: boolean, msg?: string): void {
  busy = b;
  refreshButtons();
  if (msg) { setStatus('info', msg); }
}

function onTest(): void {
  if (gatewayRoute()) {
    const d = collectAdmin();
    if (!isAdminFormValid(d)) { return; }
    setBusy(true, L.testing);
    const requestId = nextAdminProbeRequestId++;
    activeAdminProbe = { requestId, fp: adminProbeFingerprint() };
    vscode.postMessage({ type: 'probeAdmin', requestId, ...d });
    return;
  }
  const d = instanceForm();
  if (!isValid(d)) { return; }
  testFp = instanceFingerprint();
  setBusy(true, L.testing);
  vscode.postMessage({ type: 'test', data: d });
}

function onSave(): void {
  if (gatewayRoute()) {
    const d = collectAdmin();
    if (!isAdminFormValid(d)) { return; }
    setBusy(true, L.saving);
    vscode.postMessage({ type: 'saveAdmin', ...d });
    return;
  }
  const d = instanceForm();
  if (!isValid(d)) { return; }
  if (saveRunsTestFirst({ testedOk, adminKind: false })) {
    saveAfterTest = true;
    onTest();
    return;
  }
  // No separate freshness detour via `credList` anymore: whether the chosen
  // credential set still exists is checked by the host on saving anyway
  // (`saveServerFromForm` → `credentialError`, admin server branch →
  // `getCredential`) and it answers with `saveResult ok:false`. Only the
  // host check is reliable; the second one in the web interface produced the
  // same message twice.
  setBusy(true, L.saving);
  vscode.postMessage({ type: 'save', data: d });
}

function continueSave(): void {
  if (!saveAfterTest) { return; }
  saveAfterTest = false;
  if (testedOk) { onSave(); }
}

// ── v12 database management (inline, uses transient Root creds) ─────────────

function mgmtReq(name?: string): MgmtReq {
  return {
    serverUrl: input('f-url').value.trim(),
    rejectUnauthorized: input('f-ssl').checked,
    clientId: input('f-mgmt-cid').value.trim(),
    clientSecret: input('f-mgmt-sec').value,
    instance: input('f-instance').value.trim() || 'tm1',
    name,
  };
}

function onMgmtLoad(): void {
  if (!input('f-url').value.trim() || !input('f-mgmt-cid').value.trim()) {
    setStatus('err', L.mgmtNeedRoot);
    return;
  }
  setBusy(true, L.mgmtLoading);
  vscode.postMessage({ type: 'mgmtLoad', req: mgmtReq() });
}

function fillDatalist(id: string, options: { value: string; label?: string }[]): void {
  const list = $(id);
  list.innerHTML = '';
  for (const o of options) {
    const el = document.createElement('option');
    el.value = o.value;
    if (o.label) { el.label = o.label; }
    list.appendChild(el);
  }
}

function onSaasLists(): void {
  const serverUrl = input('f-url').value.trim();
  if (!serverUrl) { setStatus('err', L.saasListsNeedUrl); return; }
  setBusy(true, L.saasListsLoading);
  vscode.postMessage({ type: 'saasLists', serverUrl, rejectUnauthorized: input('f-ssl').checked });
}

function onMgmtCreate(): void {
  const name = input('f-mgmt-new').value.trim();
  if (!name) { return; }
  setBusy(true, L.mgmtLoading);
  vscode.postMessage({ type: 'mgmtCreate', req: mgmtReq(name) });
}

function renderMgmt(databases: string[]): void {
  const list = $('mgmt-list');
  list.innerHTML = '';
  if (!databases.length) {
    const empty = document.createElement('div');
    empty.className = 'hint';
    empty.textContent = L.mgmtEmpty;
    list.appendChild(empty);
  }
  for (const db of databases) {
    const row = document.createElement('div');
    row.className = 'mgmt-row';
    const name = document.createElement('span');
    name.className = 'mgmt-name';
    name.textContent = db;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = L.mgmtDelete;
    del.addEventListener('click', () => {
      setBusy(true, L.mgmtLoading);
      vscode.postMessage({ type: 'mgmtDelete', req: mgmtReq(db) });
    });
    row.appendChild(name);
    row.appendChild(del);
    list.appendChild(row);
  }
  $('mgmt-create-row').style.display = '';
}

function applyInit(mode: 'add' | 'edit', d: ServerFormData, kind?: 'instance' | 'admin' | 'paw'): void {
  $('heading').textContent = mode === 'edit' ? L.headingEdit : L.headingAdd;
  formMode = mode;
  input(kind === 'paw' ? 'kind-paw' : kind === 'admin' ? 'kind-admin' : 'kind-instance').checked = true;
  $('btn-delete').style.display = mode === 'edit' ? '' : 'none';
  // In edit mode the kind of the entry can no longer be switched:
  // ticking "Admin server" and saving created a NEW admin server and closed
  // the window, while the user expected a conversion of the profile
  // (review 2026-08-27, finding 4).
  // Plain "Add server" starts with the address alone; the admin-server
  // command presets its kind and skips detection's first step.
  if (mode === 'edit') { setKindView('fixed'); } else if ((kind ?? 'instance') === 'instance') { setKindView('awaiting', L.detectPrompt); } else { setKindView('tiles'); }
  input('f-name').value = d.name ?? '';
  // No fallback to a hardcoded URL here: an empty `d.serverUrl` (the add-
  // dialog's DEFAULTS/ADMIN_DEFAULTS) must leave the field genuinely empty so
  // the kind-specific example shows as a `placeholder` (syncForm() below), not
  // as a value the user has to delete first. Edit mode always carries the
  // profile's real, non-empty URL here.
  input('f-url').value = d.serverUrl ?? '';
  input('f-paw-tenant').value = d.tenant ?? '';
  openedWithSaasBrowser = d.version === 'v12' && d.authType === 'browser';
  input('f-user').value = d.username ?? '';
  input('f-pass').value = d.password ?? '';
  storedPassword = !!d.hasPassword;
  input('f-pass').placeholder = storedPassword ? PASSWORD_PLACEHOLDER : '';
  select('f-auth').value = d.authType === 'CAM' || d.authType === 'integrated' || (d.authType === 'browser' && d.version !== 'v12')
    ? d.authType : 'Basic';
  input('f-cam').value = d.camNamespace ?? '';
  input('f-spn').value = d.spn ?? '';
  input('f-ssl').checked = d.rejectUnauthorized !== false;
  select('f-version').value = d.version === 'v12' ? 'v12' : 'v11';
  if (d.v12) {
    input('f-instance').value = d.v12.instance ?? '';
    input('f-database').value = d.v12.database ?? '';
    select('f-authmode').value = d.authType === 'browser' ? 'saas-browser' : d.v12.authMode ?? 'basic-s2s';
    // Self-heal profiles saved by an intermediate build that let the S2S TM1
    // user fall back to the App-Client ID (username) → that mints OK but 403s
    // every data call. Drop that stale value so the admin prefill re-applies.
    const staleTm1User = d.v12.authMode === 'basic-s2s' && d.v12.tm1User === d.username;
    input('f-tm1user').value = staleTm1User ? '' : (d.v12.tm1User ?? '');
  }
  // Remember the preselection and apply it immediately — if `credListResult`
  // already arrived before `init`, the set sits right there; otherwise the
  // handler below catches up on the preselection as soon as the list arrives.
  initialCredentialId = d.credentialId ?? '';
  renderCredOptions(initialCredentialId);
  syncForm();
  refreshButtons();
}

/** Applies a connect-fallback the host discovered during Test (e.g. HTTPS→HTTP,
 *  or only reachable by accepting the server certificate) to the form fields.
 *  The just-tested config IS the mutated one, so the test-before-save gate
 *  must stay green — set `.value`/`.checked` directly (no `input`/`change`
 *  event dispatch) so the field-changed listeners don't reset `testedOk`. */
function applyFallback(m: Extract<HostToWebview, { type: 'fallbackApplied' }>): void {
  if (typeof m.serverUrl === 'string') {
    input('f-url').value = m.serverUrl;
  }
  if (m.rejectUnauthorized === false) {
    input('f-ssl').checked = false;
  }
  syncUrlPreview();
  const notice = m.note === 'tls' ? L.fallbackTls : (m.note === 'http' ? L.fallbackHttp : L.fallbackHttps);
  // A TLS fallback silently switched certificate verification off — that is a
  // security downgrade, so it must read as a warning, not as neutral info.
  setStatus(fallbackSeverity(m.note), notice);
  testedOk = true;
  // The corrected fields are what the successful probe used.
  testFp = instanceFingerprint();
  refreshButtons();
}

window.addEventListener('message', (ev: MessageEvent<HostToWebview>) => {
  const msg = ev.data;
  if (msg.type === 'init') {
    // Fresh form values (add) or a freshly loaded profile (edit) — neither has
    // been tested yet in this session.
    testedOk = false;
    testFp = undefined;
    applyInit(msg.mode, msg.data, msg.kind);
  } else if (msg.type === 'testResult') {
    // Set BEFORE setBusy(false): setBusy re-runs refreshButtons(), which reads
    // testedOk to gate Save.
    // A success counts only for the values it tested: a detection answer may
    // have changed them while the probe ran.
    const current = instanceFingerprint() === testFp;
    if (msg.ok && current) { testedOk = true; }
    fallbackExpected = msg.ok && current && msg.fallbackFollows === true;
    setBusy(false);
    if (msg.ok) {
      setStatus('ok', msg.version
        ? fmt(L, 'connOkVersion', msg.version)
        : L.connOk);
    } else {
      setStatus('err', msg.message ?? L.connFailed);
    }
    // A pending Save continues only on success: re-tests changed values, and
    // waits for a fallback the host announced (`fallbackApplied` then saves).
    if (!msg.ok) { saveAfterTest = false; } else if (!current) { if (saveAfterTest) { onTest(); } } else if (!msg.fallbackFollows) { continueSave(); }
  } else if (msg.type === 'saveResult') {
    setBusy(false);
    if (msg.cancelled) {
      // Insecure-transport modal declined on the host side — nothing was
      // persisted. Not an error, but not neutral either: keep it a warning so
      // the reason stays visible next to the still-unsafe field values.
      setStatus('warn', msg.message ?? L.saveCancelled);
    } else if (msg.ok && !msg.warning) {
      setStatus('ok', msg.message ?? L.saved);
    } else if (msg.warning) {
      setStatus('err', msg.warning);
    } else {
      setStatus('err', msg.message ?? L.saveFailed);
    }
  } else if (msg.type === 'saasListsResult') {
    setBusy(false);
    if (msg.ok) {
      const tenants = msg.tenants ?? [];
      const databases = msg.databases ?? [];
      fillDatalist('dl-tenant', tenants.map(t => ({ value: t.id, label: t.name })));
      fillDatalist('dl-database', databases.map(d => ({ value: d })));
      // A single choice is the answer — fill it, but never overwrite a typed value.
      if (tenants.length === 1 && !input('f-instance').value.trim()) { input('f-instance').value = tenants[0].id; }
      if (databases.length === 1 && !input('f-database').value.trim()) { input('f-database').value = databases[0]; }
      syncForm();
      setStatus('ok', fmt(L, 'saasListsLoaded', String(tenants.length), String(databases.length)));
    } else {
      setStatus('err', msg.message ?? L.saveFailed);
    }
  } else if (msg.type === 'mgmtResult') {
    setBusy(false);
    if (msg.ok) {
      renderMgmt(msg.databases ?? []);
      input('f-mgmt-new').value = '';
      setStatus('ok', fmt(L, 'mgmtLoaded', String((msg.databases ?? []).length)));
    } else {
      setStatus('err', msg.message ?? L.saveFailed);
    }
  } else if (msg.type === 'fallbackApplied') {
    // Arrives after `testResult` (host posts fallbackApplied once it has
    // rewritten the connection that a successful Test used) — its
    // `testedOk = true` is deliberately the final word.
    // Busy = a newer probe already runs and brings its own fallback. Not
    // expected = its test was stale: the fields changed while it ran, and
    // applying it would write the old URL back and turn Save green untested
    // (review 2026-11-02).
    if (busy || !fallbackExpected) { return; }
    fallbackExpected = false;
    applyFallback(msg);
    continueSave();
  } else if (msg.type === 'detectResult') {
    // A later blur or a new URL superseded this answer.
    if (msg.requestId === detectRequestId) { applyDetect(msg); }
  } else if (msg.type === 'adminProbeResult') {
    const active = activeAdminProbe;
    if (!active
      || msg.requestId !== active.requestId
      || active.fp !== adminProbeFingerprint()) { return; }
    activeAdminProbe = undefined;
    if (msg.tenants) { fillDatalist('dl-paw-tenant', msg.tenants.map(t => ({ value: t.id, label: t.name }))); }
    // The single tenant was used for the test: show it, so Save stores what was tested.
    if (msg.tenant && !input('f-paw-tenant').value.trim()) { input('f-paw-tenant').value = msg.tenant; }
    if (msg.ok) { testedOk = true; }
    if (msg.ok && msg.databases && formMode === 'add') {
      // No syncForm here: it would reset the test gate just set above.
      renderDatabases(msg.databases);
      // One listed (or pre-ticked) database switches Save to the instance
      // route, which this gateway probe has not tested (review 2026-11-02).
      if (!gatewayRoute()) { testedOk = false; }
    }
    setBusy(false);
    if (msg.ok) {
      setStatus('ok', fmt(L, 'probeAdminResult', String(msg.count ?? 0)));
    } else {
      setStatus('err', msg.message ?? L.connFailed);
    }
  } else if (msg.type === 'credListResult') {
    onConnectionFieldChanged();
    credSets = msg.sets;
    // Can arrive BEFORE or AFTER `init` (the host answers `credList` only after
    // a `secrets.get` await) — `renderCredOptions` reads the preselection from
    // `initialCredentialId`, whichever order applied.
    renderCredOptions(initialCredentialId);
  } else if (msg.type === 'credSaveResult') {
    setBusy(false);
    if (msg.ok) {
      closeCredEditPanel();
      initialCredentialId = msg.id ?? credEditingId;
      setStatus('ok', L.saved);
      vscode.postMessage({ type: 'credList' });
    } else {
      // The edit field group stays open so that the name can be corrected.
      setStatus('err', msg.message ?? L.saveFailed);
    }
  } else if (msg.type === 'credDeleteResult') {
    setBusy(false);
    if (msg.ok) {
      initialCredentialId = '';
      setStatus('ok', L.saved);
      vscode.postMessage({ type: 'credList' });
    } else {
      setStatus('err', fmt(L, 'credInUseBy', (msg.inUseBy ?? []).join(', ')));
    }
  }
});

function wire(): void {
  // Display-name only — must NOT reset the test-before-save gate.
  input('f-name').addEventListener('input', refreshButtons);
  ['f-user', 'f-pass', 'f-cam', 'f-spn', 'f-paw-tenant'].forEach(id =>
    input(id).addEventListener('input', onConnectionFieldChanged));
  input('f-url').addEventListener('input', () => {
    // Typing invalidates a running detection: its answer is for the old URL.
    // Forgetting `detectedFor` lets the next blur detect again, even for the same URL.
    detectRequestId += 1;
    detectedFor = '';
    clearDatabases();
    // The browser sign-in choice depends on the URL (PAW instance URL only).
    syncForm();
    syncUrlPreview(); syncNamePlaceholder(); onConnectionFieldChanged();
  });
  input('f-url').addEventListener('blur', () => {
    // For PAW too: `normalizeServerUrl` only adds the scheme, strips trailing
    // slashes and removes embedded credentials — exactly what
    // `normalizePawGatewayUrl` demands anyway. It does not add a path.
    // Without this pass, `localhost:8080` failed the hard scheme check while
    // the neighbouring kinds silently fixed it.
    input('f-url').value = normalizeServerUrl(input('f-url').value);
    // Only switch away from a non-SaaS choice; an API-key profile stays as is.
    if (selectedKind() === 'instance' && isSaasHost(input('f-url').value)
      && !(select('f-version').value === 'v12' && select('f-authmode').value.startsWith('saas'))) {
      input('kind-paw').checked = true;
      applyTile();
      syncForm();
      testedOk = false;
      setStatus('info', L.saasDetected);
    }
    syncUrlPreview();
    refreshButtons();
    startDetect();
  });
  // A choice the user makes while a detection runs beats its answer: only
  // typing in `f-url` used to drop it, so a slow second detection set the
  // sign-in, tile and certificate check back (review 2026-11-02).
  const dropPendingDetect = (): void => { detectRequestId += 1; };
  select('f-auth').addEventListener('change', () => { dropPendingDetect(); syncForm(); testedOk = false; refreshButtons(); });
  input('f-ssl').addEventListener('change', () => { dropPendingDetect(); onConnectionFieldChanged(); });
  input('btn-test').addEventListener('click', onTest);
  input('btn-saas-lists').addEventListener('click', onSaasLists);
  input('btn-save').addEventListener('click', onSave);
  input('btn-delete').addEventListener('click', () => vscode.postMessage({ type: 'delete' }));
  input('btn-cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
  select('f-version').addEventListener('change', () => { dropPendingDetect(); syncForm(); testedOk = false; refreshButtons(); });
  select('f-authmode').addEventListener('change', () => { dropPendingDetect(); syncForm(); testedOk = false; refreshButtons(); });
  ['f-instance', 'f-database', 'f-tm1user'].forEach(id =>
    input(id).addEventListener('input', onConnectionFieldChanged));
  input('btn-mgmt').addEventListener('click', () => {
    const p = $('mgmt-panel');
    p.style.display = p.style.display === 'none' ? '' : 'none';
  });
  input('btn-mgmt-load').addEventListener('click', onMgmtLoad);
  input('btn-kind-change').addEventListener('click', showKindTiles);
  // Paste is the usual way in — recognise without waiting for Tab.
  input('f-url').addEventListener('paste', () => setTimeout(startDetect, 0));
  input('btn-db-load').addEventListener('click', onTest);
  initDbPick(() => ({ addMode: formMode === 'add', adminKind: isAdminKind(), pawKind: selectedKind() === 'paw' }), onConnectionFieldChanged);
  input('btn-mgmt-create').addEventListener('click', onMgmtCreate);
  document.querySelectorAll<HTMLInputElement>('input[name="kind"]').forEach((r) =>
    r.addEventListener('change', () => { dropPendingDetect(); applyTile(); syncForm(); testedOk = false; refreshButtons(); }));
  for (const c of SIGN_IN_CHOICES) {
    input('si-' + c).addEventListener('change', () => {
      dropPendingDetect();
      applySignIn(input('si-' + c).value);
      syncForm(); testedOk = false; refreshButtons();
    });
  }
  select('f-cred').addEventListener('change', syncForm);
  select('f-cred-auth').addEventListener('change', syncCredCamRow);
  input('btn-cred-new').addEventListener('click', onCredNew);
  input('btn-cred-edit').addEventListener('click', onCredEdit);
  input('btn-cred-del').addEventListener('click', onCredDelete);
  input('btn-cred-save').addEventListener('click', onCredSave);
  input('btn-cred-cancel').addEventListener('click', closeCredEditPanel);
  syncForm();
  refreshButtons();
  vscode.postMessage({ type: 'ready' });
  // Own message instead of bundled into `init`: the host answers it only after
  // a `secrets.get` await (`hasPassword` per set), `init` stays
  // available synchronously right away.
  vscode.postMessage({ type: 'credList' });
}

wire();
