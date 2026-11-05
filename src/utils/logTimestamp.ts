// Pure and without vscode: runs in the host and in the webview bundle of the transaction log.

/**
 * Render a log timestamp as `dd.mm.yyyy hh:mm:ss`, zero-padded throughout.
 *
 * Not `toLocaleDateString('de-DE')`: that yields `5.8.2026`, so the column stops
 * aligning under `tabular-nums` and the day/month width jumps between rows.
 *
 * TM1 11.8 writes `0000-00-00T00:00Z` on log lines that carry no time (the
 * shared-memory banner at the head of the file is one). `new Date` turns that
 * into `Invalid Date`, so it is answered with an empty cell instead.
 *
 * Bundled into the message-log and transaction-log webviews.
 */
export function formatLogTimestamp(raw: string | undefined): string {
  if (!raw) { return ''; }
  const d = new Date(raw);
  const ms = d.getTime();
  if (Number.isNaN(ms) || d.getFullYear() < 1900) { return ''; }
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} `
    + `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
