import { describe, it, expect } from 'vitest';
import { describeNetworkError } from '../../utils/networkErrorText';

// The vscode mock returns the English source text from `l10n.t` with the
// placeholders filled in — so the EN wording is what appears here.
const BORINGSSL = Object.assign(
  new Error('write EPROTO 416896:error:100000f7:SSL routines:OPENSSL_internal:'
    + 'WRONG_VERSION_NUMBER:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:127:'),
  { code: 'EPROTO' },
);

describe('describeNetworkError', () => {
  it('interprets the plaintext port and names the way out', () => {
    const out = describeNetworkError(BORINGSSL, 'https://tm1.example:5895');
    expect(out).toContain('tm1.example:5895');
    expect(out).toContain('http://');
    expect(out).not.toContain('WRONG_VERSION_NUMBER');
    expect(out).not.toContain('tls_record.cc');
  });

  it('interprets the remaining common cases', () => {
    const u = 'https://tm1.example:5895';
    expect(describeNetworkError({ code: 'ENOTFOUND' }, u)).toContain('could not be resolved');
    expect(describeNetworkError({ code: 'ECONNREFUSED' }, u)).toContain('refused');
    expect(describeNetworkError({ code: 'ETIMEDOUT' }, u)).toContain('Timeout');
    expect(describeNetworkError({ code: 'CERT_HAS_EXPIRED' }, u)).toContain('Verify SSL certificate');
  });

  it('leaves unknown errors as raw text', () => {
    // A wrong interpretation is worse than none at all: whoever sees the raw text
    // can at least look it up.
    expect(describeNetworkError(new Error('irgendein Serverfehler'), 'https://h:1'))
      .toContain('irgendein Serverfehler');
  });

  it('survives an unparsable URL', () => {
    expect(describeNetworkError({ code: 'ENOTFOUND' }, 'keine url')).toContain('keine url');
  });
});
