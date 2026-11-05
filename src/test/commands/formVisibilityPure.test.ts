// src/test/commands/formVisibilityPure.test.ts
//
// The visibility table of the Add/Edit Server form. It replaces four
// procedures that called each other; the cases here are the ones where
// something used to get stuck when switching.
import { describe, it, expect } from 'vitest';
import {
  computeDbPickVisibility, computeFormVisibility, credPickerApplies, type FormState,
} from '../../webviewClient/addServer/formVisibilityPure';
import { isSaasHost } from '../../utils/serverUrl';

const V11: FormState = {
  adminKind: false, version: 'v11', authMode: 'basic-s2s',
  ownAuthType: 'Basic', credSelected: false, browser: false, pawKind: false,
};

describe('computeFormVisibility', () => {
  it('v11 instance without credential profile: own fields and selection side by side', () => {
    const v = computeFormVisibility(V11);
    expect(v.credSelectGroup).toBe(true);
    expect(v.credentialsGroup).toBe(true);
    expect(v.v12Rows).toBe(false);
    expect(v.tile).toBe('instance');
    expect(v.kindHint).toBe(false);
    expect(v.forceHideMgmtPanel).toBe(true);
  });

  it('a selected credential profile hides the own fields — never both side by side', () => {
    const v = computeFormVisibility({ ...V11, credSelected: true });
    expect(v.credSelectGroup).toBe(true);
    expect(v.credentialsGroup).toBe(false);
    // The namespace sits IN the group: if the group is gone, so is the namespace, even
    // when the own auth type is still set to CAM.
    expect(computeFormVisibility({ ...V11, credSelected: true, ownAuthType: 'CAM' }).camRow).toBe(false);
  });

  it('CAM shows the namespace row only as long as the own fields apply', () => {
    expect(computeFormVisibility({ ...V11, ownAuthType: 'CAM' }).camRow).toBe(true);
    expect(computeFormVisibility({ ...V11, ownAuthType: 'Basic' }).camRow).toBe(false);
    // v12 knows no CAM.
    expect(computeFormVisibility({ ...V11, version: 'v12', ownAuthType: 'CAM' }).camRow).toBe(false);
  });

  it('v12 removes the credential profile selection — the own login path applies there', () => {
    const v = computeFormVisibility({ ...V11, version: 'v12', credSelected: true });
    expect(v.credSelectGroup).toBe(false);
    // And the own fields have to come back: in v12 those are the
    // app client id and its secret, which the user has to enter.
    expect(v.credentialsGroup).toBe(true);
    expect(v.v12Rows).toBe(true);
    expect(v.btnMgmt).toBe(true);
    expect(v.forceHideMgmtPanel).toBe(false);
  });

  it('v12 saas hides the database manager and the tm1User row', () => {
    const v = computeFormVisibility({ ...V11, version: 'v12', authMode: 'saas' });
    expect(v.v12Rows).toBe(true);
    expect(v.btnMgmt).toBe(false);
    expect(v.rowTm1User).toBe(false);
    expect(v.s2sLabels).toBe(false);
    expect(v.saasLabels).toBe(true);
    expect(v.rowUser).toBe(false);
    // The v11 login types are not on offer — they would be ignored on save.
    // Browser login on SaaS lives on the gateway tile; only a profile that has it still sees it here.
    expect(v.signIn).toEqual(['saas']);
    expect(v.signInChecked).toBe('saas');
    expect(computeFormVisibility({ ...V11, version: 'v12', authMode: 'saas', browser: true }).signIn).toEqual(['saas-browser', 'saas']);
    // Opened with it, switched to the API key: the browser choice must stay to switch back.
    expect(computeFormVisibility({ ...V11, version: 'v12', authMode: 'saas', saasBrowserOffered: true }).signIn).toEqual(['saas-browser', 'saas']);
    // Browser login works only through a PAW instance URL (buildTm1Config throws otherwise).
    expect(computeFormVisibility(V11).signIn).toEqual(['basic', 'cam', 'integrated']);
    expect(computeFormVisibility({ ...V11, pawInstanceUrl: true }).signIn).toEqual(['basic', 'cam', 'integrated', 'browser']);
    expect(computeFormVisibility({ ...V11, ownAuthType: 'browser', browser: true }).signIn).toContain('browser');
    expect(computeFormVisibility(V11).rowUser).toBe(true);
  });

  it('v12 auth types toggle their own rows', () => {
    const s2s = computeFormVisibility({ ...V11, version: 'v12', authMode: 'basic-s2s' });
    expect(s2s.rowTm1User).toBe(true);
    expect(s2s.s2sLabels).toBe(true);

    const nativ = computeFormVisibility({ ...V11, version: 'v12', authMode: 'basic-native' });
    expect(nativ.rowTm1User).toBe(false);
    expect(nativ.s2sLabels).toBe(false);
  });

  it('admin server: no own credentials, but the profile selection stays', () => {
    // Finding 5: the buttons were in the group of the own fields and
    // disappeared with it — the default set was selectable, but none could be created.
    const v = computeFormVisibility({ ...V11, adminKind: true });
    expect(v.credentialsGroup).toBe(false);
    expect(v.credSelectGroup).toBe(true);
    expect(v.signIn).toEqual([]);
    expect(v.tile).toBe('admin');
    expect(v.kindHint).toBe(true);
    expect(v.v12Rows).toBe(false);
    expect(v.btnMgmt).toBe(false);
  });

  it('admin server keeps the selection even when v12 remained in the hidden field', () => {
    // The version selection is hidden in the admin server branch, but its value
    // remains — it must not take away the default set selection.
    expect(credPickerApplies({ adminKind: true, version: 'v12', ownAuthType: 'Basic' })).toBe(true);
    expect(computeFormVisibility({ ...V11, adminKind: true, version: 'v12' }).credSelectGroup).toBe(true);
  });

  it('takes the credential profile selection away from integrated login', () => {
    // A selected set would silently reset the kind to Basic
    // (`collect()` takes THAT set's authType when a set is chosen) — the user then
    // saw "User name or password wrong" instead of the integrated login.
    expect(credPickerApplies({ adminKind: false, version: 'v11', ownAuthType: 'integrated' })).toBe(false);
    const v = computeFormVisibility({ ...V11, ownAuthType: 'integrated' });
    expect(v.credSelectGroup).toBe(false);
    expect(v.credentialsGroup).toBe(true);
    expect(v.integratedHint).toBe(true);
    // An admin server stays untouched: there it is the default set.
    expect(credPickerApplies({ adminKind: true, version: 'v11', ownAuthType: 'integrated' })).toBe(true);
  });

  it('browser login through PAW: no user, no password, no login profile, own hint', () => {
    const v = computeFormVisibility({ ...V11, ownAuthType: 'browser', browser: true });
    expect(v.credSelectGroup).toBe(false);
    expect(v.signInChecked).toBe('browser');
    expect(v.rowUser).toBe(false);
    expect(v.rowPass).toBe(false);
    expect(v.browserHint).toBe(true);
    expect(v.integratedHint).toBe(false);
  });

  it('browser login against PA SaaS: tenant labels, no key field, no hint of the v11 kind', () => {
    const v = computeFormVisibility({ ...V11, version: 'v12', authMode: 'saas', browser: true });
    expect(v.saasLabels).toBe(true);
    expect(v.rowUser).toBe(false);
    expect(v.rowPass).toBe(false);
    expect(v.browserHint).toBe(false);
    expect(v.btnMgmt).toBe(false);
    expect(v.saasListsButton).toBe(true);
    // The API key way has no browser session to list with.
    expect(computeFormVisibility({ ...V11, version: 'v12', authMode: 'saas' }).saasListsButton).toBe(false);
  });

  it('"Browser login" as instance default only on a PAW gateway', () => {
    expect(computeFormVisibility({ ...V11, adminKind: true, pawKind: true }).credBrowserOption).toBe(true);
    expect(computeFormVisibility({ ...V11, adminKind: true }).credBrowserOption).toBe(false);
    expect(computeFormVisibility(V11).credBrowserOption).toBe(false);
  });
});

describe('type tile and sign-in choice follow the selects', () => {
  it('maps version and auth mode to one tile and one choice', () => {
    const v12 = { ...V11, version: 'v12' as const };
    expect(computeFormVisibility({ ...v12, authMode: 'saas', browser: true })).toMatchObject({ tile: 'saas', signInChecked: 'saas-browser' });
    expect(computeFormVisibility({ ...v12, authMode: 'basic-native' })).toMatchObject({ tile: 'v12', signIn: ['s2s', 'native'], signInChecked: 'native' });
    expect(computeFormVisibility({ ...V11, ownAuthType: 'CAM' }).signInChecked).toBe('cam');
    expect(computeFormVisibility({ ...V11, adminKind: true, pawKind: true }).tile).toBe('paw');
  });
});

describe('isSaasHost', () => {
  it('recognises the PA SaaS region host, nothing else', () => {
    expect(isSaasHost('https://eu-central-1.planninganalytics.saas.ibm.com')).toBe(true);
    expect(isSaasHost('https://us-east-1.planninganalytics.saas.ibm.com/')).toBe(true);
    expect(isSaasHost('https://planninganalytics.saas.ibm.com.evil.example')).toBe(false);
    expect(isSaasHost('https://tenant.planning-analytics.ibmcloud.com/tm1/api/x')).toBe(false);
    expect(isSaasHost('not a url')).toBe(false);
  });
});

describe('computeDbPickVisibility', () => {
  const base = { adminKind: true, pawKind: false, addMode: true, count: 0 };
  it('shows the list once databases are there, never while editing', () => {
    expect(computeDbPickVisibility({ ...base, count: 2 })).toEqual({ pick: true, list: true, loadRow: false });
    expect(computeDbPickVisibility({ ...base, count: 2, addMode: false }).pick).toBe(false);
  });
  it('keeps an empty gateway area for the load button, hides an empty admin server one', () => {
    expect(computeDbPickVisibility({ ...base, pawKind: true })).toEqual({ pick: true, list: false, loadRow: true });
    expect(computeDbPickVisibility(base).pick).toBe(false);
  });
  it('has no area for a single instance', () => {
    expect(computeDbPickVisibility({ ...base, adminKind: false, count: 3 }).pick).toBe(false);
  });
});
