import { describe, it, expect } from 'vitest';
import { createHash, createHmac } from 'crypto';
import {
  md4,
  ntowfv1,
  ntowfv2,
  buildType1,
  parseType2,
  buildType3,
  parseAvPairs,
  encodeAvPairs,
  pickNtlmScheme,
  extractChallengeToken,
  splitDomainUser,
  rc4,
  NTLM_CLIENT_FLAGS,
  NtlmFlag,
  AvId,
} from '../tm1Rest/transport/ntlm';
import {
  tlsServerEndPointBinding, endPointHashFor, endPointHashForCertificate,
  certificateSignatureOid,
} from '../tm1Rest/transport/ntlmChannelBinding';

/**
 * The numbers in this file are NOT self-generated expected values.
 *
 * MD4: RFC 1320, appendix A.5 ("Test suite").
 * NTLMv2: MS-NLMP, section 4.2.4 ("NTLMv2 Authentication") — the example
 * session worked through there with user "User", domain "Domain",
 * password "Password", ServerChallenge 0123456789abcdef, ClientChallenge
 * aaaaaaaaaaaaaaaa and timestamp 0.
 *
 * That is exactly why they are valuable: they check the computation against
 * the specification, not against our own implementation. A sign or ordering
 * error in MD4 or an upper-cased domain name in NTOWFv2 shows up here — on the
 * wire it only shows up as a 401, which cannot be told apart from a genuine
 * "wrong password".
 */

const hex = (b: Buffer): string => b.toString('hex');

describe('MD4 (RFC 1320 test vectors)', () => {
  it.each([
    ['', '31d6cfe0d16ae931b73c59d7e0c089c0'],
    ['a', 'bde52cb31de33e46245e05fbdbd6fb24'],
    ['abc', 'a448017aaf21d8525fc10ae87aa6729d'],
    ['message digest', 'd9130a8164549fe818874806e1c7014b'],
    ['abcdefghijklmnopqrstuvwxyz', 'd79e1c308aa5bbcdeea8ed63df412da9'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', '043f8582f241db351ce627e153e7f0e4'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', 'e33b4ddc9c38f2199c3e7b164fcc0536'],
  ])('md4(%j)', (input, expected) => {
    expect(hex(md4(Buffer.from(input, 'latin1')))).toBe(expected);
  });

  it('respects the block boundary (55, 56, 57, 64, 119, 120 bytes)', () => {
    // 56 and 120 are the cases in which the length field forces an ADDITIONAL
    // block. An off-by-one in the padding strikes exactly here.
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 121]) {
      expect(md4(Buffer.alloc(n, 0x61))).toHaveLength(16);
    }
    // Counter-check with a known value of length 62 (RFC vector above).
    expect(hex(md4(Buffer.from('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'latin1'))))
      .toBe('043f8582f241db351ce627e153e7f0e4');
  });
});

describe('RC4', () => {
  it.each([
    // The classic vectors from the RC4 description (also in the RFC 6229 appendix).
    ['Key', 'Plaintext', 'bbf316e8d940af0ad3'],
    ['Wiki', 'pedia', '1021bf0420'],
    ['Secret', 'Attack at dawn', '45a01f645fc35b383552544b9bf5'],
  ])('rc4(%j, %j)', (key, plain, expected) => {
    expect(hex(rc4(Buffer.from(key, 'latin1'), Buffer.from(plain, 'latin1')))).toBe(expected);
  });

  it('is symmetric — which is exactly why the test bench can recover the key', () => {
    const key = Buffer.from('0123456789abcdef', 'hex');
    const data = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
    expect(hex(rc4(key, rc4(key, data)))).toBe(hex(data));
  });

  it('rejects an empty key', () => {
    // Without the check, the key schedule would run into a division by 0
    // (`key[i % 0]` is NaN) and silently produce garbage.
    expect(() => rc4(Buffer.alloc(0), Buffer.from('x'))).toThrow(/must not be empty/);
  });
});

describe('Key derivation (MS-NLMP 4.2.4.1)', () => {
  it('NTOWFv1 is MD4(UTF-16LE(password))', () => {
    expect(hex(ntowfv1('Password'))).toBe('a4f49c406510bdcab6824ee7c30fd852');
  });

  it('NTOWFv2 upper-cases the user, NOT the domain', () => {
    expect(hex(ntowfv2('User', 'Password', 'Domain'))).toBe('0c868a403bfd7a93a3001ef22ef02e3f');
  });

  it('an upper-cased domain yields a DIFFERENT key', () => {
    // The most common implementation error: upper-casing both parts. The result
    // is a valid hash that only becomes visible on the wire as a 401.
    expect(hex(ntowfv2('User', 'Password', 'DOMAIN')))
      .not.toBe(hex(ntowfv2('User', 'Password', 'Domain')));
  });

  it('the user name is case-insensitive in the derivation', () => {
    expect(hex(ntowfv2('user', 'Password', 'Domain')))
      .toBe(hex(ntowfv2('USER', 'Password', 'Domain')));
  });
});

/** Builds the TargetInfo of the example session from MS-NLMP 4.2.4.1.3. */
function specTargetInfo(): Buffer {
  const av = (id: number, value: string): Buffer => {
    const v = Buffer.from(value, 'utf16le');
    const head = Buffer.alloc(4);
    head.writeUInt16LE(id, 0);
    head.writeUInt16LE(v.length, 2);
    return Buffer.concat([head, v]);
  };
  return Buffer.concat([av(2, 'Domain'), av(1, 'Server'), Buffer.alloc(4)]);
}

/** Builds a Type 2 message in extended form (48-byte header) with TargetInfo. */
function makeType2(opts: {
  challenge: Buffer;
  targetName: string;
  targetInfo: Buffer;
  flags?: number;
}): Buffer {
  const targetName = Buffer.from(opts.targetName, 'utf16le');
  const HEADER = 48;
  const msg = Buffer.alloc(HEADER + targetName.length + opts.targetInfo.length);
  Buffer.from('NTLMSSP\0', 'latin1').copy(msg, 0);
  msg.writeUInt32LE(2, 8);
  msg.writeUInt16LE(targetName.length, 12);
  msg.writeUInt16LE(targetName.length, 14);
  msg.writeUInt32LE(HEADER, 16);
  msg.writeUInt32LE(opts.flags ?? (NtlmFlag.UNICODE | NtlmFlag.TARGET_INFO | NtlmFlag.TARGET_TYPE_DOMAIN), 20);
  opts.challenge.copy(msg, 24);
  msg.writeUInt16LE(opts.targetInfo.length, 40);
  msg.writeUInt16LE(opts.targetInfo.length, 42);
  msg.writeUInt32LE(HEADER + targetName.length, 44);
  targetName.copy(msg, HEADER);
  opts.targetInfo.copy(msg, HEADER + targetName.length);
  return msg;
}

describe('Type 1 (NEGOTIATE)', () => {
  it('is 32 bytes, signature + type 1, without domain and workstation', () => {
    const t1 = buildType1();
    expect(t1).toHaveLength(32);
    expect(t1.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
    expect(t1.readUInt32LE(8)).toBe(1);
    // Both security buffers empty — otherwise the client's computer name would
    // be on the network without it doing the protocol any good.
    expect(t1.readUInt16LE(16)).toBe(0);
    expect(t1.readUInt16LE(24)).toBe(0);
  });

  it('requests NTLMv2', () => {
    const flags = buildType1().readUInt32LE(12);
    expect(flags & NtlmFlag.UNICODE).toBeTruthy();
    expect(flags & NtlmFlag.REQUEST_TARGET).toBeTruthy();
    expect(flags & NtlmFlag.EXTENDED_SESSIONSECURITY).toBeTruthy();
  });

  it('requests 128 and 56 — and must not lose that again', () => {
    // Background: the first version left out both bits, because nothing is
    // encrypted at the HTTP level after the handshake. The result was that
    // `core-paw` rejected Type 3, even though it was byte-identical to the one
    // from Windows SSPI and the password was demonstrably correct (live
    // 2026-09-17). Cause: the policy "Minimum session security for NTLM SSP"
    // requires 128-bit encryption — and what is not requested is not
    // negotiated.
    const flags = buildType1().readUInt32LE(12);
    expect(flags & NtlmFlag.NEGOTIATE_128).toBeTruthy();
    expect(flags & NtlmFlag.NEGOTIATE_56).toBeTruthy();
  });

  it('does NOT request SIGN, SEAL and KEY_EXCH', () => {
    // Also measured, not chosen: Windows SSPI does not negotiate these three for
    // HTTP authentication even when the server offers them (challenge
    // 0xE2898235 → SSPI answers 0xA2888205). Requesting them as well was a
    // wrong conclusion drawn from the curl run; curl requests them,
    // HttpWebRequest does not.
    const flags = buildType1().readUInt32LE(12);
    expect(flags & NtlmFlag.SIGN).toBe(0);
    expect(flags & NtlmFlag.SEAL).toBe(0);
    expect(flags & NtlmFlag.KEY_EXCH).toBe(0);
  });
});

describe('Type 2 (CHALLENGE)', () => {
  it('reads Challenge, TargetName and TargetInfo', () => {
    const targetInfo = specTargetInfo();
    const parsed = parseType2(makeType2({
      challenge: Buffer.from('0123456789abcdef', 'hex'),
      targetName: 'Domain',
      targetInfo,
    }));
    expect(hex(parsed.challenge)).toBe('0123456789abcdef');
    expect(parsed.targetName).toBe('Domain');
    expect(hex(parsed.targetInfo)).toBe(hex(targetInfo));
    expect(parsed.serverTimestamp).toBeUndefined();
  });

  it('reads a challenge in the form a gateway sent live', () => {
    // Rebuilt rather than captured: the original capture carried domain and
    // computer names of a real installation. The form is the same —
    // extended header, TargetInfo with NbDomain, NbComputer, DnsDomain,
    // DnsComputer, DnsTree and MsvAvTimestamp. The core finding does not depend
    // on the content: the server calls the scheme `Negotiate` and sends raw
    // NTLMSSP underneath.
    const av = (id: number, value: string): Buffer => {
      const v = Buffer.from(value, 'utf16le');
      const head = Buffer.alloc(4);
      head.writeUInt16LE(id, 0);
      head.writeUInt16LE(v.length, 2);
      return Buffer.concat([head, v]);
    };
    const stamp = Buffer.from('81c8f0d26c46dd01', 'hex');
    const stampPair = Buffer.concat([Buffer.from([7, 0, 8, 0]), stamp]);
    const targetInfo = Buffer.concat([
      av(2, 'CORP'), av(1, 'TM1HOST'), av(4, 'corp.example.com'),
      av(3, 'tm1host.corp.example.com'), av(5, 'corp.example.com'),
      stampPair, Buffer.alloc(4),
    ]);
    const live = makeType2({
      challenge: Buffer.from('469d55ea3cc23e3e', 'hex'),
      targetName: 'CORP',
      targetInfo,
      flags: NtlmFlag.UNICODE | NtlmFlag.REQUEST_TARGET | NtlmFlag.NTLM
        | NtlmFlag.EXTENDED_SESSIONSECURITY | NtlmFlag.TARGET_INFO | NtlmFlag.TARGET_TYPE_DOMAIN,
    });

    const parsed = parseType2(live);
    expect(parsed.targetName).toBe('CORP');
    expect(hex(parsed.challenge)).toBe('469d55ea3cc23e3e');
    expect(parsed.flags & NtlmFlag.EXTENDED_SESSIONSECURITY).toBeTruthy();
    expect(parsed.flags & NtlmFlag.TARGET_INFO).toBeTruthy();
    expect(hex(parsed.targetInfo)).toBe(hex(targetInfo));
    // THIS is the point where the first version failed: the TargetInfo
    // carries an MsvAvTimestamp. So MS-NLMP 3.1.5.1.2 applies, and Type 3
    // must carry the server's timestamp, Z(24) as the LM response and a MIC.
    // Without that the server answers with 401 (confirmed live).
    expect(parsed.serverTimestamp && hex(parsed.serverTimestamp)).toBe('81c8f0d26c46dd01');
  });

  it('rejects a foreign signature, the wrong type and stubs', () => {
    // Long enough that the length check does not kick in first — otherwise
    // this case would not check the signature at all.
    expect(() => parseType2(Buffer.alloc(48))).toThrow(/NTLMSSP signature/);
    expect(() => parseType2(Buffer.alloc(16))).toThrow(/too short/);
    const wrongType = makeType2({ challenge: Buffer.alloc(8), targetName: 'X', targetInfo: Buffer.alloc(4) });
    wrongType.writeUInt32LE(3, 8);
    expect(() => parseType2(wrongType)).toThrow(/message type 3/);
  });

  it('rejects a security buffer that points past the end', () => {
    const msg = makeType2({ challenge: Buffer.alloc(8), targetName: 'Domain', targetInfo: specTargetInfo() });
    msg.writeUInt32LE(0xffff, 44);
    expect(() => parseType2(msg)).toThrow(/truncated/);
  });

  it('keeps the raw message — the MIC is computed over it', () => {
    const msg = makeType2({ challenge: Buffer.alloc(8, 3), targetName: 'CORP', targetInfo: specTargetInfo() });
    expect(hex(parseType2(msg).raw)).toBe(hex(msg));
  });

  it('accepts a timestamp only with the prescribed 8 bytes', () => {
    const short = Buffer.alloc(8);
    short.writeUInt16LE(AvId.TIMESTAMP, 0);
    short.writeUInt16LE(4, 2);
    const parsed = parseType2(makeType2({
      challenge: Buffer.alloc(8),
      targetName: 'Domain',
      targetInfo: Buffer.concat([short, Buffer.alloc(4)]),
    }));
    // Taking a truncated pair as the timestamp would spoil the blob.
    expect(parsed.serverTimestamp).toBeUndefined();
  });
});

/** Reads a security buffer (len, maxlen, offset) from a Type 3 message. */
const field = (msg: Buffer, index: number): Buffer => {
  const at = 12 + index * 8;
  const len = msg.readUInt16LE(at);
  const off = msg.readUInt32LE(at + 4);
  return msg.subarray(off, off + len);
};

/**
 * WITHOUT MsvAvTimestamp — here the base case from MS-NLMP 3.3.2 applies, and
 * only here are the vectors from 4.2.4 applicable. If the challenge carries a
 * timestamp, 3.1.5.1.2 prescribes other values (separate block below).
 */
describe('Type 3 (AUTHENTICATE) without timestamp — MS-NLMP 4.2.4', () => {
  const challenge = parseType2(makeType2({
    challenge: Buffer.from('0123456789abcdef', 'hex'),
    targetName: 'Domain',
    targetInfo: specTargetInfo(),
  }));
  const base = {
    challenge,
    user: 'User',
    password: 'Password',
    domain: 'Domain',
    negotiateMessage: buildType1(),
  };
  // Without channel binding and without SPN, the TargetInfo stays the one from
  // the specification — otherwise the specification's NTProofStr would no
  // longer be reachable, because it is computed over the TargetInfo too.
  const t3 = buildType3({
    ...base,
    clientChallenge: Buffer.from('aaaaaaaaaaaaaaaa', 'hex'),
    timestamp: 0n,
    channelBindings: undefined,
  });

  it('confirms that this challenge carries NO timestamp', () => {
    expect(challenge.serverTimestamp).toBeUndefined();
  });

  it('the LMv2 response matches the value from the specification', () => {
    expect(hex(field(t3, 0))).toBe('86c35097ac9cec102554764a57cccc19aaaaaaaaaaaaaaaa');
  });

  it('temp carries version, timestamp and ClientChallenge at the right places', () => {
    const temp = field(t3, 1).subarray(16);
    expect(hex(temp.subarray(0, 8))).toBe('0101000000000000');
    expect(temp.readBigUInt64LE(8)).toBe(0n);
    expect(hex(temp.subarray(16, 24))).toBe('aaaaaaaaaaaaaaaa');
    expect(hex(temp.subarray(temp.length - 4))).toBe('00000000');
  });

  it('NTProofStr matches the value from the specification when the TargetInfo stays untouched', () => {
    // The proof is computed over the TargetInfo. Without additional AV_PAIRs,
    // exactly the value from 4.2.4.2.2 must come out — that is the sharp test of
    // the whole chain MD4 → NTOWFv2 → temp → HMAC.
    const spec = buildType3({
      ...base,
      clientChallenge: Buffer.from('aaaaaaaaaaaaaaaa', 'hex'),
      timestamp: 0n,
      channelBindings: undefined,
      targetSpn: undefined,
    });
    // encodeAvPairs appends the EOL pair; the specification's TargetInfo
    // already contains it, so the round trip must leave it unchanged.
    expect(hex(field(spec, 1).subarray(16 + 28, field(spec, 1).length - 4)))
      .toBe(hex(specTargetInfo()));
    expect(hex(field(spec, 1).subarray(0, 16))).toBe('68cd0ab851e51c96aabc927bebef6a1c');
  });

  it('carries domain and user as UTF-16LE, without workstation and session key', () => {
    expect(field(t3, 2).toString('utf16le')).toBe('Domain');
    expect(field(t3, 3).toString('utf16le')).toBe('User');
    expect(field(t3, 4)).toHaveLength(0);
    expect(field(t3, 5)).toHaveLength(0);
  });

  it('is NTLMSSP type 3, reports VERSION and carries the version field', () => {
    expect(t3.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
    expect(t3.readUInt32LE(8)).toBe(3);
    // NTLMRevisionCurrent MUST be 0x0F, the rest is self-reported.
    expect(t3[71]).toBe(0x0f);
    expect(t3.readUInt32LE(60) & NtlmFlag.VERSION).toBeTruthy();
  });

  it('leaves NO room for a MIC without a timestamp (header 72 bytes)', () => {
    const firstPayload = Math.min(...[0, 1, 2, 3].map((i) => t3.readUInt32LE(12 + i * 8 + 4)).filter((o) => o > 0));
    expect(firstPayload).toBe(72);
  });

  it('produces a new response on every call without a fixed ClientChallenge', () => {
    expect(hex(buildType3(base))).not.toBe(hex(buildType3(base)));
  });

  it('rejects a ClientChallenge and channel binding of the wrong length', () => {
    expect(() => buildType3({ ...base, clientChallenge: Buffer.alloc(7) })).toThrow(/8 bytes/);
    expect(() => buildType3({ ...base, channelBindings: Buffer.alloc(15) })).toThrow(/16 bytes/);
  });

  it('appends NO channel binding when none is given — otherwise the spec value would be unreachable', () => {
    const temp = field(t3, 1).subarray(16);
    const ids = parseAvPairs(temp.subarray(28, temp.length - 4)).map((p) => p.id);
    expect(ids).not.toContain(AvId.CHANNEL_BINDINGS);
  });
});

/**
 * WITH MsvAvTimestamp — the case the PAW gateway delivers. MS-NLMP 3.1.5.1.2
 * prescribes three deviations here. Exactly these three were missing in the
 * first version, and the server answered that with 401 (live 2026-09-17).
 */
describe('Type 3 with MsvAvTimestamp — MS-NLMP 3.1.5.1.2', () => {
  const SERVER_STAMP = Buffer.from('81c8f0d26c46dd01', 'hex');   // from the live challenge
  const stampPair = Buffer.concat([
    (() => { const h = Buffer.alloc(4); h.writeUInt16LE(AvId.TIMESTAMP, 0); h.writeUInt16LE(8, 2); return h; })(),
    SERVER_STAMP,
  ]);
  const challenge = parseType2(makeType2({
    challenge: Buffer.from('7bafd3caa746a01f', 'hex'),
    targetName: 'CORP',
    targetInfo: Buffer.concat([specTargetInfo().subarray(0, specTargetInfo().length - 4), stampPair, Buffer.alloc(4)]),
  }));
  const t3 = buildType3({
    challenge,
    user: 'user1',
    password: 'geheim',
    domain: 'CORP',
    negotiateMessage: buildType1(),
    targetSpn: 'HTTP/core-paw.example.internal',
    channelBindings: Buffer.alloc(16),
    clientChallenge: Buffer.from('1122334455667788', 'hex'),
    // Set on purpose AND must be ignored.
    timestamp: 0n,
  });

  it('reads the server timestamp from the TargetInfo', () => {
    expect(challenge.serverTimestamp && hex(challenge.serverTimestamp)).toBe('81c8f0d26c46dd01');
  });

  it('point 1: the blob carries the timestamp OF THE SERVER, not our own clock', () => {
    const temp = field(t3, 1).subarray(16);
    expect(hex(temp.subarray(8, 16))).toBe('81c8f0d26c46dd01');
  });

  it('point 2: LmChallengeResponse is Z(24), not the LMv2 response', () => {
    expect(hex(field(t3, 0))).toBe('00'.repeat(24));
  });

  it('point 3: AV_FLAGS reports the MIC and the MIC is set', () => {
    const temp = field(t3, 1).subarray(16);
    const info = temp.subarray(28, temp.length - 4);
    const flags = parseAvPairs(info).find((p) => p.id === AvId.FLAGS);
    expect(flags && flags.value.readUInt32LE(0) & 0x2).toBeTruthy();
    const mic = t3.subarray(72, 88);
    expect(hex(mic)).not.toBe('00'.repeat(16));
  });

  it('the header makes room for version AND MIC (88 bytes)', () => {
    const firstPayload = Math.min(...[0, 1, 2, 3].map((i) => t3.readUInt32LE(12 + i * 8 + 4)).filter((o) => o > 0));
    expect(firstPayload).toBe(88);
  });

  it('the MIC is HMAC-MD5 over Type 1 | Type 2 | Type 3 with a zeroed MIC field', () => {
    // Recomputed, not just "something is in there": the MIC field is set back
    // to zero and the value is computed independently.
    const responseKey = ntowfv2('user1', 'geheim', 'CORP');
    const ntProofStr = field(t3, 1).subarray(0, 16);
    const exported = createHmac('md5', responseKey).update(ntProofStr).digest();
    const zeroed = Buffer.from(t3);
    Buffer.alloc(16).copy(zeroed, 72);
    const expected = createHmac('md5', exported)
      .update(Buffer.concat([buildType1(), challenge.raw, zeroed]))
      .digest();
    expect(hex(t3.subarray(72, 88))).toBe(hex(expected));
  });

  it('appends MsvAvTargetName and MsvAvChannelBindings without losing the server pairs', () => {
    const temp = field(t3, 1).subarray(16);
    const pairs = parseAvPairs(temp.subarray(28, temp.length - 4));
    const byId = new Map(pairs.map((p) => [p.id, p.value]));
    // The server's pairs must be included unchanged.
    expect(byId.get(AvId.NB_DOMAIN)?.toString('utf16le')).toBe('Domain');
    expect(byId.get(AvId.NB_COMPUTER)?.toString('utf16le')).toBe('Server');
    expect(byId.get(AvId.TIMESTAMP) && hex(byId.get(AvId.TIMESTAMP)!)).toBe('81c8f0d26c46dd01');
    // And ours as well.
    expect(byId.get(AvId.TARGET_NAME)?.toString('utf16le')).toBe('HTTP/core-paw.example.internal');
    expect(byId.get(AvId.CHANNEL_BINDINGS) && hex(byId.get(AvId.CHANNEL_BINDINGS)!)).toBe('00'.repeat(16));
  });

  it('merges an already existing AV_FLAGS instead of duplicating it', () => {
    const existing = Buffer.alloc(8);
    existing.writeUInt16LE(AvId.FLAGS, 0);
    existing.writeUInt16LE(4, 2);
    existing.writeUInt32LE(0x1, 4);            // some other bit
    const withFlags = parseType2(makeType2({
      challenge: Buffer.alloc(8),
      targetName: 'CORP',
      targetInfo: Buffer.concat([existing, stampPair, Buffer.alloc(4)]),
    }));
    const msg = buildType3({
      challenge: withFlags, user: 'u', password: 'p', domain: 'CORP', negotiateMessage: buildType1(),
    });
    const temp = field(msg, 1).subarray(16);
    const flagPairs = parseAvPairs(temp.subarray(28, temp.length - 4)).filter((p) => p.id === AvId.FLAGS);
    expect(flagPairs).toHaveLength(1);
    expect(flagPairs[0].value.readUInt32LE(0)).toBe(0x1 | 0x2);
  });
});

describe('AV_PAIR round trip', () => {
  it('splits and reassembles without losing anything', () => {
    const original = specTargetInfo();
    expect(hex(encodeAvPairs(parseAvPairs(original)))).toBe(hex(original));
  });

  it('stops at the EOL pair and ignores everything after it', () => {
    const trailing = Buffer.concat([specTargetInfo(), Buffer.from('deadbeef', 'hex')]);
    expect(parseAvPairs(trailing)).toHaveLength(2);
  });

  it('rejects a pair that points past the end', () => {
    const bad = Buffer.alloc(8);
    bad.writeUInt16LE(AvId.NB_DOMAIN, 0);
    bad.writeUInt16LE(0xff, 2);
    expect(() => parseAvPairs(bad)).toThrow(/truncated/);
  });
});


describe('Type 3 flags are the negotiation result, not the wish', () => {
  const forServerFlags = (serverFlags: number) => {
    const challenge = parseType2(makeType2({
      challenge: Buffer.from('0123456789abcdef', 'hex'),
      targetName: 'CORP',
      targetInfo: specTargetInfo(),
      flags: serverFlags,
    }));
    return buildType3({
      challenge, user: 'u', password: 'p', domain: 'CORP', negotiateMessage: buildType1(),
    }).readUInt32LE(60);
  };

  it('with the narrow negotiation, exactly the 0x02888205 measured from SSPI', () => {
    // Measured with ntlmSelfCheckProbe.mjs on 2026-09-17: to a challenge
    // with 0x02898205, Windows SSPI answers with exactly this value.
    expect(forServerFlags(0x02898205)).toBe(0x02888205);
  });

  it('takes 128 and 56 along, but leaves SIGN/SEAL/KEY_EXCH alone', () => {
    // The server offers 0xE2898235; SSPI answers that with 0xA2888205
    // (measured 2026-09-17). We have to hit exactly this value — an offered
    // flag is not a request to take it.
    expect(forServerFlags(0xe2898235) >>> 0).toBe(0xa2888205);
  });

  it('never takes a flag the server has not confirmed', () => {
    const serverFlags = 0x00080201;   // only UNICODE, NTLM, EXTENDED_SESSIONSECURITY
    const result = forServerFlags(serverFlags);
    // Apart from VERSION (which only describes that we write the field),
    // nothing may be set that the server did not offer.
    expect((result & ~(serverFlags | NtlmFlag.VERSION)) >>> 0).toBe(0);
  });
});

describe('KEY_EXCH — the encrypted session key', () => {
  // WITH timestamp, because that is the case at the real gateway: then MIC AND
  // KEY_EXCH are in play at the same time, and only that way can we check
  // WHICH key the MIC is computed with.
  const stamped = Buffer.concat([
    specTargetInfo().subarray(0, specTargetInfo().length - 4),
    (() => { const h = Buffer.alloc(4); h.writeUInt16LE(AvId.TIMESTAMP, 0); h.writeUInt16LE(8, 2); return h; })(),
    Buffer.from('81c8f0d26c46dd01', 'hex'),
    Buffer.alloc(4),
  ]);
  const challenge = parseType2(makeType2({
    challenge: Buffer.from('0123456789abcdef', 'hex'),
    targetName: 'CORP',
    targetInfo: stamped,
    flags: 0xe2898235,
  }));
  // KEY_EXCH is NOT requested by default. So the path is only reachable when
  // the caller builds Type 1 more broadly — exactly as a server that insists
  // on it would force.
  const type1 = buildType1(NTLM_CLIENT_FLAGS | NtlmFlag.KEY_EXCH);
  const sessionKey = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
  const t3 = buildType3({
    challenge, user: 'User', password: 'Password', domain: 'Domain',
    negotiateMessage: type1,
    exportedSessionKey: sessionKey,
  });
  const at = (i: number) => {
    const p = 12 + i * 8;
    return t3.subarray(t3.readUInt32LE(p + 4), t3.readUInt32LE(p + 4) + t3.readUInt16LE(p));
  };

  it('fills the field with 16 bytes when KEY_EXCH was negotiated', () => {
    expect(t3.readUInt32LE(60) & NtlmFlag.KEY_EXCH).toBeTruthy();
    expect(at(5)).toHaveLength(16);
  });

  it('the field is RC4(KeyExchangeKey, session key) — recomputed backwards', () => {
    const responseKey = ntowfv2('User', 'Password', 'Domain');
    const kxKey = createHmac('md5', responseKey).update(at(1).subarray(0, 16)).digest();
    expect(hex(rc4(kxKey, at(5)))).toBe(hex(sessionKey));
  });

  it('the MIC is computed with the SUPPLIED key, not with the SessionBaseKey', () => {
    // The difference is invisible as long as you do not check it: both keys
    // are 16 bytes and yield a formally valid MIC.
    const zeroed = Buffer.from(t3);
    Buffer.alloc(16).copy(zeroed, 72);
    const expected = createHmac('md5', sessionKey)
      .update(Buffer.concat([type1, challenge.raw, zeroed]))
      .digest();
    expect(hex(t3.subarray(72, 88))).toBe(hex(expected));

    const responseKey = ntowfv2('User', 'Password', 'Domain');
    const sessionBaseKey = createHmac('md5', responseKey).update(at(1).subarray(0, 16)).digest();
    const wrong = createHmac('md5', sessionBaseKey)
      .update(Buffer.concat([type1, challenge.raw, zeroed]))
      .digest();
    expect(hex(t3.subarray(72, 88))).not.toBe(hex(wrong));
  });

  it('stays empty without KEY_EXCH and the MIC uses the SessionBaseKey', () => {
    const narrow = parseType2(makeType2({
      challenge: Buffer.from('0123456789abcdef', 'hex'),
      targetName: 'CORP',
      targetInfo: stamped,
      flags: 0x02898205,
    }));
    const msg = buildType3({
      challenge: narrow, user: 'User', password: 'Password', domain: 'Domain',
      negotiateMessage: buildType1(),
    });
    expect(msg.readUInt32LE(60) & NtlmFlag.KEY_EXCH).toBe(0);
    expect(msg.readUInt16LE(12 + 5 * 8)).toBe(0);
  });

  it('rejects a session key of the wrong length', () => {
    expect(() => buildType3({
      challenge, user: 'u', password: 'p', domain: 'CORP', negotiateMessage: type1,
      exportedSessionKey: Buffer.alloc(8),
    })).toThrow(/16 bytes/);
  });

  it('produces a new one every time without a fixed key', () => {
    const base = { challenge, user: 'u', password: 'p', domain: 'CORP', negotiateMessage: type1 };
    const a = buildType3({ ...base, clientChallenge: Buffer.alloc(8, 1) });
    const b = buildType3({ ...base, clientChallenge: Buffer.alloc(8, 1) });
    // Same ClientChallenge, so the same NTProofStr — but the session key is
    // random, so the messages must differ.
    expect(hex(a.subarray(12, 20))).toBe(hex(b.subarray(12, 20)));
    expect(hex(a)).not.toBe(hex(b));
  });
});

describe('Message layout as Windows produces it', () => {
  // These three properties are NOT matters of taste. They were the last three
  // byte differences from SSPI, and because the MIC is computed over the whole
  // message, each single one makes it differ. Verified with
  // ntlmSelfCheckProbe.mjs on 2026-09-17 (result: byte-identical).
  const challenge = parseType2(makeType2({
    challenge: Buffer.from('0123456789abcdef', 'hex'),
    targetName: 'Domain',
    targetInfo: specTargetInfo(),
  }));
  const t3 = buildType3({
    challenge, user: 'User', password: 'Password', domain: 'Domain',
    negotiateMessage: buildType1(), workstation: 'WS',
  });
  const bufAt = (i: number) => ({
    len: t3.readUInt16LE(12 + i * 8),
    off: t3.readUInt32LE(12 + i * 8 + 4),
  });

  it('lays out the payload in the order Domain, User, Workstation, LM, NT', () => {
    const order = [0, 1, 2, 3, 4, 5]
      .map((i) => ({ i, ...bufAt(i) }))
      .filter((s) => s.len > 0)
      .sort((a, b) => a.off - b.off)
      .map((s) => s.i);
    // Indices: 2 = Domain, 3 = User, 4 = Workstation, 0 = LM, 1 = NT.
    expect(order).toEqual([2, 3, 4, 0, 1]);
  });

  it('gives even an EMPTY field the current write position as its offset', () => {
    // The EncryptedRandomSessionKey is empty (no KEY_EXCH). A 0 there was the
    // last byte difference from SSPI — two bytes that flipped the MIC.
    const sessionKey = bufAt(5);
    expect(sessionKey.len).toBe(0);
    expect(sessionKey.off).toBe(t3.length);
  });

  it('keeps the descriptors in the header in the order of the format', () => {
    // The PLACEMENT is free, the ORDER OF THE FIELDS in the header is not.
    expect(bufAt(0).len).toBe(24);                                  // LM
    expect(t3.subarray(bufAt(1).off, bufAt(1).off + 16)).toHaveLength(16);  // NT
    expect(t3.subarray(bufAt(2).off, bufAt(2).off + bufAt(2).len).toString('utf16le')).toBe('Domain');
    expect(t3.subarray(bufAt(3).off, bufAt(3).off + bufAt(3).len).toString('utf16le')).toBe('User');
    expect(t3.subarray(bufAt(4).off, bufAt(4).off + bufAt(4).len).toString('utf16le')).toBe('WS');
  });

  it('rejects a version field of the wrong length', () => {
    expect(() => buildType3({
      challenge, user: 'User', password: 'Password', domain: 'Domain',
      negotiateMessage: buildType1(), version: Buffer.alloc(7),
    })).toThrow(/8 bytes/);
  });
});

describe('Channel binding tls-server-end-point (RFC 5929)', () => {
  const der = Buffer.from('308201223081cc0203010203', 'hex');   // placeholder, only as a byte sequence

  it('is MD5 over the gss_channel_bindings_struct', () => {
    // Rebuilt independently instead of "agrees with itself": 4 empty address
    // fields, then length and content of the applicationData.
    const certHash = createHash('sha256').update(der).digest();
    const appData = Buffer.concat([Buffer.from('tls-server-end-point:', 'latin1'), certHash]);
    const struct = Buffer.alloc(20 + appData.length);
    struct.writeUInt32LE(appData.length, 16);
    appData.copy(struct, 20);
    expect(hex(tlsServerEndPointBinding(der))).toBe(hex(createHash('md5').update(struct).digest()));
  });

  it('is 16 bytes and depends on the certificate', () => {
    expect(tlsServerEndPointBinding(der)).toHaveLength(16);
    expect(hex(tlsServerEndPointBinding(der)))
      .not.toBe(hex(tlsServerEndPointBinding(Buffer.concat([der, Buffer.from([0])]))));
  });

  it('depends on the chosen hash', () => {
    expect(hex(tlsServerEndPointBinding(der, 'sha256')))
      .not.toBe(hex(tlsServerEndPointBinding(der, 'sha384')));
  });

  it('raises MD5 and SHA-1 to SHA-256, as RFC 5929 requires', () => {
    expect(endPointHashFor('md5WithRSAEncryption')).toBe('sha256');
    expect(endPointHashFor('sha1WithRSAEncryption')).toBe('sha256');
    expect(endPointHashFor('sha256WithRSAEncryption')).toBe('sha256');
    expect(endPointHashFor('sha384WithRSAEncryption')).toBe('sha384');
    expect(endPointHashFor('ecdsa-with-SHA512')).toBe('sha512');
    expect(endPointHashFor(undefined)).toBe('sha256');
  });
});

describe('Signature algorithm from the DER certificate', () => {
  /** Builds a minimal DER certificate: SEQUENCE { SEQUENCE tbs, SEQUENCE { OID }, BITSTRING }. */
  const der = (oidBytes: number[], longForm = false): Buffer => {
    const oid = Buffer.from([0x06, oidBytes.length, ...oidBytes]);
    const algId = Buffer.concat([Buffer.from([0x30, oid.length]), oid]);
    const tbs = longForm
      ? Buffer.concat([Buffer.from([0x30, 0x81, 200]), Buffer.alloc(200)])
      : Buffer.from([0x30, 0x02, 0x00, 0x00]);
    const sig = Buffer.from([0x03, 0x02, 0x00, 0x00]);
    const body = Buffer.concat([tbs, algId, sig]);
    const head = body.length < 128
      ? Buffer.from([0x30, body.length])
      : Buffer.from([0x30, 0x81, body.length]);
    return Buffer.concat([head, body]);
  };

  it('reads sha256WithRSAEncryption', () => {
    // 1.2.840.113549.1.1.11
    const oid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b];
    expect(certificateSignatureOid(der(oid))).toBe('1.2.840.113549.1.1.11');
    expect(endPointHashForCertificate(der(oid))).toBe('sha256');
  });

  it('reads sha512WithRSAEncryption and chooses SHA-512', () => {
    const oid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0d];
    expect(certificateSignatureOid(der(oid))).toBe('1.2.840.113549.1.1.13');
    expect(endPointHashForCertificate(der(oid))).toBe('sha512');
  });

  it('reads ecdsa-with-SHA384 and chooses SHA-384', () => {
    // 1.2.840.10045.4.3.3
    const oid = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x04, 0x03, 0x03];
    expect(certificateSignatureOid(der(oid))).toBe('1.2.840.10045.4.3.3');
    expect(endPointHashForCertificate(der(oid))).toBe('sha384');
  });

  it('copes with the long length form', () => {
    const oid = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b];
    expect(certificateSignatureOid(der(oid, true))).toBe('1.2.840.113549.1.1.11');
  });

  it('falls back to SHA-256 on unreadable DER instead of throwing', () => {
    // An exception here would be wrong: an unknown certificate format must not
    // prevent the login, SHA-256 is the lower bound of RFC 5929.
    for (const junk of [Buffer.alloc(0), Buffer.from([0x30]), Buffer.from('nonsense'), Buffer.from([0x30, 0x7f, 0x02])]) {
      expect(certificateSignatureOid(junk)).toBeUndefined();
      expect(endPointHashForCertificate(junk)).toBe('sha256');
    }
  });
});

describe('Evaluating WWW-Authenticate', () => {
  it('chooses Negotiate before NTLM and ignores Basic/Bearer', () => {
    // Exactly the list the PAW gateway sent live.
    expect(pickNtlmScheme([
      'Bearer realm="Service"',
      'Negotiate',
      'Basic realm="TM1"',
    ])).toBe('Negotiate');
    expect(pickNtlmScheme(['NTLM', 'Basic realm="TM1"'])).toBe('NTLM');
    expect(pickNtlmScheme(['Negotiate', 'NTLM'])).toBe('Negotiate');
  });

  it('reports undefined when the server offers no NTLM-capable scheme', () => {
    // A configuration finding, not a login error — the caller has to keep the two apart.
    expect(pickNtlmScheme(['Basic realm="TM1"', 'Bearer realm="Service"'])).toBeUndefined();
    expect(pickNtlmScheme(undefined)).toBeUndefined();
    expect(pickNtlmScheme([])).toBeUndefined();
  });

  it('finds several schemes even in ONE comma-separated header line', () => {
    expect(pickNtlmScheme('Basic realm="TM1", Negotiate')).toBe('Negotiate');
  });

  it('takes the token from the header line of the chosen scheme', () => {
    const token = makeType2({ challenge: Buffer.alloc(8, 7), targetName: 'CORP', targetInfo: specTargetInfo() });
    const found = extractChallengeToken([
      'Bearer realm="Service",error="invalid_request"',
      `Negotiate ${token.toString('base64')}`,
    ], 'Negotiate');
    expect(found && hex(found)).toBe(hex(token));
  });

  it('a bare "Negotiate" is not a token but a restart', () => {
    // The server has discarded the handshake and starts over. Read as a token,
    // this would lead to a confusing follow-up error.
    expect(extractChallengeToken(['Negotiate', 'Basic realm="TM1"'], 'Negotiate')).toBeUndefined();
  });

  it('rejects a SPNEGO-wrapped token instead of reading it as NTLM', () => {
    // ASN.1 SEQUENCE (0x60) at the start: Kerberos over SPNEGO. This module
    // cannot do that, and processing it silently would produce nonsense.
    const spnego = Buffer.concat([Buffer.from([0x60, 0x82, 0x04, 0x00]), Buffer.alloc(64, 1)]);
    expect(extractChallengeToken([`Negotiate ${spnego.toString('base64')}`], 'Negotiate')).toBeUndefined();
  });
});

describe('splitDomainUser', () => {
  it.each([
    ['CORP\\mueller', 'CORP', 'mueller'],
    ['mueller@corp.example.com', 'corp.example.com', 'mueller'],
    ['mueller', '', 'mueller'],
  ])('%s', (login, domain, user) => {
    expect(splitDomainUser(login)).toEqual({ domain, user });
  });

  it('a leading backslash or @ does not count as a separator', () => {
    // Otherwise an empty user ID would result, which the server rejects as an
    // anonymous attempt — an error that is hard to read.
    expect(splitDomainUser('\\mueller')).toEqual({ domain: '', user: '\\mueller' });
    expect(splitDomainUser('@corp')).toEqual({ domain: '', user: '@corp' });
  });
});
