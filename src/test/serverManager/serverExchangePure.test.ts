import { describe, it, expect } from 'vitest';
import { toExportFile, mergeImport, IMPORTABLE_AUTH_TYPES } from '../../commands/serverManager/serverExchangePure';
import { needsInitialCredentials } from '../../commands/serverManager/connection';
import type { ServerProfile } from '../../serverState/state';

const base = { rejectUnauthorized: true, authType: 'Basic' as const };
const hand: ServerProfile = { ...base, id: 'a', name: 'Dev', serverUrl: 'https://dev:1/', username: 'me', credentialId: 'c1', folder: 'Team', git: { enabled: true, repoPath: 'x', parallelFetch: 8 } };
const childUnused: ServerProfile = { ...base, id: 'b', name: 'Found', serverUrl: 'https://h:2', username: '', parentAdminId: 'adm', discoveredName: 'Found' };
const childUsed: ServerProfile = { ...base, id: 'c', name: 'Used', serverUrl: 'https://h:3', username: 'me', parentAdminId: 'adm' };
const childConnected: ServerProfile = { ...base, id: 'd', name: 'Live', serverUrl: 'https://h:4', username: '', parentAdminId: 'adm', credentialId: 'def' };

describe('server list export', () => {
  const file = toExportFile([hand, childUnused, childUsed, childConnected], id => id === 'd');

  it('skips admin-server children that were never used', () => {
    expect(file.servers.map(s => s.name)).toEqual(['Dev', 'Used', 'Live']);
  });

  it('carries no personal or local fields', () => {
    const text = JSON.stringify(file);
    for (const field of ['username', 'credentialId', 'git', 'parentAdminId', 'discoveredName', '"id"']) {
      expect(text, field).not.toContain(field);
    }
    expect(file.servers[0].folder).toBe('Team');
  });

  it('blanks the v12 login user', () => {
    const v12: ServerProfile = { ...hand, v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'me' } };
    expect(toExportFile([v12], () => false).servers[0].v12?.tm1User).toBe('');
  });
});

describe('server list import', () => {
  let n = 0;
  const newId = () => `new${n++}`;

  it('adds new servers, skips known URLs regardless of trailing slash and case', () => {
    const raw = { format: 'tm1-servers/1', servers: [
      { name: 'Dev again', serverUrl: 'HTTPS://DEV:1', authType: 'Basic', rejectUnauthorized: true },
      { name: 'Prod', serverUrl: 'https://prod:1', authType: 'CAM', camNamespace: 'LDAP', rejectUnauthorized: false, folder: 'Team' },
    ] };
    const r = mergeImport([hand], raw, newId);
    expect(r).toMatchObject({ added: 1, skipped: 1 });
    const prod = r.servers[1];
    expect(prod).toMatchObject({ name: 'Prod', username: '', camNamespace: 'LDAP', rejectUnauthorized: false, folder: 'Team', imported: true });
    expect(needsInitialCredentials(prod, '')).toBe(true);
  });

  it('keeps two v12 databases behind the same gateway URL apart', () => {
    const v12 = (database: string) => ({ name: database, serverUrl: 'https://gw', authType: 'Basic', rejectUnauthorized: true, version: 'v12', v12: { instance: 'tm1', database, authMode: 'basic-s2s', tm1User: '' } });
    const r = mergeImport([], { format: 'tm1-servers/1', servers: [v12('a'), v12('b'), v12('a')] }, newId);
    expect(r).toMatchObject({ added: 2, skipped: 1 });
  });

  it('imports two profiles of the file that share a URL under different names', () => {
    const p = (name: string) => ({ name, serverUrl: 'https://shared:1', authType: 'Basic', rejectUnauthorized: true });
    const r = mergeImport([], { format: 'tm1-servers/1', servers: [p('Admin'), p('Reader'), p('Admin')] }, newId);
    expect(r).toMatchObject({ added: 2, skipped: 1 });
  });

  it('rejects entries with wrongly typed or unsupported fields', () => {
    const ok = { name: 'Ok', serverUrl: 'https://ok:1', authType: IMPORTABLE_AUTH_TYPES[0], rejectUnauthorized: true };
    const r = mergeImport([], { format: 'tm1-servers/1', servers: [
      { ...ok, name: 'Num folder', serverUrl: 'https://a:1', folder: 5 },
      { ...ok, name: 'Oidc', serverUrl: 'https://b:1', authType: 'v12-oidc' },
      { ...ok, name: 'Bad version', serverUrl: 'https://c:1', version: 'v13' },
      { ...ok, name: 'Bad v12', serverUrl: 'https://d:1', version: 'v12', v12: { instance: 1, database: 'db', authMode: 'basic-s2s' } },
      { ...ok, name: 'Num ns', serverUrl: 'https://e:1', camNamespace: 7 },
      { ...ok, version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: 'x', extra: 1 } },
    ] }, newId);
    expect(r).toMatchObject({ added: 1, skipped: 0, invalid: 5 });
    expect(r.servers.map(s => s.name)).toEqual(['Ok']);
    expect(r.servers.some(s => typeof s.folder !== 'undefined' && typeof s.folder !== 'string')).toBe(false);
    expect(r.servers[0].v12).toEqual({ instance: 'tm1', database: 'db', authMode: 'basic-s2s', tm1User: '' });
  });

  it('rejects a file that is not a server export', () => {
    expect(() => mergeImport([], { servers: [] }, newId)).toThrow();
    expect(() => mergeImport([], [hand], newId)).toThrow();
  });
});
