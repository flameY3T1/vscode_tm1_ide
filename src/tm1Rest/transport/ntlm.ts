// src/tm1Rest/transport/ntlm.ts
//
// NTLMv2 messages (MS-NLMP) for Windows authentication.
// Purely computational: builds and reads the three NTLMSSP messages, does
// NO I/O itself, and imports no `vscode` (depcruise `tm1rest-no-vscode`).
// Error messages therefore stay English; translation happens at the display site.
//
// WHY our own NTLM instead of a library or SSPI:
//
// Measured live on 2026-09-17 against the PAW gateway `core-paw` (Apache in
// front of it): an unauthenticated `GET /api/v1/tm1/Servers` answers with
//   WWW-Authenticate: Bearer realm="Service"
//   WWW-Authenticate: Negotiate
//   WWW-Authenticate: Basic realm="TM1"
// An NTLM Type 1 under the `Negotiate` scheme gets back a **raw** NTLMSSP
// Type 2 (signature "NTLMSSP\0", msgType 2, TargetName "CORP", flags
// 0xE2898235 with EXTENDED_SESSIONSECURITY + TARGET_INFO) — it is NOT
// SPNEGO-wrapped and it is not a Kerberos token. The server calls the scheme
// `Negotiate`, but underneath it speaks NTLM.
//
// Three decisions follow from this:
//  1. **No native module.** Kerberos is not involved on the wire, so
//     `kerberos`/`node-expose-sspi` would cost platform-specific VSIX
//     targets and ABI pinning against VS Code's Electron, without being
//     able to do anything that is needed here.
//  2. **No `curl.exe --negotiate`.** Verified live: curl 8.21 with SSPI
//     fails against exactly this server, because the SSPI package
//     `Negotiate` expects SPNEGO-wrapped tokens and cannot do anything with
//     a bare Type 2 — curl then starts over unauthenticated.
//  3. **MD4 by hand.** The NT hash is MD4(UTF-16LE(password)), and
//     `crypto.createHash('md4')` is no longer in the default provider under
//     OpenSSL 3. HMAC-MD5 remains available and is used.
//
// What is deliberately MISSING here: SIGN/SEAL and KEY_EXCH. With HTTP
// authentication, nothing is signed or sealed after the handshake — the
// negotiated session key stays unused. Type 1 therefore does not request
// these flags, and Type 3 carries an empty session key. Requesting less
// also means: RC4 (needed for the encrypted key exchange) is likewise not
// in the default provider under OpenSSL 3.

import { createHmac, randomBytes } from 'crypto';

/** Signature of every NTLMSSP message: "NTLMSSP\0". */
const SIGNATURE = Buffer.from('NTLMSSP\0', 'latin1');

/** NTLMSSP message types (MS-NLMP 2.2.1). */
const MSG_NEGOTIATE = 1;
const MSG_CHALLENGE = 2;
const MSG_AUTHENTICATE = 3;

/** The subset of NegotiateFlags this module needs (MS-NLMP 2.2.2.5). */
export const NtlmFlag = {
  UNICODE:                     0x00000001,
  OEM:                         0x00000002,
  REQUEST_TARGET:              0x00000004,
  NTLM:                        0x00000200,
  ALWAYS_SIGN:                 0x00008000,
  EXTENDED_SESSIONSECURITY:    0x00080000,
  TARGET_TYPE_DOMAIN:          0x00010000,
  TARGET_TYPE_SERVER:          0x00020000,
  TARGET_INFO:                 0x00800000,
  VERSION:                     0x02000000,
  SIGN:                        0x00000010,
  SEAL:                        0x00000020,
  NEGOTIATE_128:               0x20000000,
  KEY_EXCH:                    0x40000000,
  // 0x80000000 does not fit into a signed 32-bit number; as a numeric
  // literal this is uncritical in JS (doubles), but every combination must
  // be brought back into the unsigned range with `>>> 0`.
  NEGOTIATE_56:                0x80000000,
} as const;

/**
 * Flags for Type 1 and Type 3. Deliberately narrow:
 * - UNICODE, so all names go as UTF-16LE (OEM encoding is a source of
 *   errors with umlauts in usernames and brings no benefit).
 * - REQUEST_TARGET, so Type 2 sends TargetName and TargetInfo along —
 *   TargetInfo is mandatory for NTLMv2, it goes into the blob unchanged.
 * - NTLM + EXTENDED_SESSIONSECURITY: NTLMv2 instead of NTLMv1.
 * - ALWAYS_SIGN, because servers frequently require it; it costs nothing as
 *   long as SIGN/SEAL are not set (then nothing is ever actually signed).
 * Without SIGN, SEAL, KEY_EXCH — see header comment.
 */
export const NTLM_CLIENT_FLAGS =
  NtlmFlag.UNICODE
  | NtlmFlag.REQUEST_TARGET
  | NtlmFlag.NTLM
  | NtlmFlag.ALWAYS_SIGN
  | NtlmFlag.EXTENDED_SESSIONSECURITY
  // Key strength. Looks superfluous, because at the HTTP level nothing is
  // signed or sealed after the handshake — and it is not superfluous.
  //
  // The group policy "Network security: Minimum session security for
  // NTLM SSP based clients/servers" requires 128-bit encryption in
  // hardened AD environments (CIS benchmark). Where it is set, a session
  // in which NEGOTIATE_128 was never negotiated is rejected — with no
  // indication other than 401.
  //
  // Verified live on 2026-09-17: our first Type 1 left out both bits, the
  // server confirmed 0x02898205, and Type 3 was rejected even though it
  // was byte-identical to the one from Windows SSPI and the password was
  // provably correct.
  //
  // SIGN, SEAL and KEY_EXCH are DELIBERATELY NOT here. The test rig showed
  // that Windows does not negotiate them for HTTP authentication even when
  // the server offers them (challenge 0xE2898235 → SSPI answers
  // 0xA2888205). Requesting them was a wrong conclusion drawn from the
  // curl run: curl requests them, HttpWebRequest does not. The code can
  // do KEY_EXCH (see `withKeyExchange`), in case a server enforces it
  // after all — it is just not requested.
  | NtlmFlag.NEGOTIATE_128
  | NtlmFlag.NEGOTIATE_56;

/**
 * The flags for Type 3: the NEGOTIATION RESULT, not the wish.
 *
 * The intersection of what the client REQUESTED in Type 1 and what the
 * server CONFIRMED in Type 2 — plus `TARGET_INFO`, because the response
 * carries a TargetInfo, and `VERSION`, because the version field is
 * written.
 *
 * `requestedFlags` comes from the Type 1 message itself, not from a module
 * constant. That is the difference between "correct" and "correct by
 * coincidence": whoever builds Type 1 more broadly (e.g. with KEY_EXCH)
 * automatically gets the matching result here, and the two messages cannot
 * drift apart.
 *
 * Verified against measurement (ntlmSelfCheckProbe.mjs,
 * 2026-09-17), both cases match SSPI's value exactly:
 *   Challenge 0x02898205 → 0x02888205   (server does not offer 128/56)
 *   Challenge 0xE2898235 → 0xA2888205   (128/56 yes, SIGN/SEAL/KEY_EXCH no)
 */
function authenticateFlags(serverFlags: number, requestedFlags: number): number {
  const wanted = requestedFlags | NtlmFlag.TARGET_INFO | NtlmFlag.VERSION;
  return (wanted & (serverFlags | NtlmFlag.VERSION)) >>> 0;
}

/** Difference between the Windows FILETIME epoch (1601-01-01) and the Unix epoch, in milliseconds. */
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

// ---------------------------------------------------------------------------
// MD4 (RFC 1320)
// ---------------------------------------------------------------------------

const rotl = (v: number, s: number): number => ((v << s) | (v >>> (32 - s))) >>> 0;

/**
 * MD4 per RFC 1320. Used exclusively for the NT hash
 * (`MD4(UTF-16LE(password))`); `crypto.createHash('md4')` is no longer
 * available in the default provider under OpenSSL 3.
 *
 * MD4 is cryptographically broken. That is not a shortcoming here but the
 * protocol's own requirement: NTLM mandates exactly this derivation. The
 * function must therefore NOT be used for any other purpose.
 */
export function md4(message: Buffer): Buffer {
  // Padding like MD5: 0x80, zeros until length ≡ 56 (mod 64), then the
  // bit length as a 64-bit little-endian value.
  const tail = (message.length + 1) % 64;
  const zeros = tail <= 56 ? 56 - tail : 120 - tail;
  const padded = Buffer.alloc(message.length + 1 + zeros + 8);
  message.copy(padded, 0);
  padded[message.length] = 0x80;
  padded.writeBigUInt64LE(BigInt(message.length) * 8n, padded.length - 8);

  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  const x = new Array<number>(16);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) { x[i] = padded.readUInt32LE(offset + i * 4); }
    const [aa, bb, cc, dd] = [a, b, c, d];

    // Round 1: F(x,y,z) = (x AND y) OR (NOT x AND z), shifts 3/7/11/19.
    const f = (p: number, q: number, r: number): number => ((p & q) | (~p & r)) >>> 0;
    for (let i = 0; i < 16; i += 4) {
      a = rotl((a + f(b, c, d) + x[i]) >>> 0, 3);
      d = rotl((d + f(a, b, c) + x[i + 1]) >>> 0, 7);
      c = rotl((c + f(d, a, b) + x[i + 2]) >>> 0, 11);
      b = rotl((b + f(c, d, a) + x[i + 3]) >>> 0, 19);
    }

    // Round 2: G(x,y,z) = majority, constant 0x5a827999, shifts 3/5/9/13.
    const g = (p: number, q: number, r: number): number => ((p & q) | (p & r) | (q & r)) >>> 0;
    for (let i = 0; i < 4; i++) {
      a = rotl((a + g(b, c, d) + x[i] + 0x5a827999) >>> 0, 3);
      d = rotl((d + g(a, b, c) + x[i + 4] + 0x5a827999) >>> 0, 5);
      c = rotl((c + g(d, a, b) + x[i + 8] + 0x5a827999) >>> 0, 9);
      b = rotl((b + g(c, d, a) + x[i + 12] + 0x5a827999) >>> 0, 13);
    }

    // Round 3: H(x,y,z) = XOR, constant 0x6ed9eba1, shifts 3/9/11/15.
    const h = (p: number, q: number, r: number): number => (p ^ q ^ r) >>> 0;
    const order = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let i = 0; i < 16; i += 4) {
      a = rotl((a + h(b, c, d) + x[order[i]] + 0x6ed9eba1) >>> 0, 3);
      d = rotl((d + h(a, b, c) + x[order[i + 1]] + 0x6ed9eba1) >>> 0, 9);
      c = rotl((c + h(d, a, b) + x[order[i + 2]] + 0x6ed9eba1) >>> 0, 11);
      b = rotl((b + h(c, d, a) + x[order[i + 3]] + 0x6ed9eba1) >>> 0, 15);
    }

    a = (a + aa) >>> 0;
    b = (b + bb) >>> 0;
    c = (c + cc) >>> 0;
    d = (d + dd) >>> 0;
  }

  const out = Buffer.alloc(16);
  out.writeUInt32LE(a, 0);
  out.writeUInt32LE(b, 4);
  out.writeUInt32LE(c, 8);
  out.writeUInt32LE(d, 12);
  return out;
}

// ---------------------------------------------------------------------------
// RC4
// ---------------------------------------------------------------------------

/**
 * RC4 — needed for exactly one thing: encrypting the session key in the
 * `EncryptedRandomSessionKey` field, when `KEY_EXCH` was negotiated
 * (MS-NLMP 3.4.5.1 KXKEY / 3.1.5.1.2).
 *
 * Written by hand for the same reason as MD4: `crypto.createCipheriv('rc4')`
 * is not in the default provider under OpenSSL 3. RC4 is broken — as with
 * MD4, that is not a choice but the protocol's own requirement. The
 * function must NOT be used for any other purpose.
 *
 * RC4 is a stream cipher: encryption and decryption are the same operation.
 */
export function rc4(key: Buffer, data: Buffer): Buffer {
  if (key.length === 0) { throw new Error('RC4 key must not be empty'); }
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { s[i] = i; }
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 0xff;
    const t = s[i]; s[i] = s[j]; s[j] = t;
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  j = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    j = (j + s[a]) & 0xff;
    const t = s[a]; s[a] = s[j]; s[j] = t;
    out[k] = data[k] ^ s[(s[a] + s[j]) & 0xff];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

const utf16 = (s: string): Buffer => Buffer.from(s, 'utf16le');

/** NTOWFv1: `MD4(UTF-16LE(password))` — the classic NT hash. */
export function ntowfv1(password: string): Buffer {
  return md4(utf16(password));
}

/**
 * NTOWFv2 (MS-NLMP 3.3.2): `HMAC-MD5(NTOWFv1, UTF-16LE(UPPER(user) + domain))`.
 *
 * Two traps that are fixed in the protocol and both lead to an unexplained
 * 401 if violated:
 * - The **username is uppercased**, the **domain is not**.
 * - Both are concatenated without a separator.
 */
export function ntowfv2(user: string, password: string, domain: string): Buffer {
  return createHmac('md5', ntowfv1(password))
    .update(utf16(user.toUpperCase() + domain))
    .digest();
}

// ---------------------------------------------------------------------------
// Type 1 — NEGOTIATE
// ---------------------------------------------------------------------------

/**
 * Builds the NEGOTIATE message (Type 1).
 *
 * Domain and workstation stay empty. MS-NLMP explicitly allows this, and
 * the values are worthless: the server states the domain itself in Type 2
 * (`TargetName`), and a workstation name from `os.hostname()` would only
 * put the client's machine name on the wire needlessly.
 */
export function buildType1(flags: number = NTLM_CLIENT_FLAGS): Buffer {
  const msg = Buffer.alloc(32);
  SIGNATURE.copy(msg, 0);
  msg.writeUInt32LE(MSG_NEGOTIATE, 8);
  msg.writeUInt32LE(flags >>> 0, 12);
  // Domain (16..23) and Workstation (24..31) stay zero fields: length 0,
  // max length 0, offset 0 — no payload.
  return msg;
}

// ---------------------------------------------------------------------------
// Type 2 — CHALLENGE
// ---------------------------------------------------------------------------

/** AV_PAIR identifiers of the TargetInfo (MS-NLMP 2.2.2.1). */
export const AvId = {
  EOL:             0,
  NB_COMPUTER:     1,
  NB_DOMAIN:       2,
  DNS_COMPUTER:    3,
  DNS_DOMAIN:      4,
  DNS_TREE:        5,
  FLAGS:           6,
  TIMESTAMP:       7,
  SINGLE_HOST:     8,
  TARGET_NAME:     9,
  CHANNEL_BINDINGS: 10,
} as const;

/** Bit in AV_FLAGS that says: the AUTHENTICATE message carries a MIC. */
const AV_FLAG_MIC_PRESENT = 0x2;

export interface AvPair {
  id: number;
  value: Buffer;
}

/** Splits a TargetInfo into its AV_PAIRs. The trailing EOL pair is omitted. */
export function parseAvPairs(targetInfo: Buffer): AvPair[] {
  const pairs: AvPair[] = [];
  let p = 0;
  while (p + 4 <= targetInfo.length) {
    const id = targetInfo.readUInt16LE(p);
    const len = targetInfo.readUInt16LE(p + 2);
    if (id === AvId.EOL) { break; }
    if (p + 4 + len > targetInfo.length) {
      throw new Error(`NTLM target info is truncated: AV pair ${id} claims ${len} bytes past the end`);
    }
    pairs.push({ id, value: Buffer.from(targetInfo.subarray(p + 4, p + 4 + len)) });
    p += 4 + len;
  }
  return pairs;
}

/** Reassembles AV_PAIRs back into a TargetInfo and appends the EOL pair. */
export function encodeAvPairs(pairs: AvPair[]): Buffer {
  const parts = pairs.map(({ id, value }) => {
    const head = Buffer.alloc(4);
    head.writeUInt16LE(id, 0);
    head.writeUInt16LE(value.length, 2);
    return Buffer.concat([head, value]);
  });
  return Buffer.concat([...parts, Buffer.alloc(4)]);
}

export interface NtlmChallenge {
  /** The 8-byte ServerChallenge. */
  challenge: Buffer;
  /** NegotiateFlags the server confirmed. */
  flags: number;
  /** `TargetName` — the domain name when TARGET_TYPE_DOMAIN, otherwise the server name. */
  targetName: string;
  /** `TargetInfo` unchanged (the AV_PAIR list), exactly as it arrived on the wire. */
  targetInfo: Buffer;
  /**
   * `MsvAvTimestamp` from the TargetInfo, if present (8-byte FILETIME).
   *
   * This value decides THREE things in Type 3, and all three are laid down
   * in MS-NLMP 3.1.5.1.2 — ignoring them produces a 401 that looks like a
   * wrong password:
   *   1. The blob carries THIS timestamp, not the local clock.
   *   2. `LmChallengeResponse` is Z(24), not the LMv2 response.
   *   3. The message carries a MIC, and AV_FLAGS reports it.
   */
  serverTimestamp?: Buffer;
  /** The complete message as it arrived — feeds into the MIC computation. */
  raw: Buffer;
}

/** Reads a field from a security buffer descriptor (len, maxlen, offset). */
function readSecurityBuffer(msg: Buffer, at: number): Buffer {
  const len = msg.readUInt16LE(at);
  const offset = msg.readUInt32LE(at + 4);
  if (len === 0) { return Buffer.alloc(0); }
  if (offset + len > msg.length) {
    throw new Error(`NTLM challenge is truncated: field at ${at} points past the message end`);
  }
  return msg.subarray(offset, offset + len);
}

/**
 * Reads the CHALLENGE message (Type 2).
 *
 * Strict, because a silently misread field would otherwise land on the
 * user as a "wrong password": the signature and message type are checked,
 * and a security buffer pointing past the end throws.
 */
export function parseType2(msg: Buffer): NtlmChallenge {
  if (msg.length < 32) {
    throw new Error(`NTLM challenge is too short (${msg.length} bytes, need at least 32)`);
  }
  if (!msg.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('NTLM challenge does not start with the NTLMSSP signature');
  }
  const type = msg.readUInt32LE(8);
  if (type !== MSG_CHALLENGE) {
    throw new Error(`Expected an NTLM challenge (type 2) but got message type ${type}`);
  }

  const targetNameRaw = readSecurityBuffer(msg, 12);
  const flags = msg.readUInt32LE(20);
  const challenge = Buffer.from(msg.subarray(24, 32));
  // TargetInfo only exists from the extended form onward (48-byte header).
  // If it is missing, NTLMv2 is not possible — the blob needs the AV_PAIR list.
  const targetInfo = msg.length >= 48 ? Buffer.from(readSecurityBuffer(msg, 40)) : Buffer.alloc(0);
  const stamp = parseAvPairs(targetInfo).find((p) => p.id === AvId.TIMESTAMP && p.value.length === 8);

  return {
    challenge,
    flags,
    targetName: (flags & NtlmFlag.UNICODE)
      ? targetNameRaw.toString('utf16le')
      : targetNameRaw.toString('latin1'),
    targetInfo,
    serverTimestamp: stamp?.value,
    raw: Buffer.from(msg),
  };
}

// ---------------------------------------------------------------------------
// Type 3 — AUTHENTICATE
// ---------------------------------------------------------------------------

export interface Type3Input {
  challenge: NtlmChallenge;
  /** Username WITHOUT the domain part. */
  user: string;
  password: string;
  /** Domain (NetBIOS short form, e.g. `CORP`). Empty if the server does not expect one. */
  domain: string;
  /**
   * The Type 1 message belonging to this session. Needed for the MIC,
   * which runs over all THREE messages.
   */
  negotiateMessage: Buffer;
  /**
   * Service name of the target (`HTTP/<host>`), placed into the blob as
   * `MsvAvTargetName`. A Windows client always sends it along; servers with
   * service binding checks reject a response without it. Leaving it empty
   * means: no pair is appended.
   */
  targetSpn?: string;
  /**
   * `MsvAvChannelBindings` — exactly 16 bytes, or omit it.
   *
   * Omitting it means: the AV_PAIR is NOT appended at all. This matters,
   * because every additional pair changes the TargetInfo and therefore the
   * NTProofStr — appending it unconditionally would make the reference
   * value computed in MS-NLMP 4.2.4 unreachable, removing the only sharp
   * check on the computation.
   *
   * Over TLS a Windows client sends 16 zero bytes when no real binding is
   * in place; that is the sensible value for the production path. If the
   * server enforces Extended Protection, the real `tls-server-end-point`
   * value must go here (MD5 over the gss_channel_bindings structure with
   * the certificate hash).
   */
  channelBindings?: Buffer;
  /** Workstation name. Leave empty if the machine name should not go on the wire. */
  workstation?: string;
  /**
   * `MsvAvSingleHost` (Id 8) — a Windows client's self-report about its
   * machine (size, CustomData, MachineID).
   *
   * Only sent along if the caller supplies it. INVENTING it would be
   * pointless: the MachineID comes from the machine's registry and a made-up
   * value carries no meaning. A server does not check it (it serves to
   * detect that client and server are the same machine) — the field exists
   * here so the test rig can build a BYTE-IDENTICAL message and the
   * comparison against Windows stays meaningful.
   */
  singleHost?: Buffer;
  /**
   * Overrides the version field (8 bytes).
   *
   * The content is pure self-reporting and is not checked by any server —
   * the field exists here for the test rig: only with the SAME build number
   * as the running machine does the message become byte-identical to the
   * one from SSPI, and only then is the MIC comparable too (it computes
   * over the whole message, the version field included).
   */
  version?: Buffer;
  /** Tests only: fixed 8-byte ClientChallenge instead of random. */
  clientChallenge?: Buffer;
  /**
   * Tests and the test rig only: fixed ExportedSessionKey (16 bytes)
   * instead of random. Only takes effect when `KEY_EXCH` was negotiated.
   * The test rig recovers it by decrypting Windows's
   * `EncryptedRandomSessionKey` field with the KeyExchangeKey — RC4 is
   * symmetric — and can thereby build a byte-identical message.
   */
  exportedSessionKey?: Buffer;
  /**
   * Tests only: a fixed FILETIME. IGNORED if the challenge carries a
   * `MsvAvTimestamp` — then the server's value applies.
   */
  timestamp?: bigint;
}

/** Windows FILETIME (100-ns steps since 1601-01-01) for "now". */
function nowAsFiletime(): bigint {
  return (BigInt(Date.now()) + FILETIME_EPOCH_OFFSET_MS) * 10000n;
}

/**
 * Version field of the message (MS-NLMP 2.2.2.10). The content is pure
 * self-reporting and is not checked; NTLMRevisionCurrent must be 0x0F.
 */
function versionField(): Buffer {
  const v = Buffer.alloc(8);
  v[0] = 10;                  // ProductMajorVersion
  v[1] = 0;                   // ProductMinorVersion
  v.writeUInt16LE(19041, 2);  // ProductBuild
  v[7] = 0x0f;                // NTLMRevisionCurrent = NTLMSSP_REVISION_W2K3
  return v;
}

/**
 * Builds the AUTHENTICATE message (Type 3) with an NTLMv2 response.
 *
 * Basic construction per MS-NLMP 3.3.2:
 *   temp        = 0x01 0x01 0x00 0x00 | 4 zeros | timestamp | ClientChallenge
 *                 | 4 zeros | TargetInfo | 4 zeros
 *   NTProofStr  = HMAC-MD5(NTOWFv2, ServerChallenge | temp)
 *   NtResponse  = NTProofStr | temp
 *
 * DECISIVE is what happens when the challenge carries a `MsvAvTimestamp`.
 * MS-NLMP 3.1.5.1.2 then mandates three deviations, and a hardened server
 * (confirmed live against `core-paw` on 2026-09-17: Apache sends AV[7])
 * rejects a response that does not comply:
 *
 *   1. The blob carries the SERVER's timestamp, not the local clock.
 *      Using the local clock is the obvious reading of "timestamp" and
 *      exactly the mistake that produces a 401 that looks like a wrong
 *      password.
 *   2. `LmChallengeResponse` is **Z(24)** — 24 zero bytes — and NOT the
 *      LMv2 response. An included LM response is not a harmless extra
 *      here, but a violation.
 *   3. The message carries a **MIC** over all three messages, and
 *      `MsvAvFlags` reports it with bit 0x2.
 *
 * On top of that comes what a Windows client always includes anyway and
 * what servers with service or channel binding checks require:
 * `MsvAvTargetName` (the SPN) and `MsvAvChannelBindings`.
 *
 * The MIC needs the ExportedSessionKey. Without KEY_EXCH it equals the
 * SessionBaseKey = HMAC-MD5(NTOWFv2, NTProofStr) — so NO RC4 is needed,
 * which is likewise not in the default provider under OpenSSL 3.
 */
export function buildType3(input: Type3Input): Buffer {
  const { challenge, user, password, domain, negotiateMessage } = input;
  const clientChallenge = input.clientChallenge ?? randomBytes(8);
  if (clientChallenge.length !== 8) {
    throw new Error(`NTLM client challenge must be 8 bytes, got ${clientChallenge.length}`);
  }
  const { channelBindings } = input;
  if (channelBindings !== undefined && channelBindings.length !== 16) {
    throw new Error(`NTLM channel bindings must be 16 bytes, got ${channelBindings.length}`);
  }

  const responseKey = ntowfv2(user, password, domain);
  const withMic = challenge.serverTimestamp !== undefined;

  // Reassemble the TargetInfo: the server's pairs unchanged, then ours.
  // `MsvAvFlags` is merged instead of being appended twice.
  const pairs = parseAvPairs(challenge.targetInfo);
  if (withMic) {
    const existing = pairs.find((p) => p.id === AvId.FLAGS);
    const before = existing && existing.value.length >= 4 ? existing.value.readUInt32LE(0) : 0;
    const value = Buffer.alloc(4);
    value.writeUInt32LE((before | AV_FLAG_MIC_PRESENT) >>> 0, 0);
    if (existing) { existing.value = value; } else { pairs.push({ id: AvId.FLAGS, value }); }
  }
  // ORDER as in Windows: SingleHost, ChannelBindings, TargetName.
  // It is not arbitrary: the NTProofStr computes over the TargetInfo, so a
  // different order yields a different response. For the domain
  // controller's check this is irrelevant (it computes over exactly the
  // bytes that arrive) — but only with the same order is a BYTE-IDENTICAL
  // comparison with SSPI possible, and that is the only way to find
  // deviations without guessing against the real server.
  if (input.singleHost !== undefined) {
    pairs.push({ id: AvId.SINGLE_HOST, value: input.singleHost });
  }
  if (channelBindings !== undefined) {
    pairs.push({ id: AvId.CHANNEL_BINDINGS, value: channelBindings });
  }
  if (input.targetSpn) {
    pairs.push({ id: AvId.TARGET_NAME, value: utf16(input.targetSpn) });
  }
  const targetInfo = encodeAvPairs(pairs);

  const stamp = Buffer.alloc(8);
  if (challenge.serverTimestamp) {
    challenge.serverTimestamp.copy(stamp);
  } else {
    stamp.writeBigUInt64LE(input.timestamp ?? nowAsFiletime());
  }

  const temp = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00]),   // Responseversion + HiResponseversion + Reserved
    Buffer.alloc(4),                          // Reserved
    stamp,
    clientChallenge,
    Buffer.alloc(4),                          // Reserved
    targetInfo,
    Buffer.alloc(4),                          // Reserved
  ]);

  const ntProofStr = createHmac('md5', responseKey)
    .update(Buffer.concat([challenge.challenge, temp]))
    .digest();
  const ntResponse = Buffer.concat([ntProofStr, temp]);

  // SessionBaseKey; for NTLMv2 it is at the same time the KeyExchangeKey
  // (MS-NLMP 3.4.5.1: KXKEY = SessionBaseKey, when extended session security).
  const keyExchangeKey = createHmac('md5', responseKey).update(ntProofStr).digest();

  // With KEY_EXCH the CLIENT supplies the session key: a random value,
  // RC4-encrypted with the KeyExchangeKey in the `EncryptedRandomSessionKey`
  // field. The MIC then computes with THIS random value, not with the
  // SessionBaseKey. Without KEY_EXCH both are the same key and the field
  // stays empty.
  // The requested flags are in the Type 1 message the caller supplies —
  // it is needed for the MIC anyway. This way the negotiation cannot
  // diverge at a second place.
  if (negotiateMessage.length < 16 || !negotiateMessage.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('NTLM negotiate message (type 1) is missing or malformed');
  }
  const flags = authenticateFlags(challenge.flags, negotiateMessage.readUInt32LE(12));
  const withKeyExchange = (flags & NtlmFlag.KEY_EXCH) !== 0;
  const exportedSessionKey = withKeyExchange
    ? (input.exportedSessionKey ?? randomBytes(16))
    : keyExchangeKey;
  if (withKeyExchange && exportedSessionKey.length !== 16) {
    throw new Error(`NTLM session key must be 16 bytes, got ${exportedSessionKey.length}`);
  }

  const lmResponse = withMic
    ? Buffer.alloc(24)                        // Z(24), see point 2 above
    : Buffer.concat([
      createHmac('md5', responseKey)
        .update(Buffer.concat([challenge.challenge, clientChallenge]))
        .digest(),
      clientChallenge,
    ]);

  const domainBytes = utf16(domain);
  const userBytes = utf16(user);
  const workstationBytes = input.workstation ? utf16(input.workstation) : Buffer.alloc(0);
  const sessionKeyBytes = withKeyExchange
    ? rc4(keyExchangeKey, exportedSessionKey)
    : Buffer.alloc(0);

  // Header: 64 bytes of fields + 8 bytes version + (with MIC) 16 bytes MIC.
  // The offsets are absolute, so the payload starts after all of this.
  const HEADER = 64 + 8 + (withMic ? 16 : 0);
  const MIC_AT = 72;
  // The SIX security buffers sit in the header in the format's order
  // (LM, NT, Domain, User, Workstation, EncryptedRandomSessionKey) — nothing
  // about that is a choice.
  const parts = [lmResponse, ntResponse, domainBytes, userBytes, workstationBytes, sessionKeyBytes];
  // The LAYOUT in the payload area, in contrast, is free: only the offsets
  // matter. We lay it out in the order Windows uses it — Domain, User,
  // Workstation, then the two responses. This is not cosmetic: the MIC
  // computes over the entire message, so a different layout yields a
  // different message. Only with this layout is the result BYTE-IDENTICAL
  // to the one from SSPI, and only then can
  // ntlmSelfCheckProbe.mjs detect a deviation at all.
  // Measured 2026-09-17: Windows places Domain@88 User@94 Workstation@118
  // LM@142 NT@166.
  const PAYLOAD_ORDER = [2, 3, 4, 0, 1, 5];
  const msg = Buffer.alloc(HEADER + parts.reduce((n, p) => n + p.length, 0));
  SIGNATURE.copy(msg, 0);
  msg.writeUInt32LE(MSG_AUTHENTICATE, 8);

  let offset = HEADER;
  for (const i of PAYLOAD_ORDER) {
    const part = parts[i];
    const at = 12 + i * 8;
    msg.writeUInt16LE(part.length, at);
    msg.writeUInt16LE(part.length, at + 2);
    // Even an EMPTY field gets the current write position as its offset,
    // not 0. Windows does it this way (measured 2026-09-17: the empty
    // EncryptedRandomSessionKey carries offset 504 = end of the message),
    // and because the MIC computes over the whole message, a 0 here was
    // the last remaining byte difference from SSPI — two bytes that made
    // the MIC differ. Functionally both are equivalent, a reader reads by
    // length anyway; only this form is provably identical.
    msg.writeUInt32LE(offset, at + 4);
    part.copy(msg, offset);
    offset += part.length;
  }
  msg.writeUInt32LE(flags, 60);
  if (input.version !== undefined && input.version.length !== 8) {
    throw new Error(`NTLM version field must be 8 bytes, got ${input.version.length}`);
  }
  (input.version ?? versionField()).copy(msg, 64);

  if (withMic) {
    // The MIC runs over Type 1 | Type 2 | Type 3, with the MIC field in
    // Type 3 set to zero while computing (it is still unset at that point).
    createHmac('md5', exportedSessionKey)
      .update(Buffer.concat([negotiateMessage, challenge.raw, msg]))
      .digest()
      .copy(msg, MIC_AT);
  }
  return msg;
}

// ---------------------------------------------------------------------------
// Header lines
// ---------------------------------------------------------------------------

/** Scheme under which the NTLM tokens travel. The same server can offer both. */
export type NtlmScheme = 'Negotiate' | 'NTLM';

/**
 * Picks, from the offered schemes, the one under which NTLM should run.
 *
 * `Negotiate` wins over `NTLM`, because a server offering both expects the
 * stronger negotiation under `Negotiate` — and because the PAW gateway, in
 * the measurement from 2026-09-17, exclusively offers `Negotiate` but
 * speaks raw NTLMSSP underneath. `Basic` and `Bearer` in the same list are
 * ignored; they are other paths to the same goal, not part of this one.
 *
 * `undefined` means: the server offers no NTLM-capable scheme. That is a
 * configuration finding, not a login error, and must be reported as such.
 */
export function pickNtlmScheme(wwwAuthenticate: string[] | string | undefined): NtlmScheme | undefined {
  const values = wwwAuthenticate === undefined
    ? []
    : (Array.isArray(wwwAuthenticate) ? wwwAuthenticate : [wwwAuthenticate]);
  // A single header line can carry several schemes, comma-separated.
  const schemes = values
    .flatMap((v) => v.split(','))
    .map((v) => v.trim().split(/\s+/, 1)[0].toLowerCase());
  if (schemes.includes('negotiate')) { return 'Negotiate'; }
  if (schemes.includes('ntlm')) { return 'NTLM'; }
  return undefined;
}

/**
 * Fetches the NTLM token from the `WWW-Authenticate` header lines of the
 * 401 response.
 *
 * Only lines of the expected scheme are considered, and a line without a
 * token (a blank `WWW-Authenticate: Negotiate`) is not an error but a
 * prompt to start over — it returns `undefined`.
 */
export function extractChallengeToken(
  wwwAuthenticate: string[] | string | undefined,
  scheme: NtlmScheme,
): Buffer | undefined {
  const values = wwwAuthenticate === undefined
    ? []
    : (Array.isArray(wwwAuthenticate) ? wwwAuthenticate : [wwwAuthenticate]);
  const prefix = scheme.toLowerCase();
  for (const raw of values) {
    const line = raw.trim();
    if (!line.toLowerCase().startsWith(prefix)) { continue; }
    const token = line.slice(scheme.length).trim();
    if (token === '') { continue; }
    let decoded: Buffer;
    try {
      decoded = Buffer.from(token, 'base64');
    } catch {
      continue;
    }
    // Only a genuine NTLMSSP token counts. A SPNEGO-wrapped Kerberos token
    // starts with an ASN.1 SEQUENCE (0x60) and is discarded here — silently
    // reading it as NTLM would otherwise cause confusing follow-up errors.
    if (decoded.length >= 8 && decoded.subarray(0, 8).equals(SIGNATURE)) {
      return decoded;
    }
  }
  return undefined;
}

/**
 * Raw token of a `WWW-Authenticate` line, WITHOUT format checking.
 *
 * For the SSPI path: there, the security package decides what it does with
 * the bytes, and a Kerberos exchange is SPNEGO (ASN.1, starts with `0x60`),
 * not NTLMSSP. `extractChallengeToken` stays strict alongside this, because
 * the hand-computed path requires an NTLM Type 2.
 */
export function extractSchemeToken(
  values: string[] | string | undefined,
  scheme: NtlmScheme,
): Buffer | undefined {
  const list = values === undefined ? [] : (Array.isArray(values) ? values : [values]);
  const prefix = scheme.toLowerCase();
  for (const raw of list) {
    const line = raw.trim();
    if (!line.toLowerCase().startsWith(prefix)) { continue; }
    const token = line.slice(scheme.length).trim();
    // A bare challenge with no token (`Negotiate, Basic realm="TM1"`)
    // carries only the rest of the list here — not base64.
    if (token === '' || token.startsWith(',')) { continue; }
    const decoded = Buffer.from(token, 'base64');
    if (decoded.length > 0) { return decoded; }
  }
  return undefined;
}

/** Finished `Authorization` value for an NTLM message. */
export function authorizationHeader(scheme: NtlmScheme, message: Buffer): string {
  return `${scheme} ${message.toString('base64')}`;
}

/**
 * The channel binding (`tls-server-end-point`, RFC 5929) has lived in
 * `ntlmChannelBinding.ts` since 2026-09-20. It has NO caller in production
 * code: `integratedSession.ts` passes the empty anchor `Buffer.alloc(16)`.
 * Whoever enables Extended Protection fetches it from there.
 */


/**
 * Splits a login of the form `DOMAIN\user` or `user@domain`.
 * Without a domain part, `domain` stays empty — then the caller decides
 * whether to use the `TargetName` from Type 2 instead.
 */
export function splitDomainUser(login: string): { domain: string; user: string } {
  const backslash = login.indexOf('\\');
  if (backslash > 0) {
    return { domain: login.slice(0, backslash), user: login.slice(backslash + 1) };
  }
  const at = login.indexOf('@');
  if (at > 0) {
    return { domain: login.slice(at + 1), user: login.slice(0, at) };
  }
  return { domain: '', user: login };
}
