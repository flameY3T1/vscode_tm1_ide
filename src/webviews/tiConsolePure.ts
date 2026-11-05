// src/webviews/tiConsolePure.ts
// Pure text work of the TI console — no vscode, unit-tested.

/**
 * Index at which a comment begins in `line`, otherwise `line.length`.
 *
 * TI comments start with `#` and run to the end of the line; a `#` INSIDE
 * a string is not one. TI strings are in single
 * quotes, a contained quote is doubled — that
 * comes out right here by itself, because two toggles in a row
 * do not change the state.
 */
function commentStart(line: string): number {
  let inString = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === "'") { inString = !inString; continue; }
    if (ch === '#' && !inString) { return i; }
  }
  return line.length;
}

/**
 * Append a semicolon to the last statement if it is missing.
 *
 * TI requires a `;` after every statement — `SaveDataAll()` does not compile,
 * `SaveDataAll();` does. In a process editor this is hardly noticed,
 * in a console for ONE one-liner it is the most frequent failure.
 *
 * Valid code cannot be broken by this: a statement without `;`
 * does not compile anyway, so the semicolon only rescues the case that would otherwise
 * come back as an error. An attached comment stays, the `;`
 * goes before it.
 */
export function terminateTiSnippet(code: string): string {
  const lines = code.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const end = commentStart(lines[i]);
    const statement = lines[i].slice(0, end);
    // Blank line or pure comment line — keep going up.
    if (statement.trim() === '') { continue; }
    const trimmed = statement.trimEnd();
    if (trimmed.endsWith(';')) { return code; }
    // The gap between statement and comment stays as the user
    // set it — the `;` slides in before it, it does not tidy up.
    lines[i] = trimmed + ';' + statement.slice(trimmed.length) + lines[i].slice(end);
    return lines.join('\n');
  }
  return code;
}

/** A submitted snippet in the history of the console. */
export interface TiHistoryEntry {
  code: string;
  timestamp: number;
  elapsedMs: number;
  ok: boolean;
  /** The process status reported by TM1, or the error message if `ok` is false. */
  status?: string;
}

/** Nobody needs to look up more than this, and the `globalState` stays small. */
export const TI_HISTORY_CAP = 50;

/**
 * Insert the entry at the front, throw out the same snippet beforehand, cap
 * the list. Same rule as the MDX history (`mdx/historyStore.ts`): whoever
 * runs the same one-liner three times wants to see it once in the history —
 * with the result of the LAST run.
 */
export function addTiHistory(
  entries: TiHistoryEntry[],
  entry: TiHistoryEntry,
  cap: number = TI_HISTORY_CAP,
): TiHistoryEntry[] {
  const key = entry.code.trim();
  const next = [entry, ...entries.filter(e => e.code.trim() !== key)];
  if (next.length > cap) { next.length = cap; }
  return next;
}
