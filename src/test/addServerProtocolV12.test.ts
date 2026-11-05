import { describe, it, expect } from 'vitest';
import type { ServerFormData } from '../webviewClient/addServer/protocol';
import { isServerFormValid, fallbackSeverity } from '../webviewClient/addServer/protocol';

describe('addServer protocol v12', () => {
  it('ServerFormData carries version + v12', () => {
    const d: ServerFormData = {
      name: 'x', serverUrl: 'http://gw:4444', username: 'CID', password: 's',
      authType: 'v12-basic', rejectUnauthorized: false, version: 'v12',
      v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' },
    };
    expect(d.v12?.instance).toBe('tm1');
  });
});

describe('isServerFormValid', () => {
  const base: ServerFormData = {
    name: 'srv', serverUrl: 'http://gw:4444', username: 'u', password: 'p',
    authType: 'Basic', rejectUnauthorized: false,
  };

  it('accepts a complete v11 Basic form', () => {
    expect(isServerFormValid(base)).toBe(true);
  });

  it('rejects missing name / url', () => {
    expect(isServerFormValid({ ...base, name: '' })).toBe(false);
    expect(isServerFormValid({ ...base, serverUrl: '' })).toBe(false);
  });

  it('CAM requires camNamespace', () => {
    expect(isServerFormValid({ ...base, authType: 'CAM' })).toBe(false);
    expect(isServerFormValid({ ...base, authType: 'CAM', camNamespace: 'ns' })).toBe(true);
  });

  it('v12 basic-s2s requires user + password + tm1User', () => {
    const v12: ServerFormData = {
      ...base, authType: 'v12-basic', version: 'v12',
      v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' },
    };
    expect(isServerFormValid(v12)).toBe(true);
    expect(isServerFormValid({ ...v12, password: '' })).toBe(false);
    expect(isServerFormValid({ ...v12, password: '' }, true)).toBe(true);
    expect(isServerFormValid({ ...v12, v12: { ...v12.v12!, tm1User: '' } })).toBe(false);
    expect(isServerFormValid({ ...v12, v12: { ...v12.v12!, database: '' } })).toBe(false);
  });

  it('v12 basic-native requires only username', () => {
    const v12: ServerFormData = {
      ...base, authType: 'v12-basic', version: 'v12', password: '',
      v12: { instance: 'tm1', database: 'db', authMode: 'basic-native', tm1User: '' },
    };
    expect(isServerFormValid(v12)).toBe(true);
    expect(isServerFormValid({ ...v12, username: '' })).toBe(false);
  });

  it('v12 saas requires tenant id (instance) + API key, no tm1User', () => {
    const saas: ServerFormData = {
      ...base, username: 'apikey', password: 'key', authType: 'v12-basic', version: 'v12',
      v12: { instance: 'TENANT1', database: 'db', authMode: 'saas', tm1User: '' },
    };
    expect(isServerFormValid(saas)).toBe(true);
    expect(isServerFormValid({ ...saas, password: '' })).toBe(false);
    // Edit of a stored profile: the key is on the host, the field stays empty.
    expect(isServerFormValid({ ...saas, password: '' }, true)).toBe(true);
    expect(isServerFormValid({ ...saas, v12: { ...saas.v12!, instance: '' } })).toBe(false);
  });

});

describe('fallbackSeverity', () => {
  it('renders a TLS downgrade as a warning, not as neutral info', () => {
    expect(fallbackSeverity('tls')).toBe('warn');
  });

  it('warns on https→http, keeps the upgrade informational', () => {
    expect(fallbackSeverity('http')).toBe('warn');
    expect(fallbackSeverity('https')).toBe('info');
  });
});
