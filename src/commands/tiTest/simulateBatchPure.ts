/**
 * Pure helpers for simulateBatch — no vscode/REST/fs dependencies.
 *
 * Holds the warning-filter used to suppress cosmetic simulator notices
 * (LogOutput is server-only logging; ExecuteProcess/RunProcess sub-calls
 * are handled via sub-log merge for v2 manifests and not re-executed).
 */

const COSMETIC_WARNING_PATTERNS: RegExp[] = [
  /unsupported call 'LogOutput'/,
  /ExecuteProcess not executed by simulator/,
  /RunProcess not executed by simulator/,
];

/**
 * `true` if the warning carries actionable information for the user.
 * `false` for the three patterns above — those are intentional simulator
 * skips, not user-fixable issues.
 */
export function isMeaningfulWarning(warning: string): boolean {
  return !COSMETIC_WARNING_PATTERNS.some((re) => re.test(warning));
}

/** Filter a list of simulator warnings, keeping only the meaningful ones. */
export function filterMeaningfulWarnings(warnings: ReadonlyArray<string>): string[] {
  return warnings.filter(isMeaningfulWarning);
}
