import { execFile, ChildProcess } from 'child_process';

/**
 * Deadlock guard for `kill`. Long enough that a slow but working cancellation
 * still reports back, short enough that a hung helper does not block the panel
 * for the rest of the session.
 */
const KILL_TIMEOUT_MS = 60_000;

export class Tm1TopBridgeError extends Error {
  constructor(public readonly reason: string, public readonly code?: number) {
    super(reason);
    this.name = 'Tm1TopBridgeError';
  }
}

export interface Tm1TopBridgeOptions {
  bin64Dir: string;
  helperPath: string;
  timeoutMs?: number;
  /** Prefix arguments permit testing the wire protocol with a Node fake helper. */
  helperArgs?: string[];
}

/** A fresh process per call also recovers cleanly after native DLL crashes. */
export class Tm1TopBridge {
  private child?: ChildProcess;
  private disposed = false;
  private inFlight = false;
  constructor(private readonly options: Tm1TopBridgeOptions) {
    if (options.timeoutMs !== undefined && (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)) {
      throw new Tm1TopBridgeError('invalid-request');
    }
  }

  dispose(): void {
    this.disposed = true;
    this.child?.kill();
  }

  private async call(adminHost: string, server: string, operation: string,
    credentials?: { username: string; password: string; threadId?: string }): Promise<Record<string, unknown>> {
    if (this.disposed) throw new Tm1TopBridgeError('disposed');
    if (this.inFlight) throw new Tm1TopBridgeError('in-flight');
    if ([adminHost, server].some(value => value.length > 4096 || value.includes('\0')) ||
        (credentials && (credentials.username.length > 4096 || credentials.password.length > 4096 ||
          credentials.username.includes('\0') || credentials.password.includes('\0') ||
          (credentials.threadId !== undefined && !/^\d{1,20}$/.test(credentials.threadId))))) {
      throw new Tm1TopBridgeError('invalid-request');
    }
    this.inFlight = true;
    try {
      return await new Promise<Record<string, unknown>>((resolve, reject) => {
        const args = [...(this.options.helperArgs ?? []), this.options.bin64Dir, adminHost, server, operation];
        this.child = execFile(this.options.helperPath, args, {
          // Killing the helper cannot undo a cancellation already sent to TM1 —
          // which argues against a SHORT limit on `kill`, not against any. With
          // none at all (`timeout: 0`) a helper that never answers — a hung TM1
          // port, a Kerberos prompt inside the C API — left `inFlight` set for
          // good: every later `getState`/`verifyAdmin` threw `'in-flight'`, the
          // panel stood still, and only closing it recovered. The budget is
          // generous on purpose; `KILL_TIMEOUT_MS` is a deadlock guard, not a
          // deadline for TM1.
          timeout: operation === 'kill' ? KILL_TIMEOUT_MS
            : operation === 'verifyAdmin' ? 30000 : this.options.timeoutMs ?? 15000,
          maxBuffer: 4 * 1024 * 1024,
          windowsHide: true, encoding: 'utf8',
        }, (error, stdout) => {
          if (this.disposed) { reject(new Tm1TopBridgeError('disposed')); return; }
          if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            reject(new Tm1TopBridgeError('output-too-large')); return;
          }
          if (error?.killed) {
            // On cancel this is something different from an expired read deadline:
            // the statement IS at TM1, only the confirmation is missing. A
            // dedicated code, so the UI does not report "nothing happened"
            // where "unconfirmed" is right.
            reject(new Tm1TopBridgeError(operation === 'kill' ? 'kill-unconfirmed' : 'timeout'));
            return;
          }
          let value: unknown;
          try { value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); }
          catch { reject(new Tm1TopBridgeError(error ? 'helper-failed' : 'invalid-json')); return; }
          if (!value || typeof value !== 'object' || Array.isArray(value)) {
            reject(new Tm1TopBridgeError('invalid-response')); return;
          }
          const result = value as Record<string, unknown>;
          if (typeof result.error === 'string') {
            // Do not expose arbitrary native text: it can include credentials.
            reject(new Tm1TopBridgeError(typeof result.reason === 'string' ? result.reason : 'native-error',
              typeof result.code === 'number' ? result.code : undefined)); return;
          }
          if (error) { reject(new Tm1TopBridgeError('helper-failed')); return; }
          resolve(result);
        });
        this.child.stdin?.on('error', () => { /* Child termination is handled by execFile. */ });
        this.child.stdin?.end(credentials ? JSON.stringify(credentials) : '');
      });
    } finally {
      this.child = undefined;
      this.inFlight = false;
    }
  }

  private strings(result: Record<string, unknown>, key: string): string[] {
    const value = result[key];
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
      throw new Tm1TopBridgeError('invalid-response');
    }
    return value as string[];
  }

  async getState(adminHost: string, server: string): Promise<string[]> {
    return this.strings(await this.call(adminHost, server, 'getState'), 'rows');
  }
  async enumServers(adminHost: string): Promise<string[]> {
    return this.strings(await this.call(adminHost, '', 'enumServers'), 'servers');
  }
  async verifyAdmin(adminHost: string, server: string, username: string, password: string): Promise<boolean> {
    const result = await this.call(adminHost, server, 'verifyAdmin', { username, password });
    if (typeof result.verified !== 'boolean') throw new Tm1TopBridgeError('invalid-response');
    return result.verified;
  }
  async kill(adminHost: string, server: string, threadId: string, username: string, password: string): Promise<void> {
    const result = await this.call(adminHost, server, 'kill', { username, password, threadId });
    if (result.killed !== true) throw new Tm1TopBridgeError('invalid-response');
  }
}
