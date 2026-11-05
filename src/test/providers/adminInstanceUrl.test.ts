import { describe, it, expect } from 'vitest';
import { instanceUrlCandidates, resolveInstanceUrl } from '../../providers/adminDiscoveryPure';
import type { AdminInstance } from '../../tm1Rest/adminServerApi';

function inst(p: Partial<AdminInstance> = {}): AdminInstance {
  return {
    name: 'SALES', host: 'https://TM1HOST:12357', acceptingClients: true,
    usingSSL: true, ipAddress: '10.1.2.3', ipv6Address: '', httpPortNumber: 12357, ...p,
  };
}

describe('resolveInstanceUrl', () => {
  it('uses the admin server host with the instance HTTP port — the address we know is reachable', () => {
    // The reported `Host` carries the machine name of the TM1 machine, as its
    // operating system reports it. In a corporate network it is often not
    // resolvable from the client; the admin server address, on the other hand,
    // was entered by the user and has just delivered the instance list.
    expect(resolveInstanceUrl('http://tm1srv.corp:5895', inst())).toBe('https://tm1srv.corp:12357');
  });

  it('takes the scheme from UsingSSL, not from the admin server URL', () => {
    expect(resolveInstanceUrl('http://a:5895', inst({ usingSSL: false }))).toBe('http://a:12357');
    expect(resolveInstanceUrl('https://a:5898', inst({ usingSSL: true }))).toBe('https://a:12357');
  });

  it('falls back to the reported IP address when the admin URL carries no host', () => {
    expect(resolveInstanceUrl('nonsense', inst())).toBe('https://10.1.2.3:12357');
  });

  it('ignores a bind-all IP — 0.0.0.0 is not an address anyone can connect to', () => {
    expect(resolveInstanceUrl('nonsense', inst({ ipAddress: '0.0.0.0' }))).toBe('https://TM1HOST:12357');
  });

  it('brackets an IPv6 fallback', () => {
    expect(resolveInstanceUrl('nonsense', inst({ ipAddress: '', ipv6Address: 'fe80::1' })))
      .toBe('https://[fe80::1]:12357');
  });

  it('keeps an IPv6 admin host bracketed', () => {
    expect(resolveInstanceUrl('http://[fe80::2]:5895', inst())).toBe('https://[fe80::2]:12357');
  });

  it('keeps the reported Host verbatim when no HTTP port was reported', () => {
    expect(resolveInstanceUrl('http://a:5895', inst({ httpPortNumber: 0 }))).toBe('https://TM1HOST:12357');
  });

  it('drops a path on the admin URL — only the host survives', () => {
    expect(resolveInstanceUrl('http://a:5895/api/v1/Servers', inst())).toBe('https://a:12357');
  });

  // An instance registered with admin servers on several machines.
  it('candidates: admin pick first, then own host, then reported IPs, no duplicates', () => {
    expect(instanceUrlCandidates('http://a:5895', inst())).toEqual([
      'https://a:12357', 'https://tm1host:12357', 'https://10.1.2.3:12357',
    ]);
    expect(instanceUrlCandidates('nonsense', inst())).toEqual(['https://10.1.2.3:12357', 'https://tm1host:12357']);
    expect(instanceUrlCandidates('http://a:5895', inst({ ipAddress: '0.0.0.0', httpPortNumber: 0 }))).toEqual(['https://TM1HOST:12357']);
  });
});
