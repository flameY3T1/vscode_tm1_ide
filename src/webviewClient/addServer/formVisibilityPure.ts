// src/webviewClient/addServer/formVisibilityPure.ts
//
// Which field groups of the add/edit server form are visible — pure, without
// DOM (depcruise `pure-no-vscode`).
//
// The form carries four subjects in one window: instance, admin server, v12
// database management and the login profiles. Visibility used to be spread
// across `syncKind`, `syncVersionRows`, `syncCredPicker` and `syncCamRow`,
// which called each other mutually so that nothing stuck when switching — that
// is exactly where several of the click-test findings sat (selection field
// operable but without effect in the v12 branch; profile buttons hidden along
// with the rest in the admin server branch; filled fields after a branch
// switch). As one table instead of four procedures, the question "what is
// visible in situation X?" can be answered without reading the call tree.
import type { AuthType, V12FormData } from './protocol';

/** The state of the form, as it can be read off the controls. */
export interface FormState {
  adminKind: boolean;
  version: 'v11' | 'v12';
  authMode: V12FormData['authMode'];
  /** Login type of the OWN fields (`f-auth`), not that of a profile. */
  ownAuthType: AuthType;
  /** A named login profile is chosen. */
  credSelected: boolean;
  /** Browser login: v11 `f-auth` = browser (through PAW), v12 auth mode
   *  `saas-browser`. The browser holds the credentials. */
  browser: boolean;
  /** The profile was opened with the SaaS browser login (that choice stays on offer). */
  saasBrowserOffered?: boolean;
  /** The entry is a PAW gateway (an admin kind). */
  pawKind: boolean;
  /** The URL is a PAW instance URL (`<paw>/api/v1/tm1/<instance>`) — the
   *  only v11 address a browser login works on (`buildTm1Config`). */
  pawInstanceUrl?: boolean;
}

export interface FormVisibility {
  /** Selection field for the login profile including New/Edit/Delete. */
  credSelectGroup: boolean;
  /** Die vier EIGENEN Felder (Anmeldeart, Namensraum, Benutzer, Passwort). */
  credentialsGroup: boolean;
  camRow: boolean;
  /** Hint below the login type: fields empty = current Windows login. */
  integratedHint: boolean;
  kindHint: boolean;
  v12Rows: boolean;
  rowTm1User: boolean;
  btnMgmt: boolean;
  /** The database field belongs collapsed — only the button opens it. */
  forceHideMgmtPanel: boolean;
  /** v12/S2S uses the two fields as app client id + secret and therefore
   *  needs different labels. */
  s2sLabels: boolean;
  /** PA as a Service: the user name of an API key is always `apikey`. */
  rowUser: boolean;
  /** Browser login stores no password. */
  rowPass: boolean;
  /** Hint below the login type for the browser login through PAW. */
  browserHint: boolean;
  /** PA as a Service labels: tenant id instead of instance, API key
   *  instead of password. */
  saasLabels: boolean;
  /** Browser login against PA SaaS: log in on the host alone and offer
   *  tenants and databases as suggestions. */
  saasListsButton: boolean;
  /** "Browser login" as default for newly discovered instances — PAW only,
   *  a classic admin server has no browser route. */
  credBrowserOption: boolean;
  /** The type tile that matches the state (version + auth mode). */
  tile: Tile;
  /** Sign-in choices on offer: v11 login types, or the v12 auth modes of
   *  the tile — never both, the other set would be ignored on save. */
  signIn: SignInChoice[];
  /** The choice that matches the hidden selects; undefined = none fits. */
  signInChecked: SignInChoice | undefined;
}

export type Tile = 'instance' | 'saas' | 'v12' | 'admin' | 'paw';
export type SignInChoice = 'basic' | 'cam' | 'integrated' | 'browser' | 'saas-browser' | 'saas' | 's2s' | 'native';

const V11_CHOICE: Partial<Record<AuthType, SignInChoice>> = {
  Basic: 'basic', CAM: 'cam', integrated: 'integrated', browser: 'browser',
};

/**
 * Does the login profile selection apply at all in this situation?
 *
 * An admin server keeps the default set for newly discovered instances there,
 * a v11 instance its own credentials. **v12 does not**: it has its own login
 * route (token mint) and is explicitly not part of the design — `collect()`
 * does not return a `credentialId` at all in the v12 branch.
 */
export function credPickerApplies(s: Pick<FormState, 'adminKind' | 'version' | 'ownAuthType'>): boolean {
  if (s.adminKind) { return true; }
  // Same reason as integrated: a set would bring its own login type.
  if (s.ownAuthType === 'browser') { return false; }
  // Integrated login carries no credentials at all — a chosen set would
  // silently reset the type to Basic (`collect()` takes THAT set's `authType`
  // when a set is chosen), and the user only sees a 401.
  if (s.ownAuthType === 'integrated') { return false; }
  return s.version !== 'v12';
}

export function computeFormVisibility(s: FormState): FormVisibility {
  const picker = credPickerApplies(s);
  // Either a named profile OR own fields — never both side by side.
  // An admin server has no own ones at all.
  const ownFields = !s.adminKind && !(picker && s.credSelected);
  const v12Rows = !s.adminKind && s.version === 'v12';
  const s2s = v12Rows && s.authMode === 'basic-s2s';
  return {
    credSelectGroup: picker,
    credentialsGroup: ownFields,
    // The namespace sits IN the group of the own fields: if that is gone,
    // so is it. There is no CAM in v12.
    camRow: ownFields && !v12Rows && s.ownAuthType === 'CAM',
    // Integrated login applies to v11 only — v12 mints its session via
    // the auth endpoint, where there is no SPNEGO.
    integratedHint: ownFields && !v12Rows && s.ownAuthType === 'integrated',
    kindHint: s.adminKind,
    v12Rows,
    rowTm1User: s2s,
    // The database manager talks to /manage/v1 — PA as a Service has none.
    btnMgmt: v12Rows && s.authMode !== 'saas',
    forceHideMgmtPanel: !v12Rows,
    s2sLabels: s2s,
    rowUser: !(v12Rows && s.authMode === 'saas') && !s.browser,
    rowPass: !s.browser,
    browserHint: ownFields && !v12Rows && s.browser,
    saasLabels: v12Rows && s.authMode === 'saas',
    saasListsButton: v12Rows && s.authMode === 'saas' && s.browser,
    credBrowserOption: s.adminKind && s.pawKind,
    tile: s.adminKind ? (s.pawKind ? 'paw' : 'admin')
      : s.version !== 'v12' ? 'instance' : s.authMode === 'saas' ? 'saas' : 'v12',
    signIn: s.adminKind ? []
      // Browser only on a PAW instance URL: on any other v11 address the save
      // fails anyway. Kept while chosen, so the choice is never hidden.
      : s.version !== 'v12' ? (s.pawInstanceUrl || s.ownAuthType === 'browser'
        ? ['basic', 'cam', 'integrated', 'browser'] : ['basic', 'cam', 'integrated'])
      // Browser login on SaaS moved to the gateway tile; offered here only
      // to a profile that already has it.
      : s.authMode === 'saas' ? (s.browser || s.saasBrowserOffered ? ['saas-browser', 'saas'] : ['saas']) : ['s2s', 'native'],
    signInChecked: s.adminKind ? undefined
      : s.version !== 'v12' ? V11_CHOICE[s.ownAuthType]
      : s.authMode === 'saas' ? (s.browser ? 'saas-browser' : 'saas')
      : s.authMode === 'basic-s2s' ? 's2s' : s.authMode === 'basic-native' ? 'native' : undefined,
  };
}

/** The database tick list of a new admin server / gateway entry. */
export interface DbPickVisibility {
  /** The whole area. */
  pick: boolean;
  /** List plus its All/None links. */
  list: boolean;
  /** "Load databases" — stands where the list will be while it is empty. */
  loadRow: boolean;
}

/**
 * A gateway gets the area even while empty: its load button is the way in
 * when the list needs a login (PA SaaS, or PAW Local without anonymous
 * access). An admin server lists anonymously or not at all. Editing keeps
 * the tree's hide/restore commands as the one place for the selection.
 */
export function computeDbPickVisibility(
  s: Pick<FormState, 'adminKind' | 'pawKind'> & { addMode: boolean; count: number },
): DbPickVisibility {
  return {
    pick: s.addMode && s.adminKind && (s.count > 0 || s.pawKind),
    list: s.count > 0,
    loadRow: s.count === 0,
  };
}
