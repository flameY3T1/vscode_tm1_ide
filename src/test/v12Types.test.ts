import { describe, it, expect } from 'vitest';
import type { Tm1Config, V12Config } from '../tm1Rest/transport/types';

describe('v12 config types', () => {
  it('accepts a fully-populated v12 config', () => {
    const v12: V12Config = {
      instance: 'tm1',
      database: 'tm1_v12_test',
      authMode: 'basic-s2s',
      tm1User: 'admin',
    };
    const cfg: Tm1Config = {
      serverUrl: 'http://192.0.2.1:4444',
      username: 'CID',
      password: 'secret',
      rejectUnauthorized: false,
      authType: 'v12-basic',
      version: 'v12',
      v12,
    };
    expect(cfg.v12?.database).toBe('tm1_v12_test');
    expect(cfg.version).toBe('v12');
  });

  it('v11 config still valid with no version/v12', () => {
    const cfg: Tm1Config = {
      serverUrl: 'https://localhost:8010',
      username: 'admin', password: '', rejectUnauthorized: true, authType: 'Basic',
    };
    expect(cfg.version).toBeUndefined();
  });
});
