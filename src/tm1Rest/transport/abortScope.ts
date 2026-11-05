/**
 * Cancels reads that nobody waits for any more. A panel runs its message
 * handlers inside `runWithAbortSignal(signal, …)` and aborts on close; every
 * GET started from there — however many awaits deep — picks the signal up in
 * `_rawTransport`. AsyncLocalStorage carries it, so no signature changes.
 *
 * GET only: an aborted POST/PATCH (execute, save) keeps running on TM1, and
 * the caller would report it finished while it is not.
 */
import { AsyncLocalStorage } from 'async_hooks';

const _scope = new AsyncLocalStorage<AbortSignal>();

export function runWithAbortSignal<T>(signal: AbortSignal, fn: () => T): T {
  return _scope.run(signal, fn);
}

export function currentAbortSignal(): AbortSignal | undefined {
  return _scope.getStore();
}

/**
 * Runs `fn` outside any panel scope. For work several waiters share (a cache's
 * in-flight promise): closing the panel that started it must not cancel it
 * for the others still waiting.
 */
export function runWithoutAbortSignal<T>(fn: () => T): T {
  return _scope.exit(fn);
}
