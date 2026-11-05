/**
 * Resolve when `p` settles OR after `ms` milliseconds — whichever comes first.
 * Never rejects (a rejection of `p` is swallowed). Used to bound best-effort
 * async cleanup (e.g. closing TM1 sessions on `deactivate()`) so a slow or
 * unreachable server can never stall VS Code shutdown/reload.
 */
export function resolveWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, ms);
    void Promise.resolve(p)
      .catch(() => { /* best-effort — ignore rejection */ })
      .finally(() => { clearTimeout(timer); finish(); });
  });
}
