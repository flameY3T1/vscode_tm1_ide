/**
 * Seconds as a short human duration (ms below 1 s, s below 90 s, then
 * min/h). Shared by the Server Startup Analysis host and its webview bundle,
 * so it must stay free of vscode.
 */
export function fmtSec(n: number | null | undefined): string {
  if (n === null || n === undefined) { return '—'; }
  if (n < 1) { return `${Math.round(n * 1000)} ms`; }
  if (n < 90) { return `${n.toFixed(n < 10 ? 2 : 1)} s`; }
  const m = Math.floor(n / 60);
  if (m < 60) { return `${m} min ${Math.round(n - m * 60)} s`; }
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}
