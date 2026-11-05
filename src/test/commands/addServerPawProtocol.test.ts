import { describe, expect, it } from 'vitest';
import { isAdminFormValid, type AdminFormData } from '../../webviewClient/addServer/protocol';

const TM1: AdminFormData = {
  kind: 'tm1',
  name: 'Admin',
  serverUrl: 'http://admin:5895',
  rejectUnauthorized: true,
};

describe('isAdminFormValid', () => {
  it('keeps a TM1 admin server valid without a default login profile', () => {
    expect(isAdminFormValid(TM1)).toBe(true);
  });

  it('keeps a PAW gateway valid without a default login profile', () => {
    // The database list comes anonymously; the profile is only the default
    // for newly discovered instances.
    expect(isAdminFormValid({ ...TM1, kind: 'paw', serverUrl: 'https://paw:9443' })).toBe(true);
  });

  it('stays invalid without a name or URL', () => {
    expect(isAdminFormValid({ ...TM1, kind: 'paw', name: '' })).toBe(false);
    expect(isAdminFormValid({ ...TM1, kind: 'paw', serverUrl: '' })).toBe(false);
  });
});
