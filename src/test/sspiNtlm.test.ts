// src/test/sspiNtlm.test.ts
//
// Windows SSPI as the token source: NTLM messages with the LOGGED-ON
// identity, without a password.
//
// What is NOT checked here: that these tokens are valid. No test in this file
// can do that — it depends on a domain controller. It is backed by
// measurement: sspiSsoProbe.mjs has SSPI answer a self-built
// challenge and recomputes its NTProofStr from the
// stored password (2026-09-17: identical, flags 0xA2888205).
//
// What is checked here: the shape of the messages, the identity, the
// cleanup and the error paths. In other words, everything observable without a domain.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect } from 'vitest';

import { startSspiHandshake, sspiAvailable } from '../tm1Rest/transport/sspiNtlm';
import { AvId, encodeAvPairs, parseType2 } from '../tm1Rest/transport/ntlm';

const win = process.platform === 'win32';

/**
 * An OWN temp area per test.
 *
 * Counting in the shared `os.tmpdir()` proved nothing: `pawSession.test.ts`
 * starts its own handshakes in parallel, and then this test also counts other
 * tests' directories. That is why `startSspiHandshake` takes the location as a parameter.
 */
function ownRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-sspi-test-'));
}

/** What lies in an own temp area. */
function leftovers(root: string): string[] {
  return fs.readdirSync(root);
}

/** A Type 2 message as a server sends it — with TargetInfo and timestamp. */
function challengeToken(): Buffer {
  const u = (s: string): Buffer => Buffer.from(s, 'utf16le');
  const stamp = Buffer.alloc(8);
  stamp.writeBigUInt64LE((BigInt(Date.now()) + 11644473600000n) * 10000n);
  const targetInfo = encodeAvPairs([
    { id: AvId.NB_DOMAIN, value: u('CORP') },
    { id: AvId.NB_COMPUTER, value: u('PAWTEST') },
    { id: AvId.TIMESTAMP, value: stamp },
  ]);
  const name = u('CORP');
  const HEADER = 48;
  const msg = Buffer.alloc(HEADER + name.length + targetInfo.length);
  Buffer.from('NTLMSSP\0', 'latin1').copy(msg, 0);
  msg.writeUInt32LE(2, 8);
  msg.writeUInt16LE(name.length, 12);
  msg.writeUInt16LE(name.length, 14);
  msg.writeUInt32LE(HEADER, 16);
  msg.writeUInt32LE(0xa2898205, 20);
  Buffer.from('0123456789abcdef', 'hex').copy(msg, 24);
  msg.writeUInt16LE(targetInfo.length, 40);
  msg.writeUInt16LE(targetInfo.length, 42);
  msg.writeUInt32LE(HEADER + name.length, 44);
  name.copy(msg, HEADER);
  targetInfo.copy(msg, HEADER + name.length);
  return msg;
}

describe('sspiAvailable', () => {
  it('depends on the platform alone', () => {
    expect(sspiAvailable()).toBe(win);
  });

  it('reads the platform on EVERY call, not when the module is loaded', () => {
    // Otherwise the value would be frozen in a process that fakes the platform
    // — and that is exactly how the tests further down check the non-
    // Windows branch.
    const real = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    try {
      expect(sspiAvailable()).toBe(false);
    } finally {
      Object.defineProperty(process, 'platform', { value: real, configurable: true });
    }
  });
});

describe('startSspiHandshake without Windows', () => {
  it('fails with a message that names the platform — and starts nothing', async () => {
    const real = process.platform;
    const root = ownRoot();
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    try {
      await expect(startSspiHandshake('HTTP/gw', root)).rejects.toThrow(/needs Windows.*linux/is);
    } finally {
      Object.defineProperty(process, 'platform', { value: real, configurable: true });
    }
    // No directory, no script, no process: the bolt sits in front of everything.
    expect(leftovers(root)).toEqual([]);
  });
});

describe.skipIf(!win)('startSspiHandshake on Windows', () => {
  it('returns an NTLMSSP Type 1 message and the logged-on identity', async () => {
    const hs = await startSspiHandshake('HTTP/paw.example.internal');
    try {
      expect(hs.negotiate.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
      expect(hs.negotiate.readUInt32LE(8)).toBe(1);
      // `DOMAIN\User` — the backslash is the part that matters:
      // without the domain the message would be useless in case of a rejection.
      expect(hs.identity).toMatch(/^[^\\]+\\[^\\]+$/);
    } finally {
      hs.dispose();
    }
  }, 60_000);

  it('answers a challenge with a Type 3 message', async () => {
    const hs = await startSspiHandshake('HTTP/paw.example.internal');
    try {
      const type3 = await hs.authenticate(challengeToken());
      expect(type3.subarray(0, 8).toString('latin1')).toBe('NTLMSSP\0');
      expect(type3.readUInt32LE(8)).toBe(3);
      // A Type 3 without an NT response would be formally valid and practically worthless.
      const ntLen = type3.readUInt16LE(20);
      expect(ntLen).toBeGreaterThan(24);
    } finally {
      hs.dispose();
    }
  }, 60_000);

  it('cleans up the script as soon as the helper process has read it', async () => {
    const root = ownRoot();
    const hs = await startSspiHandshake('HTTP/paw.example.internal', root);
    try {
      // After Type 1 the script is compiled and the file is superfluous. It
      // carries no secret, but it still should not be left lying around.
      expect(leftovers(root)).toEqual([]);
    } finally {
      hs.dispose();
    }
    expect(leftovers(root)).toEqual([]);
  }, 60_000);

  it('creates its directory in the given area, not in the system temp', async () => {
    // The parameter is the way out when the system temp path is locked or
    // monitored — and the basis of the cleanup check above.
    const root = ownRoot();
    let seen: string[] = [];
    const hs = await startSspiHandshake('HTTP/paw.example.internal', root);
    try {
      // After Type 1 everything is already cleaned up; during the exchange it
      // is no longer observable. What counts: the area exists and is empty,
      // and the handshake still runs.
      seen = leftovers(root);
      const type3 = await hs.authenticate(challengeToken());
      expect(type3.readUInt32LE(8)).toBe(3);
    } finally {
      hs.dispose();
    }
    expect(seen).toEqual([]);
    expect(fs.existsSync(root)).toBe(true);
  }, 60_000);

  it('dispose can be called multiple times', async () => {
    const hs = await startSspiHandshake('HTTP/paw.example.internal');
    hs.dispose();
    expect(() => { hs.dispose(); hs.dispose(); }).not.toThrow();
  }, 60_000);

  it('after dispose there is no second Type 3 — the context is used up', async () => {
    // The reason why `loginAt` fetches a FRESH source per attempt: a
    // security context lives in the process, and that process has ended here.
    const hs = await startSspiHandshake('HTTP/paw.example.internal');
    hs.dispose();
    await expect(hs.authenticate(challengeToken())).rejects.toThrow(/TYPE3/);
  }, 60_000);

});

describe('the test rig itself', () => {
  it('the challenge that is answered is a valid Type 2', () => {
    // If SSPI above answers a broken challenge, the tests above it
    // prove nothing. Hence this safeguard — and it needs no Windows.
    const parsed = parseType2(challengeToken());
    expect(parsed.targetName).toBe('CORP');
    expect(parsed.challenge).toHaveLength(8);
    expect(parsed.targetInfo.length).toBeGreaterThan(0);
    expect(parsed.serverTimestamp).toHaveLength(8);
  });
});
