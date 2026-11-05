// src/tm1Rest/transport/ntlmChannelBinding.ts
//
// Channel binding `tls-server-end-point` (RFC 5929) — the computation a
// server with Extended Protection for Authentication (EPA) expects.
//
// LIVES HERE AND NOT IN `ntlm.ts`, because the production code does NOT call
// it: `transport/integratedSession.ts` deliberately passes
// `channelBindings: Buffer.alloc(16)`, i.e. the empty anchor. That makes this
// file, along with its small DER parser, unreachable — until 2026-09-20 it
// sat right in the middle of `ntlm.ts`, between what actually runs, and every
// refactor first had to figure out that it has no caller.
//
// Kept, not deleted: whoever turns on EPA needs exactly this, and the
// computation is checked against RFC 5929 (tests in `ntlm.test.ts`).
// MD5 at the end is not our choice but the protocol's requirement; the
// binding is an integrity anchor in the handshake, not a secrecy measure.
import { createHash } from 'crypto';

/**
 * `MsvAvChannelBindings` for `tls-server-end-point` (RFC 5929) from the
 * server certificate — the value a server with Extended Protection for
 * Authentication (EPA) expects.
 *
 * Structure (RFC 5929 §4.1 + MS-NLMP 2.2.2.1):
 *   applicationData = "tls-server-end-point:" | Hash(DER certificate)
 *   gss_channel_bindings_struct = 4x0 (initiator/acceptor address types and
 *     lengths, all empty) | length(applicationData) | applicationData
 *   Result = MD5(gss_channel_bindings_struct)
 *
 * The hash is that of the certificate signature. RFC 5929 explicitly
 * excludes MD5 and SHA-1 and mandates SHA-256 instead — hence SHA-256 is the
 * default here, and `signatureHash` only exists for the cases where a
 * certificate is signed with SHA-384/512.
 *
 * MD5 at the end is not our choice but the protocol's requirement; the
 * binding is an integrity anchor in the handshake, not a secrecy measure.
 */
export function tlsServerEndPointBinding(
  derCertificate: Buffer,
  signatureHash: 'sha256' | 'sha384' | 'sha512' = 'sha256',
): Buffer {
  const certHash = createHash(signatureHash).update(derCertificate).digest();
  const applicationData = Buffer.concat([Buffer.from('tls-server-end-point:', 'latin1'), certHash]);
  const struct = Buffer.alloc(20 + applicationData.length);
  // initiator_addtype, initiator_address_length, acceptor_addrtype,
  // acceptor_address_length stay 0 — HTTP does not embed any addresses.
  struct.writeUInt32LE(applicationData.length, 16);
  applicationData.copy(struct, 20);
  return createHash('md5').update(struct).digest();
}

/**
 * Chooses the hash for `tls-server-end-point` from the certificate's
 * signature algorithm. RFC 5929: MD5 and SHA-1 are raised to SHA-256,
 * everything else keeps its strength.
 */
export function endPointHashFor(signatureAlgorithm: string | undefined): 'sha256' | 'sha384' | 'sha512' {
  const a = (signatureAlgorithm ?? '').toLowerCase();
  if (a.includes('sha512') || a.includes('sha-512')) { return 'sha512'; }
  if (a.includes('sha384') || a.includes('sha-384')) { return 'sha384'; }
  return 'sha256';
}

/**
 * Reads the signature algorithm (as an OID string) from a DER certificate.
 *
 * Node does not expose the algorithm via `tls.TLSSocket#getPeerCertificate`
 * nor via `crypto.X509Certificate` — but it is needed for
 * `tls-server-end-point`, because RFC 5929 binds the hash to it. A wrong
 * hash produces a formally valid, but substantively wrong, binding: the
 * server rejects it, and the rejection looks like a wrong password.
 *
 * Only the structure is read, no content:
 *   Certificate ::= SEQUENCE { tbsCertificate, signatureAlgorithm, signature }
 *   AlgorithmIdentifier ::= SEQUENCE { algorithm OBJECT IDENTIFIER, ... }
 * So: open the outer SEQUENCE, skip the first element (tbsCertificate),
 * read the OID in the second one. `undefined` on anything unexpected — the
 * caller then falls back to SHA-256, which RFC 5929 sets as the floor anyway.
 */
export function certificateSignatureOid(der: Buffer): string | undefined {
  /** Reads the tag and content bounds of a DER element starting at `at`. */
  const read = (at: number): { tag: number; from: number; to: number } | undefined => {
    if (at + 2 > der.length) { return undefined; }
    const tag = der[at];
    let len = der[at + 1];
    let from = at + 2;
    if (len & 0x80) {
      const n = len & 0x7f;
      // Indefinite length (0x80) does not exist in DER, and more than 4
      // bytes of length encoding does not occur in certificates.
      if (n === 0 || n > 4 || from + n > der.length) { return undefined; }
      len = 0;
      for (let i = 0; i < n; i++) { len = (len << 8) | der[from + i]; }
      from += n;
    }
    const to = from + len;
    return to <= der.length ? { tag, from, to } : undefined;
  };

  const outer = read(0);
  if (!outer || outer.tag !== 0x30) { return undefined; }
  const tbs = read(outer.from);
  if (!tbs || tbs.tag !== 0x30) { return undefined; }
  const algId = read(tbs.to);
  if (!algId || algId.tag !== 0x30) { return undefined; }
  const oid = read(algId.from);
  if (!oid || oid.tag !== 0x06 || oid.to - oid.from < 1) { return undefined; }

  // OID bytes into dotted notation: the first byte carries two components,
  // after that base-128 with a continuation bit.
  const bytes = der.subarray(oid.from, oid.to);
  const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40];
  let acc = 0;
  for (const b of bytes.subarray(1)) {
    acc = acc * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) { parts.push(acc); acc = 0; }
  }
  return parts.join('.');
}

/** OIDs whose hash for `tls-server-end-point` deviates from SHA-256. */
const SIGNATURE_OID_HASH: Record<string, 'sha384' | 'sha512'> = {
  '1.2.840.113549.1.1.12': 'sha384',   // sha384WithRSAEncryption
  '1.2.840.113549.1.1.13': 'sha512',   // sha512WithRSAEncryption
  '1.2.840.10045.4.3.3':   'sha384',   // ecdsa-with-SHA384
  '1.2.840.10045.4.3.4':   'sha512',   // ecdsa-with-SHA512
};

/**
 * The hash that `tls-server-end-point` requires for THIS certificate.
 * Everything that is not explicitly SHA-384/512 runs through SHA-256 —
 * including SHA-1- and MD5-signed certificates, as RFC 5929 requires.
 */
export function endPointHashForCertificate(der: Buffer): 'sha256' | 'sha384' | 'sha512' {
  const oid = certificateSignatureOid(der);
  if (oid === undefined) { return 'sha256'; }
  return SIGNATURE_OID_HASH[oid] ?? 'sha256';
}
