/**
 * Open state questions to webviews.
 *
 * Why this intermediate step exists: the state of a cube viewer or
 * dimension browser lives in the webview, not in the extension — the
 * expression behind `buildCurrentMdx()`, the intent in `state._compose`.
 * Fetching it is a round trip over the message channel, so asynchronous,
 * whereas `WindowKind.capture` used to be synchronous until just now.
 *
 * The answer does NOT come back through a second message listener, but
 * through the existing router table of the respective window. That is
 * deliberate: `DispatchTable` is exhaustive over the message union, a new
 * type without a handler is a compile error. A listener bolted on beside it
 * would have bypassed this guard and, on top of that, produced a
 * `console.warn` line in every router.
 *
 * vscode-free: posting is done by the caller, only the bookkeeping lives
 * here.
 */

interface Pending {
  resolve(state: unknown): void;
  timer: ReturnType<typeof setTimeout>;
}

const _pending = new Map<string, Pending>();
let _seq = 0;

/**
 * A token per question.
 *
 * Mandatory, not decoration: the selection window can be opened twice in a
 * row (`saveFlow` disposes the old panel for that), and a late answer to
 * the first question must not answer the second one. Without a token this
 * would be a silent bug — someone would save the state from before and only
 * notice when restoring.
 */
export function nextAskToken(): string {
  return `ask#${++_seq}`;
}

/**
 * Waits for the answer to `token`, for at most `timeoutMs`.
 *
 * `undefined` means "not read" — not "empty state". The caller
 * distinguishes this: on `undefined`, the coarse state is saved AND noted
 * in the selection window, so no one saves in good faith unknowingly.
 */
export function awaitStateReply(token: string, timeoutMs: number): Promise<unknown> {
  return new Promise<unknown>((resolve) => {
    const timer = setTimeout(() => {
      _pending.delete(token);
      resolve(undefined);
    }, timeoutMs);
    // Node does not keep the process alive because of this timer; in the
    // extension host that is meaningless anyway, but it is cleaner in
    // tests.
    timer.unref?.();
    _pending.set(token, { resolve, timer });
  });
}

/**
 * Registers an incoming answer.
 *
 * Return value `false` = no one was waiting on this token (foreign, or the
 * cap fired first). That is a normal outcome, not an error — the caller is
 * free to ignore it.
 */
export function resolveStateReply(token: string, state: unknown): boolean {
  const p = _pending.get(token);
  if (!p) { return false; }
  _pending.delete(token);
  clearTimeout(p.timer);
  p.resolve(state);
  return true;
}

export function _pendingCountForTest(): number { return _pending.size; }

export function _clearAsksForTest(): void {
  for (const p of _pending.values()) { clearTimeout(p.timer); }
  _pending.clear();
  _seq = 0;
}
