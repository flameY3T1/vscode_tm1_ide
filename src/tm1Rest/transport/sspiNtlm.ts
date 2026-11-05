// src/tm1Rest/transport/sspiNtlm.ts
//
// Fetches NTLM tokens from Windows SSPI — with the LOGGED-IN identity and
// WITHOUT a password. This is the difference between "typing in Windows
// credentials" and real single sign-on.
//
// No `vscode` (`tm1rest-no-vscode`), error messages in English.
//
// ── Why a helper process and not a native module ───────────────────────────
//
// Producing the tokens without a password means calling `AcquireCredentialsHandle`
// with the default credentials and `InitializeSecurityContext` — Windows system
// calls. Node can only reach them through a native module (`node-expose-sspi`,
// `kerberos`), and that costs platform-specific VSIX targets plus ABI pinning
// against VS Code's Electron: a rebuild on every Electron bump.
//
// The detour through `powershell.exe` with embedded C# costs nothing at build
// or ship time, in contrast. The script travels as a STRING inside the bundle.
//
// ── Why a file and not -EncodedCommand ─────────────────────────────────────
//
// The first version passed the script as `-EncodedCommand`, i.e. on the
// command line — no file, no path, and the execution policy does not apply
// at all. This is the more elegant construction and it is unusable: base64
// in UTF-16LE turns a 5.7 KB script into a 15 KB long command line, and
// `spawn` failed with `EPERM` 10 out of 10 times on that path in the
// realistic environment (measured 2026-09-17). It could NOT be reproduced in
// isolation — the same line from a small script started without issue. The
// cause therefore remains unresolved; presumably some endpoint protection
// reads long PowerShell command lines as an attack pattern.
//
// What is measured: with a script file and `-File` the command line stays
// short, and the same path then ran through 5 out of 5 times — passwordless,
// through the real gateway, 2.9 to 3.3 seconds per login (2026-09-17). So
// this is the approach. An unexplained but reproducible source of failure in
// the login path is worse than a file in the temp directory.
//
// The file carries no secret (the identity comes from Windows, not from the
// script), lives in its own directory under `os.tmpdir()` — user-specific on
// Windows — and is deleted immediately after the process starts.
//
// ── The package choice ──────────────────────────────────────────────────────
//
// `NTLM` delivers raw NTLMSSP, `Negotiate` wraps it in SPNEGO and can
// therefore also do Kerberos. The PAW gateway and TM1 11.8 speak raw
// NTLMSSP — this is what `curl --negotiate` failed on (measured
// 2026-09-17). A server with a registered SPN, on the other hand, itself
// answers in SPNEGO; that is why the package is a parameter and not a
// constant: the caller first tries `Negotiate` (Kerberos) and falls back to
// `NTLM`.
//
// ── Why ONE process for both legs ───────────────────────────────────────────
//
// An SSPI security context lives inside the process. Producing Type 1 and
// Type 3 in two separate calls loses it in between. The process therefore
// stays alive for the whole handshake and is fed through the standard
// channels.
//
// ── Proof that this works ───────────────────────────────────────────────────
//
// sspiSsoProbe.mjs has SSPI answer a self-built challenge and
// recomputes its NTProofStr from the stored password. Measured 2026-09-17:
// identical, flags 0xA2888205 — exactly what our own computation also
// produces. The tokens are interchangeable.

import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { errMsg } from '../../utils/errMsg';

/** Deadline for the whole handshake, including process start and C# compilation. */
const SSPI_TIMEOUT_MS = 30_000;

/**
 * Start attempts. `EPERM` on process start has been observed in this
 * environment (see header comment); a second attempt costs nothing and
 * covers a one-off glitch. If it persists, the message is unambiguous.
 */
const SPAWN_ATTEMPTS = 3;
/** Pause between two start attempts. */
const SPAWN_RETRY_DELAY_MS = 150;

/**
 * The PowerShell part. Travels along as a string, see header comment.
 *
 * Flow over the standard channels — line by line, so Node can read along
 * without first having to end the process:
 *   → TYPE1 <base64>
 *   → USER  <domain\user>
 *   ← <base64 of the challenge>
 *   → TYPE3 <base64>
 * Errors travel the same path as `ERR <text>` — on a .NET error, PowerShell's
 * standard error output carries a multi-page exception that is unusable as a
 * message for the user.
 */
function script(targetB64: string, packageName: SspiPackage): string {
  return `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SspiNtlm {
    const int SECPKG_CRED_OUTBOUND  = 2;
    const int SECURITY_NATIVE_DREP  = 0x10;
    const int SECBUFFER_TOKEN       = 2;
    const int SEC_E_OK              = 0;
    const int SEC_I_CONTINUE_NEEDED = 0x00090312;
    const int ISC_REQ_CONNECTION    = 0x00000800;
    const int TOKEN_MAX             = 16384;
    [StructLayout(LayoutKind.Sequential)] public struct SecHandle { public IntPtr dwLower; public IntPtr dwUpper; }
    [StructLayout(LayoutKind.Sequential)] public struct TimeStamp { public uint LowPart; public int HighPart; }
    [StructLayout(LayoutKind.Sequential)] public struct SecBuffer { public int cbBuffer; public int BufferType; public IntPtr pvBuffer; }
    [StructLayout(LayoutKind.Sequential)] public struct SecBufferDesc { public int ulVersion; public int cBuffers; public IntPtr pBuffers; }
    [DllImport("secur32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int AcquireCredentialsHandle(string p, string pkg, int use, IntPtr id, IntPtr auth, IntPtr fn, IntPtr arg, ref SecHandle cred, ref TimeStamp exp);
    [DllImport("secur32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int InitializeSecurityContext(ref SecHandle cred, IntPtr ctx, string target, int req, int r1, int rep, IntPtr inp, int r2, ref SecHandle newCtx, ref SecBufferDesc outp, out int attrs, ref TimeStamp exp);
    [DllImport("secur32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern int InitializeSecurityContext(ref SecHandle cred, ref SecHandle ctx, string target, int req, int r1, int rep, ref SecBufferDesc inp, int r2, ref SecHandle newCtx, ref SecBufferDesc outp, out int attrs, ref TimeStamp exp);
    [DllImport("secur32.dll")] static extern int FreeCredentialsHandle(ref SecHandle cred);
    [DllImport("secur32.dll")] static extern int DeleteSecurityContext(ref SecHandle ctx);
    static SecHandle _cred; static SecHandle _ctx; static bool _haveCtx;
    static SecBufferDesc Desc(IntPtr mem, int size, out IntPtr bufPtr) {
        SecBuffer b = new SecBuffer(); b.cbBuffer = size; b.BufferType = SECBUFFER_TOKEN; b.pvBuffer = mem;
        bufPtr = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(SecBuffer)));
        Marshal.StructureToPtr(b, bufPtr, false);
        SecBufferDesc d = new SecBufferDesc(); d.ulVersion = 0; d.cBuffers = 1; d.pBuffers = bufPtr; return d;
    }
    public static byte[] Init(string target) {
        TimeStamp exp = new TimeStamp(); _cred = new SecHandle();
        int rc = AcquireCredentialsHandle(null, "${packageName}", SECPKG_CRED_OUTBOUND, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, ref _cred, ref exp);
        if (rc != SEC_E_OK) throw new Exception("AcquireCredentialsHandle 0x" + rc.ToString("X8"));
        IntPtr mem = Marshal.AllocHGlobal(TOKEN_MAX); IntPtr bp;
        SecBufferDesc outd = Desc(mem, TOKEN_MAX, out bp);
        try {
            _ctx = new SecHandle(); int attrs;
            rc = InitializeSecurityContext(ref _cred, IntPtr.Zero, target, ISC_REQ_CONNECTION, 0, SECURITY_NATIVE_DREP, IntPtr.Zero, 0, ref _ctx, ref outd, out attrs, ref exp);
            if (rc != SEC_I_CONTINUE_NEEDED && rc != SEC_E_OK) throw new Exception("InitializeSecurityContext(1) 0x" + rc.ToString("X8"));
            _haveCtx = true;
            SecBuffer ob = (SecBuffer)Marshal.PtrToStructure(bp, typeof(SecBuffer));
            byte[] t = new byte[ob.cbBuffer]; Marshal.Copy(ob.pvBuffer, t, 0, ob.cbBuffer); return t;
        } finally { Marshal.FreeHGlobal(bp); Marshal.FreeHGlobal(mem); }
    }
    public static byte[] Respond(string target, byte[] challenge) {
        if (!_haveCtx) throw new Exception("Init must run first");
        TimeStamp exp = new TimeStamp();
        IntPtr im = Marshal.AllocHGlobal(challenge.Length); Marshal.Copy(challenge, 0, im, challenge.Length);
        IntPtr ibp; SecBufferDesc ind = Desc(im, challenge.Length, out ibp);
        IntPtr om = Marshal.AllocHGlobal(TOKEN_MAX); IntPtr obp; SecBufferDesc outd = Desc(om, TOKEN_MAX, out obp);
        try {
            int attrs;
            int rc = InitializeSecurityContext(ref _cred, ref _ctx, target, ISC_REQ_CONNECTION, 0, SECURITY_NATIVE_DREP, ref ind, 0, ref _ctx, ref outd, out attrs, ref exp);
            if (rc != SEC_E_OK && rc != SEC_I_CONTINUE_NEEDED) throw new Exception("InitializeSecurityContext(2) 0x" + rc.ToString("X8"));
            SecBuffer ob = (SecBuffer)Marshal.PtrToStructure(obp, typeof(SecBuffer));
            byte[] t = new byte[ob.cbBuffer]; Marshal.Copy(ob.pvBuffer, t, 0, ob.cbBuffer); return t;
        } finally { Marshal.FreeHGlobal(ibp); Marshal.FreeHGlobal(im); Marshal.FreeHGlobal(obp); Marshal.FreeHGlobal(om); }
    }
    public static void Cleanup() { if (_haveCtx) { DeleteSecurityContext(ref _ctx); _haveCtx = false; } FreeCredentialsHandle(ref _cred); }
}
'@
$Target = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${targetB64}'))
try {
  [Console]::Out.WriteLine('TYPE1 ' + [Convert]::ToBase64String([SspiNtlm]::Init($Target)))
  [Console]::Out.WriteLine('USER  ' + [Security.Principal.WindowsIdentity]::GetCurrent().Name)
  [Console]::Out.Flush()
  $line = [Console]::In.ReadLine()
  if ([string]::IsNullOrWhiteSpace($line)) { throw 'no challenge on stdin' }
  [Console]::Out.WriteLine('TYPE3 ' + [Convert]::ToBase64String([SspiNtlm]::Respond($Target, [Convert]::FromBase64String($line.Trim()))))
  [Console]::Out.Flush()
} catch {
  [Console]::Out.WriteLine('ERR   ' + $_.Exception.Message)
  [Console]::Out.Flush()
  exit 1
} finally { [SspiNtlm]::Cleanup() }
`;
}

/** A running handshake. Exactly ONE attempt — a new one needs a new context. */
export interface SspiHandshake {
  /** The NEGOTIATE message (Type 1), produced by SSPI. */
  readonly negotiate: Buffer;
  /** The Windows identity SSPI used (`DOMAIN\user`). */
  readonly identity: string;
  /** Processes the CHALLENGE and delivers the AUTHENTICATE message. */
  authenticate(challenge: Buffer): Promise<Buffer>;
  /** Terminates the helper process. Callable multiple times. */
  dispose(): void;
}

/** Whether this path is even applicable on this platform. */
export function sspiAvailable(platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'win32';
}

/**
 * Starts the helper process and fetches the NEGOTIATE message.
 *
 * `targetSpn` is the target's service name (`HTTP/<host>`). SSPI itself puts
 * it into the blob as `MsvAvTargetName` — unlike the hand-computed path, the
 * caller does not have to do this.
 *
 * Also different: SSPI itself sets the channel binding (16 zero bytes, like a
 * Windows client without a real binding). A real `tls-server-end-point`
 * binding could only be passed through an additional
 * `SECBUFFER_CHANNEL_BINDINGS` — as long as no server enforces it, this stays
 * unbuilt.
 */
/**
 * SSPI package.
 *
 * - `Kerberos` produces a real Kerberos token and **does not degrade**.
 * - `Negotiate` wraps in SPNEGO and silently falls back to NTLM when no
 *   ticket is available; a Kerberos-only server then rejects the login with
 *   "the client is using NTLM" in `tm1sspi.log`.
 * - `NTLM` delivers raw NTLMSSP.
 */
export type SspiPackage = 'Kerberos' | 'Negotiate' | 'NTLM';

/**
 * The seam for tests. The handshake itself only runs on Windows, but its
 * PROCESS LAYER runs everywhere: three start attempts, a deadline with
 * `kill`, an `ERR` line, a process that ends without a token, a closed read
 * end. These are exactly the paths that, per this file's header comment, were
 * hit 10 out of 10 times in practice — and until 2026-09-20 they sat behind
 * `describe.skipIf(!win)`, so they never ran in CI.
 *
 * `spawn` itself is injected, not the process: the test starts a real
 * stand-in (`node -e`), so that streams, events, `kill` and the timers are
 * the REAL Node machinery and not a stub that checks itself against its own
 * idea of it.
 */
export interface SspiDeps {
  spawn?: typeof spawn;
  /** Skips the platform guard. */
  platform?: NodeJS.Platform;
  /** Shorter deadline, so the kill path is reasonable in a test. */
  timeoutMs?: number;
  /** Shorter pause between start attempts. */
  retryDelayMs?: number;
}

export async function startSspiHandshake(
  targetSpn: string,
  /**
   * Where the helper script may live. The default is the system's temp path,
   * user-specific on Windows.
   *
   * Configurable, because this exact location is the one thing on this path
   * that can be disrupted from the outside: if the temp path sits on a drive
   * with an execution lock, or is watched by endpoint protection, a
   * different one is needed. And it makes cleanup verifiable without
   * counting inside the shared temp directory — which is meaningless under
   * parallel runs.
   */
  tmpRoot: string = os.tmpdir(),
  /**
   * Which SSPI package produces the tokens. `NTLM` is the default, because
   * TM1 and the PAW gateway speak raw NTLMSSP; `Negotiate` wraps in SPNEGO
   * and is the path to Kerberos.
   */
  packageName: SspiPackage = 'NTLM',
  deps: SspiDeps = {},
): Promise<SspiHandshake> {
  const platform = deps.platform ?? process.platform;
  if (!sspiAvailable(platform)) {
    throw new Error(`Windows single sign-on needs Windows (running on ${platform}).`);
  }
  const spawnProcess = deps.spawn ?? spawn;
  const timeoutMs = deps.timeoutMs ?? SSPI_TIMEOUT_MS;
  const retryDelayMs = deps.retryDelayMs ?? SPAWN_RETRY_DELAY_MS;

  // Its own directory, so cleanup is a single line and does not raise the
  // question of whether the file name already belongs to someone.
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'tm1-sspi-'));
  const scriptPath = path.join(dir, 'sspiNtlm.ps1');
  let dirGone = false;
  const cleanupDir = (): void => {
    if (dirGone) { return; }
    dirGone = true;
    // A leftover temp directory is no reason to discard a successful login.
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* doesn't matter */ }
  };

  try {
    // Windows PowerShell 5.1 reads a file without a BOM as ANSI. The script
    // is pure ASCII, the BOM costs nothing and removes any influence from
    // the machine's codepage setting.
    fs.writeFileSync(scriptPath, `\uFEFF${script(Buffer.from(targetSpn, 'utf8').toString('base64'), packageName)}`, 'utf8');
  } catch (err) {
    cleanupDir();
    throw new Error(`Windows single sign-on could not write its helper script: ${errMsg(err)}`);
  }

  /**
   * ONE start attempt. Only resolves once the process is actually running:
   * `spawn` reports failures partly synchronously (throw), partly as an
   * `error` event. The retry must see both, or it only covers half the
   * failure kinds.
   */
  const trySpawn = async (): Promise<ChildProcessWithoutNullStreams> =>
    new Promise<ChildProcessWithoutNullStreams>((resolve, reject) => {
      let proc: ChildProcessWithoutNullStreams;
      try {
        proc = spawnProcess('powershell.exe', [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath,
        ], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }) as ChildProcessWithoutNullStreams;
      } catch (err) {
        reject(err instanceof Error ? err : new Error(errMsg(err)));
        return;
      }
      const onSpawn = (): void => { proc.off('error', onError); resolve(proc); };
      const onError = (err: Error): void => { proc.off('spawn', onSpawn); reject(err); };
      proc.once('spawn', onSpawn);
      proc.once('error', onError);
    });

  let started: ChildProcessWithoutNullStreams | undefined;
  let lastSpawnError: unknown;
  for (let attempt = 1; attempt <= SPAWN_ATTEMPTS && !started; attempt += 1) {
    try {
      started = await trySpawn();
    } catch (err) {
      lastSpawnError = err;
      if (attempt < SPAWN_ATTEMPTS) {
        await new Promise<void>((resolve) => { setTimeout(resolve, retryDelayMs); });
      }
    }
  }
  if (!started) {
    cleanupDir();
    throw new Error(
      `Windows single sign-on could not start powershell.exe`
      + ` (${SPAWN_ATTEMPTS} attempts): ${errMsg(lastSpawnError)}.`
      + ` An endpoint protection product may be blocking PowerShell;`
      + ` set the credential set to password mode to send Windows credentials instead.`,
    );
  }
  // `let` becomes `const`: the callbacks below are closures, and TypeScript
  // does not carry the "not undefined" narrowing into a closure.
  const child = started;

  let out = '';
  let stderrText = '';
  let closed = false;
  const waiters: Array<() => void> = [];
  const nudge = (): void => { for (const w of waiters.splice(0)) { w(); } };
  child.stdout.on('data', (c: Buffer) => { out += c.toString('utf8'); nudge(); });
  child.stderr.on('data', (c: Buffer) => { stderrText += c.toString('utf8'); });
  child.on('close', () => { closed = true; nudge(); });
  child.on('error', () => { closed = true; nudge(); });
  // A1: `authenticate` writes the challenge to stdin. If PowerShell dies
  // between `USER` and this write and has already closed its read end while
  // the process is still alive, the stream reports `EPIPE`. WITHOUT a
  // listener this is an `uncaughtException` in the extension host — the
  // sibling process in `tm1top/bridge.ts:75` sets one, this one did not
  // until now. With a listener, `awaitTag` reports immediately instead of
  // only after the deadline.
  child.stdin.on('error', () => { closed = true; nudge(); });

  const timer = setTimeout(() => { child.kill(); }, timeoutMs);
  let disposed = false;
  const dispose = (): void => {
    if (disposed) { return; }
    disposed = true;
    clearTimeout(timer);
    child.kill();
    cleanupDir();
  };

  /** Waits until a line with this tag appears — or the process ends. */
  const awaitTag = async (tag: string): Promise<string> => {
    const find = (): string | undefined => (new RegExp(`^${tag}\\s+(.*)$`, 'm').exec(out) ?? [])[1]?.trim();
    for (;;) {
      const hit = find();
      if (hit !== undefined && hit !== '') { return hit; }
      const failure = (/^ERR\s+(.*)$/m.exec(out) ?? [])[1]?.trim();
      if (failure) { throw new Error(`Windows single sign-on failed: ${failure}`); }
      if (closed) {
        throw new Error(
          `Windows single sign-on produced no ${tag} token`
          + `${stderrText.trim() ? `: ${stderrText.trim().split('\n')[0].slice(0, 200)}` : '.'}`,
        );
      }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
  };

  try {
    const negotiate = Buffer.from(await awaitTag('TYPE1'), 'base64');
    // Type 1 is here, so PowerShell has fully read the file and compiled the
    // C#. From here on nobody needs it any more — remove it, without waiting
    // for the handshake to end. `dispose` cleans up again anyway, for the
    // paths that never reach here.
    cleanupDir();
    // The identity arrives right after Type 1, so it is known even if the
    // exchange later fails — it is half of the error report.
    const identity = await awaitTag('USER');
    return {
      negotiate,
      identity,
      async authenticate(challenge: Buffer): Promise<Buffer> {
        child.stdin.write(`${challenge.toString('base64')}\n`);
        const token = Buffer.from(await awaitTag('TYPE3'), 'base64');
        return token;
      },
      dispose,
    };
  } catch (err) {
    dispose();
    throw err;
  }
}
