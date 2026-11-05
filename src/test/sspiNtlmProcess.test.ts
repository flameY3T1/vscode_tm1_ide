// src/test/sspiNtlmProcess.test.ts
//
// The PROCESS LAYER of the SSPI handshake — platform-independent.
//
// `sspiNtlm.test.ts` checks the shape of the messages and depends on Windows
// for that (`describe.skipIf(!win)`); on Linux CI only the platform lock of it
// ran. What stayed unchecked was exactly what, according to the header of
// `sspiNtlm.ts`, bites in practice: the start fails, the process does not
// answer, it reports an error, it closes its reading end.
//
// What gets injected is `spawn`, not the process. The stand-in is a real Node
// process (`node -e`), so that streams, events, `kill` and the timers are the
// REAL machinery. A mock would have checked here whether our idea of `spawn`
// matches our idea of `spawn`.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { describe, it, expect } from 'vitest';

import { startSspiHandshake } from '../tm1Rest/transport/sspiNtlm';

/** A temp area of its own per test — counting in the shared one proves nothing. */
function ownRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-sspi-proc-'));
}

/**
 * A stand-in instead of `powershell.exe`. The body is JavaScript and runs in a
 * Node process of its own; `cmd` and `args` of the real call are discarded,
 * everything else stays real.
 */
function standIn(body: string): typeof spawn {
  return ((): ChildProcessWithoutNullStreams =>
    spawn(process.execPath, ['-e', body], {
      stdio: ['pipe', 'pipe', 'pipe'],
    }) as ChildProcessWithoutNullStreams) as unknown as typeof spawn;
}

/** The two lines that a successful start prints. */
const GREETING = "console.log('TYPE1 VFlQRTE='); console.log('USER DOMAIN\\\\user');";

const WIN = { platform: 'win32' as const };

describe('SSPI process layer: the start fails', () => {
  it('tries three times and names the LAST error', async () => {
    const root = ownRoot();
    let calls = 0;
    const failing = ((): ChildProcessWithoutNullStreams => {
      calls += 1;
      throw new Error(`EPERM attempt ${calls}`);
    }) as unknown as typeof spawn;

    await expect(
      startSspiHandshake('HTTP/gw', root, 'NTLM',
        { ...WIN, spawn: failing, retryDelayMs: 1 }),
    ).rejects.toThrow(/3 attempts\): EPERM attempt 3/);
    expect(calls).toBe(3);
    // The error path cleans up its directory itself.
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('names endpoint protection as a possible cause', async () => {
    const root = ownRoot();
    const failing = (() => { throw new Error('EPERM'); }) as unknown as typeof spawn;
    await expect(
      startSspiHandshake('HTTP/gw', root, 'NTLM',
        { ...WIN, spawn: failing, retryDelayMs: 1 }),
    ).rejects.toThrow(/endpoint protection/i);
  });
});

describe('SSPI process layer: the process speaks up', () => {
  it('passes an ERR line through as an error and cleans up', async () => {
    const root = ownRoot();
    await expect(
      startSspiHandshake('HTTP/gw', root, 'NTLM', {
        ...WIN,
        spawn: standIn("console.log('ERR AcquireCredentialsHandle failed: 0x8009030E');"),
      }),
    ).rejects.toThrow(/failed: AcquireCredentialsHandle failed: 0x8009030E/);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('reports a process that ends without a token — with its stderr line', async () => {
    const root = ownRoot();
    await expect(
      startSspiHandshake('HTTP/gw', root, 'NTLM', {
        ...WIN,
        spawn: standIn("console.error('Add-Type : cannot compile'); process.exit(1);"),
      }),
    ).rejects.toThrow(/produced no TYPE1 token: Add-Type : cannot compile/);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe('SSPI process layer: the timeout', () => {
  it('kills the hanging process and makes `authenticate` throw', async () => {
    const root = ownRoot();
    // Greets properly, then never answers: exactly the case the timer is
    // there for.
    const hs = await startSspiHandshake('HTTP/gw', root, 'NTLM', {
      ...WIN,
      spawn: standIn(`${GREETING} setTimeout(() => {}, 60000);`),
      timeoutMs: 200,
    });
    expect(hs.identity).toBe('DOMAIN\\user');
    await expect(hs.authenticate(Buffer.from('challenge'))).rejects
      .toThrow(/produced no TYPE3 token/);
    hs.dispose();
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe('SSPI process layer: the closed reading end (A1)', () => {
  it('turns EPIPE into an error, not an unhandled exception', async () => {
    const root = ownRoot();
    const seen: unknown[] = [];
    const onUncaught = (err: unknown): void => { seen.push(err); };
    process.on('uncaughtException', onUncaught);
    try {
      // The process closes fd 0 and KEEPS LIVING. Writing the challenge
      // therefore hits a closed pipe — without the listener on `child.stdin`
      // this is an `uncaughtException` in the extension host, and the
      // handshake hangs until the timeout.
      const hs = await startSspiHandshake('HTTP/gw', root, 'NTLM', {
        ...WIN,
        spawn: standIn(
          `require('fs').closeSync(0); ${GREETING} setTimeout(() => {}, 60000);`,
        ),
        // Deliberately far above the duration of the test: if it still passes,
        // it was the listener and not the timer.
        timeoutMs: 30_000,
      });
      await expect(hs.authenticate(Buffer.from('challenge'))).rejects
        .toThrow(/produced no TYPE3 token/);
      hs.dispose();
    } finally {
      process.off('uncaughtException', onUncaught);
    }
    expect(seen).toEqual([]);
    expect(fs.readdirSync(root)).toEqual([]);
  });
});

describe('SSPI process layer: the successful path', () => {
  it('returns token and identity and removes the script', async () => {
    const root = ownRoot();
    const hs = await startSspiHandshake('HTTP/gw', root, 'NTLM', {
      ...WIN,
      spawn: standIn(
        `${GREETING}`
        + ` process.stdin.once('data', () => { console.log('TYPE3 VFlQRTM='); });`,
      ),
    });
    expect(hs.negotiate.toString()).toBe('TYPE1');
    expect(hs.identity).toBe('DOMAIN\\user');
    // The script is gone as soon as Type 1 is there — not only at the end.
    expect(fs.readdirSync(root)).toEqual([]);
    const type3 = await hs.authenticate(Buffer.from('challenge'));
    expect(type3.toString()).toBe('TYPE3');
    hs.dispose();
  });
});
