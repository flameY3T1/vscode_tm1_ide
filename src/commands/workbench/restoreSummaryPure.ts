export interface RestoreResult {
  label: string;
  ok: boolean;
  /** Only for `ok: false`. Short reason that fits into the summary message. */
  reason?: string;
  /**
   * Not attempted because the user cancelled. Always paired with
   * `ok: false`, but NOT a failure — there is no reason to name, just its
   * own line in the summary message.
   */
  cancelled?: boolean;
}

export interface SummaryLabels {
  restored: string;   // '{0}' name, '{1}' opened, '{2}' total
  notOpened: string;  // '{0}' list
  cancelled: string;  // '{0}' list of windows that were never started
  entry: string;      // '{0}' label, '{1}' reason
}

function fmt(s: string, ...args: (string | number)[]): string {
  return s.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ''));
}

/**
 * ONE message instead of an error toast per window.
 *
 * With twelve windows, twelve toasts would be unusable, and aborting on the
 * first error would throw away the work of the windows that did work. So
 * the flow collects results and reports at the end.
 */
export function buildRestoreSummary(name: string, results: RestoreResult[], t: SummaryLabels): string {
  const ok = results.filter(r => r.ok).length;
  const head = fmt(t.restored, name, ok, results.length);
  // Cancelled and failed are two different statements: one was the user's
  // own decision, the other happened to them. Mixed into one list, the
  // cancellation reads like an error.
  const bad = results.filter(r => !r.ok && !r.cancelled);
  const skipped = results.filter(r => r.cancelled);
  const lines = [head];
  if (bad.length > 0) {
    lines.push(fmt(t.notOpened, bad.map(r => fmt(t.entry, r.label, r.reason ?? '')).join(', ')));
  }
  if (skipped.length > 0) {
    lines.push(fmt(t.cancelled, skipped.map(r => r.label).join(', ')));
  }
  return lines.join('\n');
}
