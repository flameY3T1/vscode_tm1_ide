/**
 * Per-server concurrency brake.
 *
 * TM1 binds the serving worker thread to the TCP socket: every simultaneously
 * open connection is its own thread. The obvious cap for this would be
 * `maxSockets` on the Node agent — but that has no effect here, because VS
 * Code patches `http(s).request` (`@vscode/proxy-agent`, setting
 * `http.proxySupport`, default `override`) and replaces our agent with its
 * own. Measured (2026-08-18): with `maxSockets: 4`, opening a view still
 * produced 8 connections, because 15 requests started within the same
 * millisecond. Details in `docs/architecture/thread-stability.md`.
 *
 * This brake therefore sits IN FRONT OF the request and is independent of
 * any agent: no more than `limit` requests per server are ever in flight at
 * once, the rest wait in arrival order. Waiting time does not count towards
 * `timeoutMs` — the clock only starts once the request actually goes out.
 *
 * It applies to EVERY request. An earlier version excluded `timeoutMs === 0`,
 * on the assumption that this marks the long-running ones (process
 * execution, rule saving). Wrong: `tm1.timeoutMs` has a default of 0
 * (`tm1Rest/client.ts#getTimeoutMs`), so the exclusion matched practically
 * every request and the brake had no effect. Residual risk of the fix: if
 * `limit` genuine long-runners run at the same time, every further request
 * waits until one of them finishes — then raise `tm1.maxSockets`. Detecting
 * long-runners by URL pattern would be guesswork against a list that
 * silently goes stale with every new call path.
 *
 * Deliberately vscode-free (depcruise `tm1rest-no-vscode`): the calling layer
 * sets the value via `setRequestGateLimit`.
 */

/** Cap per server. `<= 0` means unlimited (brake off). */
let _limit = 4;

type Gate = { active: number; queue: (() => void)[] };

const _gates = new Map<string, Gate>();

/**
 * Sets the cap. Affects new requests; already-running ones are left alone,
 * waiting ones advance on the next release.
 */
export function setRequestGateLimit(limit: number): void {
  _limit = Number.isFinite(limit) ? Math.trunc(limit) : 0;
  // Raised: let waiting requests advance immediately, instead of blocking
  // until the next release.
  for (const gate of _gates.values()) { _drain(gate); }
}

/** Requests currently running for a key (tests only). */
export function _gateActiveForTest(key: string): number {
  return _gates.get(key)?.active ?? 0;
}

/** Resets the cap and all queues (tests only). */
export function _resetRequestGateForTest(limit = 4): void {
  _gates.clear();
  _limit = limit;
}

function _drain(gate: Gate): void {
  while ((_limit <= 0 || gate.active < _limit) && gate.queue.length > 0) {
    const next = gate.queue.shift()!;
    gate.active++;
    next();
  }
}

/**
 * Runs `run` as soon as a slot is free for `key`. The slot is released as
 * soon as `run` finishes — including on failure, otherwise the cap leaks a
 * slot on every failed request.
 */
export function withRequestSlot<T>(key: string, run: () => Promise<T>): Promise<T> {
  if (_limit <= 0) { return run(); }

  let gate = _gates.get(key);
  if (!gate) { gate = { active: 0, queue: [] }; _gates.set(key, gate); }
  const g = gate;

  const start = (): Promise<T> => {
    let done: Promise<T>;
    try {
      done = run();
    } catch (e) {
      // A synchronous throw from `run` must not hold on to the slot.
      g.active--;
      _drain(g);
      return Promise.reject(e);
    }
    return done.finally(() => {
      g.active--;
      _drain(g);
    });
  };

  if (g.active < _limit) {
    g.active++;
    return start();
  }
  return new Promise<T>((resolve, reject) => {
    // `_drain` increments `active` before the call — so not again here.
    g.queue.push(() => { start().then(resolve, reject); });
  });
}
