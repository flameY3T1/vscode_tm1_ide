import { describe, it, expect } from 'vitest';
import { buildBaseUrl, buildV12SessionUrl } from '../tm1Rest/transport/urlBuilder';
import type { Tm1Config } from '../tm1Rest/transport/types';

const v11: Tm1Config = { serverUrl: 'https://host:8010/', username: 'a', password: '', rejectUnauthorized: true, authType: 'Basic' };
const v12 = (db = 'tm1_v12_test'): Tm1Config => ({
  serverUrl: 'http://192.0.2.1:4444', username: 'CID', password: 's', rejectUnauthorized: false,
  authType: 'v12-basic', version: 'v12', v12: { instance: 'tm1', database: db, authMode: 'basic-s2s', tm1User: 'admin' },
});

describe('buildBaseUrl', () => {
  it('v11 → /api/v1 with trailing slash normalized', () => {
    expect(buildBaseUrl(v11)).toBe('https://host:8010/api/v1');
  });
  it('v12 → instance + Databases prefix', () => {
    expect(buildBaseUrl(v12())).toBe("http://192.0.2.1:4444/tm1/api/v1/Databases('tm1_v12_test')");
  });
  it("v12 escapes single quotes in database name (' → '')", () => {
    expect(buildBaseUrl(v12("a'b"))).toBe("http://192.0.2.1:4444/tm1/api/v1/Databases('a''b')");
  });
  it('v12 URL-encodes # in database name (no path truncation)', () => {
    expect(buildBaseUrl(v12('my#db'))).toBe("http://192.0.2.1:4444/tm1/api/v1/Databases('my%23db')");
  });
  it('v12 URL-encodes / in database name', () => {
    expect(buildBaseUrl(v12('a/b'))).toBe("http://192.0.2.1:4444/tm1/api/v1/Databases('a%2Fb')");
  });
  it('v12 URL-encodes the instance segment', () => {
    const cfg = v12();
    cfg.v12!.instance = 'in st#x';
    expect(buildBaseUrl(cfg)).toBe("http://192.0.2.1:4444/in%20st%23x/api/v1/Databases('tm1_v12_test')");
  });
  it('v12 saas → tenant + database path, then the flat /api/v1', () => {
    const cfg: Tm1Config = {
      serverUrl: 'https://eu-central-1.planninganalytics.saas.ibm.com/', username: 'apikey', password: 'k',
      rejectUnauthorized: true, authType: 'v12-basic', version: 'v12',
      v12: { instance: 'TENANT1', database: 'Business Flow', authMode: 'saas', tm1User: '' },
    };
    expect(buildBaseUrl(cfg)).toBe('https://eu-central-1.planninganalytics.saas.ibm.com/api/TENANT1/v0/tm1/Business%20Flow/api/v1');
  });
  it('version v12 but no v12 object falls back to v11 prefix', () => {
    // Deliberately invalid combo (version v12 without v12 block) — cast past the union.
    const bad = { ...v11, version: 'v12' } as unknown as Tm1Config;
    expect(buildBaseUrl(bad)).toBe('https://host:8010/api/v1');
  });
});

describe('buildV12SessionUrl', () => {
  it('points at the auth endpoint under the instance', () => {
    expect(buildV12SessionUrl(v12())).toBe('http://192.0.2.1:4444/tm1/auth/v1/session');
  });
});
