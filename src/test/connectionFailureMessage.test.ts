import { describe, it, expect, vi } from 'vitest';

// connection.ts pulls tm1Client + session at module load (for connect()); mock
// them so importing the pure _connectFailureMessage helper has no side effects.
vi.mock('../tm1Client', () => ({
  apiRequest: vi.fn(),
  setConfigOverride: vi.fn(),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../tm1Rest/transport/session', () => ({
  _clearAuthFailed: vi.fn(),
}));

import { _connectFailureMessage, isTlsCertError } from '../commands/serverManager/connection';
import { _connectErrorMessage } from '../commands/serverManager/probeConnection';

// The vscode mock's l10n.t returns the (English) source string with {0}/{1}
// substituted, so a correctly-localized wrapper shows the English source here —
// and, crucially, NEVER the previously-hardcoded German text.
describe('_connectFailureMessage', () => {
  it('classifies ECONNREFUSED (via preserved code) as offline and localizes the wrapper', () => {
    const err = Object.assign(
      new Error('Server unreachable — connection to "192.0.2.10:12331" refused. Is the TM1 REST API running and is the port correct?'),
      { code: 'ECONNREFUSED' },
    );
    const out = _connectFailureMessage(err, 'tester');
    expect(out).toBe('TM1: Server "tester" offline — Server unreachable — connection to "192.0.2.10:12331" refused. Is the TM1 REST API running and is the port correct?');
    // Regression: the wrapper must go through l10n, not the old hardcoded German.
    expect(out).not.toContain('Verbindung zu');
    expect(out).not.toContain('fehlgeschlagen');
  });

  it('classifies ENOTFOUND / ETIMEDOUT / ECONNRESET / EAI_AGAIN as offline', () => {
    for (const code of ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']) {
      const out = _connectFailureMessage(Object.assign(new Error('x'), { code }), 'srv');
      expect(out).toBe('TM1: Server "srv" offline — x');
    }
  });

  it('classifies a timeout by message even without a code', () => {
    const err = new Error('Server unreachable — timeout connecting to "192.0.2.10". Check network/firewall.');
    const out = _connectFailureMessage(err, 'srv');
    expect(out.startsWith('TM1: Server "srv" offline — ')).toBe(true);
  });

  it('falls back to the generic (localized) connection-failed wrapper for non-offline errors', () => {
    const err = new Error('Login failed (HTTP 401) — username or password is incorrect.');
    const out = _connectFailureMessage(err, 'tester');
    expect(out).toBe('TM1: Connection to "tester" failed — Login failed (HTTP 401) — username or password is incorrect.');
    expect(out).not.toContain('Verbindung zu');
  });

  it('never emits hardcoded German for a code-less connection refusal (no code → generic wrapper)', () => {
    // If connect() ever fails to preserve the code, classification falls back to
    // the generic wrapper — still fully localized, never hardcoded German.
    const err = new Error('Server unreachable — connection refused.');
    const out = _connectFailureMessage(err, 'x');
    expect(out).toBe('TM1: Connection to "x" failed — Server unreachable — connection refused.');
  });
});

describe('isTlsCertError', () => {
  it('recognizes the self-signed case from the raw error', () => {
    expect(isTlsCertError(new Error('self signed certificate'))).toBe(true);
    expect(isTlsCertError(Object.assign(new Error('x'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }))).toBe(true);
  });

  it('recognizes it after humanizing too, via the carried marker', () => {
    // `connect()` does not rethrow the raw error, but a humanized
    // version. Its text is translated — so the detection must not
    // rely on English words.
    const humanized = Object.assign(new Error('TLS-Zertifikatsfehler für „h" — …'), { tlsCert: true });
    expect(isTlsCertError(humanized)).toBe(true);
  });

  it('keeps ordinary errors out', () => {
    expect(isTlsCertError(new Error('Login failed (HTTP 401)'))).toBe(false);
    expect(isTlsCertError(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))).toBe(false);
    expect(isTlsCertError(undefined)).toBe(false);
  });
});

describe('_connectErrorMessage: plain-text port instead of HTTPS', () => {
  const cfg = { serverUrl: 'https://tm1.example:5895' } as never;
  const BORINGSSL = Object.assign(
    new Error('write EPROTO 416896:error:100000f7:SSL routines:OPENSSL_internal:'
      + 'WRONG_VERSION_NUMBER:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:127:'),
    { code: 'EPROTO' },
  );

  it('says what is going on instead of passing the BoringSSL line through', () => {
    const out = _connectErrorMessage(BORINGSSL, cfg);
    expect(out).toContain('tm1.example:5895');
    expect(out).toContain('http://');
    // Nothing of the raw text: "WRONG_VERSION_NUMBER" reads like a
    // TLS version problem and is the opposite, and a file path from
    // BoringSSL certainly does not belong in a user message.
    expect(out).not.toContain('WRONG_VERSION_NUMBER');
    expect(out).not.toContain('tls_record.cc');
    expect(out).not.toContain('EPROTO');
  });

  it('does NOT advise turning off certificate verification', () => {
    // The raw text contains "SSL routines" — if the certificate branch catches the
    // case, the user gets the advice to turn off verification. That
    // does not help here: there is no TLS involved at all.
    expect(_connectErrorMessage(BORINGSSL, cfg)).not.toContain('Verify SSL certificate');
  });
});

describe('_connectErrorMessage: certificate case', () => {
  const cfg = { serverUrl: 'https://localhost:12357' } as never;

  it('names the control that really exists, and the right direction', () => {
    const out = _connectErrorMessage(new Error('self signed certificate'), cfg);
    // In the form the switch is called "Verify SSL certificate" / "SSL-Zertifikat
    // pruefen" and must be switched OFF. The old version advised
    // ACTIVATING an "Accept certificate" — neither existed like that.
    expect(out).toContain('Verify SSL certificate');
    expect(out).not.toContain('Accept certificate');
    expect(out).toContain('localhost:12357');
    expect(out).toContain('self signed certificate');
  });
});
