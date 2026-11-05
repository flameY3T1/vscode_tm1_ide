/**
 * Client-side validation helpers for the dimension-editor webview.
 *
 * Split out of `pure.ts` (Junk-Drawer split). No DOM, no module state.
 */

import type { ElementLike, EdgeLike, BulkParseResult } from './model';
import { getL10n, fmt } from '../_shared/l10n';

const L = getL10n();

/**
 * Validate an element name. Returns null if valid; otherwise a German error
 * message identifier ('empty' or 'invalid-char').
 *
 * Invalid: empty/whitespace-only, or contains `'`, `[`, `]`, or any control char (0x00-0x1f).
 */
export function validateElementName(name: string): 'empty' | 'invalid-char' | null {
  if (!name || !name.trim()) { return 'empty'; }
  if (/['[\]\x00-\x1f]/.test(name)) { return 'invalid-char'; }
  return null;
}

/**
 * Find duplicate names in a list (case-insensitive). Returns groups of names
 * that share the same lowercased key; only groups with ≥2 entries are returned.
 */
export function findDuplicateNames(names: ReadonlyArray<string>): string[][] {
  const seen = new Map<string, string[]>();
  for (const n of names) {
    const k = n.toLowerCase();
    const arr = seen.get(k) || [];
    arr.push(n);
    seen.set(k, arr);
  }
  const out: string[][] = [];
  for (const arr of seen.values()) {
    if (arr.length > 1) { out.push(arr); }
  }
  return out;
}

/**
 * Detect a cycle in a parent → child edge list (ignoring edges marked
 * 'deleted'). Returns true if a cycle exists.
 *
 * Standard 3-color DFS (white/gray/black) — STACK gray means re-encountering
 * a node on the current path = back edge = cycle.
 */
export function detectCycle(edges: ReadonlyArray<EdgeLike>): boolean {
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.marked === 'deleted') { continue; }
    const arr = adj.get(e.parent) || [];
    arr.push(e.child);
    adj.set(e.parent, arr);
  }
  const STACK = 1, VISITED = 2;
  const color = new Map<string, number>();
  function dfs(n: string): boolean {
    color.set(n, STACK);
    for (const nx of (adj.get(n) || [])) {
      const c = color.get(nx);
      if (c === STACK) { return true; }
      if (c === VISITED) { continue; }
      if (dfs(nx)) { return true; }
    }
    color.set(n, VISITED);
    return false;
  }
  for (const n of adj.keys()) {
    if (!color.has(n) && dfs(n)) { return true; }
  }
  return false;
}

/**
 * Parse a multi-line bulk-element input. Each non-empty line is classified:
 *  - `invalid`: contains forbidden chars
 *  - `duplicateFile`: name (case-insensitively) repeated within input
 *  - `alreadyExists`: already present in `existingNamesLower`
 *  - `valid`: passes all checks
 *
 * `existingNamesLower` should contain lowercased names of all live elements
 * (excluding marked='deleted').
 */
export function parseBulkInput(
  text: string,
  existingNamesLower: ReadonlySet<string>,
): BulkParseResult {
  const out: BulkParseResult = { valid: [], duplicateFile: [], alreadyExists: [], invalid: [] };
  const seen = new Set<string>();
  for (const raw of String(text || '').split(/\r?\n/)) {
    const name = raw.trim();
    if (!name) { continue; }
    if (/['[\]\x00-\x1f]/.test(name)) { out.invalid.push(name); continue; }
    const lc = name.toLowerCase();
    if (seen.has(lc)) { out.duplicateFile.push(name); continue; }
    seen.add(lc);
    if (existingNamesLower.has(lc)) { out.alreadyExists.push(name); continue; }
    out.valid.push(name);
  }
  return out;
}

/**
 * Run all client-side validation for a dimension state. Returns a list of
 * German error messages (empty array == valid).
 *
 * Checks:
 *  - Duplicate element names (case-insensitive)
 *  - Empty or invalid-char element names
 *  - Cycles in edges
 *
 * Elements/edges marked `'deleted'` are excluded.
 */
export function validateDimensionState(
  elements: ReadonlyArray<ElementLike>,
  edges: ReadonlyArray<EdgeLike>,
): string[] {
  const errors: string[] = [];
  const live = elements.filter((el) => el.marked !== 'deleted');

  const dupes = findDuplicateNames(live.map((el) => el.name));
  for (const group of dupes) {
    errors.push(fmt(L, 'duplicates', group.join(', ')));
  }
  for (const el of live) {
    const code = validateElementName(el.name);
    if (code === 'empty') {
      errors.push(fmt(L, 'emptyElementName'));
    } else if (code === 'invalid-char') {
      errors.push(fmt(L, 'invalidCharsValue', el.name));
    }
  }
  if (detectCycle(edges)) {
    errors.push(fmt(L, 'cycleInConsolidations'));
  }
  return errors;
}
