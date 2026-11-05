// The case in question — this is how it comes out of Electron/BoringSSL:
//
//   write EPROTO 416896:error:100000f7:SSL routines:
//   OPENSSL_internal:WRONG_VERSION_NUMBER:
//   ..\..\third_party\boringssl\src\ssl\tls_record.cc:127:
//
// It reads like a TLS version problem and is the opposite: the other side
// does not speak TLS on this port at all. Two paths depended on it — the raw
// text reached the user, and the scheme fallback did not kick in.
import { describe, it, expect } from 'vitest';
import {
  classifyNetworkError, isPlainHttpPortError, swapScheme, hostOf,
} from '../utils/networkErrorPure';

const BORINGSSL = Object.assign(
  new Error('write EPROTO 416896:error:100000f7:SSL routines:OPENSSL_internal:'
    + 'WRONG_VERSION_NUMBER:..\\..\\third_party\\boringssl\\src\\ssl\\tls_record.cc:127:'),
  { code: 'EPROTO' },
);
const OPENSSL = Object.assign(
  new Error('write EPROTO 140234:error:0A00010B:SSL routines:ssl3_get_record:wrong version number'),
  { code: 'EPROTO' },
);

describe('isPlainHttpPortError', () => {
  it('recognises both spellings of the reason', () => {
    expect(isPlainHttpPortError(BORINGSSL)).toBe(true);
    expect(isPlainHttpPortError(OPENSSL)).toBe(true);
  });

  it('does not cling to EPROTO alone', () => {
    // Node also uses EPROTO for other things — without the OpenSSL reason in
    // the text, the interpretation would be a guess.
    expect(isPlainHttpPortError(Object.assign(new Error('write EPROTO'), { code: 'EPROTO' }))).toBe(false);
  });

  it('does not confuse a certificate error with it', () => {
    const cert = Object.assign(new Error('self signed certificate in certificate chain'),
      { code: 'SELF_SIGNED_CERT_IN_CHAIN' });
    expect(isPlainHttpPortError(cert)).toBe(false);
  });

  it('copes with undefined and non-errors', () => {
    expect(isPlainHttpPortError(undefined)).toBe(false);
    expect(isPlainHttpPortError('kaputt')).toBe(false);
  });
});

describe('classifyNetworkError', () => {
  it('classifies the plaintext port as scheme, NOT as tls', () => {
    // The text contains "SSL routines" — the loose certificate expression
    // (/certificate|self.signed|CERT_/) does not match it, but the order is
    // pinned anyway: a later extension of the certificate expression must not
    // catch this case. Otherwise the user would get the advice to turn off
    // certificate checking even though no TLS is involved at all.
    expect(classifyNetworkError(BORINGSSL)).toBe('scheme');
    expect(classifyNetworkError(OPENSSL)).toBe('scheme');
  });

  it('keeps the existing classifications', () => {
    expect(classifyNetworkError({ code: 'ENOTFOUND' })).toBe('dns');
    expect(classifyNetworkError({ code: 'EAI_AGAIN' })).toBe('dns');
    expect(classifyNetworkError({ code: 'ECONNREFUSED' })).toBe('refused');
    expect(classifyNetworkError({ code: 'ETIMEDOUT' })).toBe('timeout');
    expect(classifyNetworkError({ message: 'socket timeout' })).toBe('timeout');
    expect(classifyNetworkError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toBe('tls');
    expect(classifyNetworkError({ message: 'unable to verify the first certificate' })).toBe('tls');
    expect(classifyNetworkError({ message: 'irgendwas' })).toBe('other');
  });

  it('respects the carried tlsCert marker', () => {
    // `connect()` rewraps the error and translates the text — the detection
    // must then not rely on English words.
    expect(classifyNetworkError({ tlsCert: true, message: 'Zertifikatsfehler' })).toBe('tls');
  });
});

describe('swapScheme / hostOf', () => {
  it('swaps both directions and leaves anything else alone', () => {
    expect(swapScheme('https://a:1/x')).toBe('http://a:1/x');
    expect(swapScheme('http://a:1/x')).toBe('https://a:1/x');
    expect(swapScheme('ftp://a')).toBeNull();
  });

  it('returns the host, and the input for a broken URL', () => {
    expect(hostOf('https://tm1.example:5895/x')).toBe('tm1.example:5895');
    expect(hostOf('nicht mal eine url')).toBe('nicht mal eine url');
  });
});
