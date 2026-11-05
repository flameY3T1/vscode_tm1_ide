import { describe, it, expect } from 'vitest';
import { resolveCredentials } from '../../commands/serverManager/credentialResolvePure';
import type { CredentialSet } from '../../serverState/state';

const prof = (over = {}) => ({
  username: 'eigen', authType: 'Basic' as const, camNamespace: undefined, credentialId: undefined, ...over,
});
const cam: CredentialSet = {
  id: 'cred:1', name: 'PROD Max', username: 'max', authType: 'CAM', camNamespace: 'LDAP',
};

describe('resolveCredentials', () => {
  it('without a reference takes the profile fields — current behavior', () => {
    expect(resolveCredentials(prof(), undefined, 'pw', '')).toEqual({
      ok: true, username: 'eigen', password: 'pw', authType: 'Basic', camNamespace: undefined,
    });
  });

  it('with a reference takes EVERYTHING from the set, including auth type and namespace', () => {
    // Half from the set, half from the profile would yield a CAM login with a
    // foreign namespace — visible only as a login error.
    const r = resolveCredentials(prof({ credentialId: 'cred:1' }), cam, 'pw-alt', 'pw-satz');
    expect(r).toEqual({
      ok: true, username: 'max', password: 'pw-satz', authType: 'CAM', camNamespace: 'LDAP',
    });
  });

  it('does NOT fall back to the profile fields when the set is missing', () => {
    // The profile fields then carry stale values; a silent fallback
    // would report "password wrong" instead of the real cause.
    expect(resolveCredentials(prof({ credentialId: 'weg' }), undefined, 'pw', '')).toEqual({
      ok: false, missingCredentialId: 'weg',
    });
  });

  it('passes an empty set password through instead of taking its own', () => {
    // SecretStorage is bound to the extension ID: after a move the set is there,
    // the secret is not. An ordinary 401 is expected.
    const r = resolveCredentials(prof({ credentialId: 'cred:1' }), cam, 'pw-alt', '');
    expect(r).toMatchObject({ ok: true, password: '' });
  });
});
