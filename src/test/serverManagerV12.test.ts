import { describe, it, expect } from 'vitest';
import { cfgFromForm, type ServerFormData } from '../commands/serverManager';

const form: ServerFormData = {
  name: 'v12 local', serverUrl: 'http://gw:4444', username: 'CID', password: 'SEC',
  authType: 'v12-basic', rejectUnauthorized: false,
  version: 'v12',
  v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'admin' },
};

describe('cfgFromForm v12', () => {
  it('maps version + v12 object onto Tm1Config', () => {
    const cfg = cfgFromForm(form);
    expect(cfg.version).toBe('v12');
    expect(cfg.v12?.database).toBe('db');
    expect(cfg.v12?.authMode).toBe('basic-s2s');
    expect(cfg.password).toBe('SEC');
  });

  it('v11 form leaves version/v12 undefined', () => {
    const v11: ServerFormData = {
      name: 'x', serverUrl: 'https://h:8010', username: 'admin', password: 'pw',
      authType: 'Basic', rejectUnauthorized: true,
    };
    const cfg = cfgFromForm(v11);
    expect(cfg.version).toBeUndefined();
    expect(cfg.v12).toBeUndefined();
  });

});
