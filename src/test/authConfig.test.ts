import { describe, it, expect } from 'vitest';
import { buildTm1Config, type AuthFields } from '../tm1Rest/transport/authConfig';

const base = { serverUrl: 'https://tm1:8010', username: 'admin', password: 'pw', rejectUnauthorized: true };

describe('buildTm1Config', () => {
  it('Basic: builds a plain Basic config', () => {
    const cfg = buildTm1Config(base, { authType: 'Basic' });
    expect(cfg).toMatchObject({ ...base, authType: 'Basic' });
    expect(cfg.camNamespace).toBeUndefined();
    expect(cfg.version).toBeUndefined();
    expect(cfg.v12).toBeUndefined();
  });

  it('CAM: keeps the namespace', () => {
    const cfg = buildTm1Config(base, { authType: 'CAM', camNamespace: 'LDAP' });
    expect(cfg).toMatchObject({ authType: 'CAM', camNamespace: 'LDAP' });
  });

  it('CAM: throws without a namespace (was: opaque 401)', () => {
    expect(() => buildTm1Config(base, { authType: 'CAM' } as AuthFields)).toThrow(/namespace/i);
    expect(() => buildTm1Config(base, { authType: 'CAM', camNamespace: '' })).toThrow(/namespace/i);
  });

  it('v12-basic: folds version + v12 config', () => {
    const v12 = { instance: 'tm1', database: 'db', authMode: 'basic-s2s' as const, tm1User: 'admin' };
    const cfg = buildTm1Config(base, { authType: 'v12-basic', version: 'v12', v12 });
    expect(cfg).toMatchObject({ authType: 'v12-basic', version: 'v12', v12 });
  });

  it('v12-basic: throws without a v12 config', () => {
    expect(() => buildTm1Config(base, { authType: 'v12-basic', version: 'v12' })).toThrow(/v12/i);
    expect(() => buildTm1Config(base, { authType: 'v12-basic' })).toThrow(/v12/i);
  });

  it('browser on PAW: needs a <paw>/api/v1/tm1/<instance> URL', () => {
    const paw = { ...base, serverUrl: 'http://localhost:8080/api/v1/tm1/Planning' };
    const cfg = buildTm1Config(paw, { authType: 'browser' });
    expect(cfg).toMatchObject({ authType: 'browser' });
    expect(cfg.version).toBeUndefined();
    expect(() => buildTm1Config(base, { authType: 'browser' })).toThrow(/PAW/);
  });

  it('browser on v12: only PA SaaS with tenant and database', () => {
    const v12 = { instance: 'TENANT', database: 'db', authMode: 'saas' as const, tm1User: '' };
    expect(buildTm1Config(base, { authType: 'browser', version: 'v12', v12 }))
      .toMatchObject({ authType: 'browser', version: 'v12', v12 });
    expect(() => buildTm1Config(base, { authType: 'browser', version: 'v12', v12: { ...v12, authMode: 'basic-s2s' } })).toThrow(/SaaS/);
    expect(() => buildTm1Config(base, { authType: 'browser', version: 'v12', v12: { ...v12, database: '' } })).toThrow(/SaaS/);
    expect(() => buildTm1Config(base, { authType: 'browser', version: 'v12' })).toThrow(/SaaS/);
    expect(() => buildTm1Config(base, { authType: 'browser', v12 })).toThrow(/SaaS/);
  });
});
