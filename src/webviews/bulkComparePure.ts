// src/webviews/bulkComparePure.ts
// Content comparison for the bulk migration: is the object over there the same
// as here, and if not, in which part? Pure — the host builds the documents,
// the webview bundle only shows the result.
//
// One representation serves both purposes: the host reads each object as a
// list of named parts. The per-part status compares that list; the diff editor
// shows the same list rendered with `### <part>` headings. A part that differs
// in the table therefore always differs in the diff, and vice versa. The
// rendered text is never split back: `### ` opens a comment in TI and rules.

/** Heading that opens a part in a comparison document. */
export const PART_PREFIX = '### ';

export interface CompareResult {
  /**
   * `same` / `differs` — both sides read. `error` — at least one side could
   * not be read; "same" would then be a claim nobody can make.
   */
  status: 'same' | 'differs' | 'error';
  /** Parts that differ and count as a difference. */
  parts: string[];
  /**
   * Parts that differ but are expected to differ between servers (a chore's
   * Active flag: active in production, inactive in development). Shown, never
   * counted.
   */
  expected: string[];
  /** Why a side could not be read. */
  reason?: string;
}

/**
 * Normalise text so that only real differences remain: line endings, spaces
 * at line ends and trailing empty lines are noise a server round trip or an
 * editor adds; they never change what TM1 executes.
 */
export function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n+$/, '');
}

/** An object as named parts, in display order. */
export type Parts = ReadonlyArray<readonly [string, string]>;

/** Render parts as one comparison document. */
export function renderParts(parts: Parts): string {
  return parts.map(([name, body]) => `${PART_PREFIX}${name}\n${normalizeText(body)}`).join('\n\n') + '\n';
}

/**
 * Compare two objects part by part. A part present on one side only counts
 * as differing. Order follows the source, then target-only parts.
 */
export function compareParts(
  source: Parts, target: Parts, expectedParts: ReadonlySet<string> = new Set(),
): CompareResult {
  const a = new Map(source.map(([n, body]) => [n, normalizeText(body)]));
  const b = new Map(target.map(([n, body]) => [n, normalizeText(body)]));
  const names = [...a.keys(), ...[...b.keys()].filter(k => !a.has(k))];
  const parts: string[] = [];
  const expected: string[] = [];
  for (const n of names) {
    if (a.get(n) === b.get(n)) { continue; }
    (expectedParts.has(n) ? expected : parts).push(n);
  }
  return { status: parts.length > 0 ? 'differs' : 'same', parts, expected };
}

/**
 * Drop a part from both sides unless both have it — for a field one server
 * variant cannot report, where "missing" is not a difference.
 */
export function onlyIfBoth(source: Parts, target: Parts, name: string): [Parts, Parts] {
  if (source.some(([n]) => n === name) && target.some(([n]) => n === name)) { return [source, target]; }
  const drop = (p: Parts): Parts => p.filter(([n]) => n !== name);
  return [drop(source), drop(target)];
}

/** The chore part that may differ between servers on purpose. */
export const CHORE_ACTIVE_PART = 'Active';

/** The chore part not every server variant reports (see `CHORE_DETAIL_VARIANTS`). */
export const CHORE_MODE_PART = 'Execution mode';
