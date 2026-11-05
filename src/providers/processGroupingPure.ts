/**
 * Pure grouping logic for TM1 processes by marker token (e.g. `_Load_#####`).
 * No vscode dependency — directly unit-testable.
 */

import { compileProcessGroupPattern, extractPatternKey, type PatternAnchor } from './processGroupPatternPure';

/**
 * `suffix`/`prefix` match a literal token; the matching process itself becomes
 * the group header. `patternSuffix`/`patternPrefix` match a pattern (see
 * `processGroupPattern.ts`) and use the matched text as the group key, which is
 * what number ranges (`s001_…`, `s002_…`) need.
 */
export type ProcessGroupingMode = 'suffix' | 'prefix' | 'patternSuffix' | 'patternPrefix';

export const PROCESS_GROUPING_MODES: readonly ProcessGroupingMode[] =
  ['suffix', 'prefix', 'patternSuffix', 'patternPrefix'];

export function isProcessGroupingMode(value: string): value is ProcessGroupingMode {
  return (PROCESS_GROUPING_MODES as readonly string[]).includes(value);
}

/**
 * Grouping mode preselected in the "Configure Process Grouping" dialog for a
 * server that carries no per-server override.
 *
 * There is deliberately no default *token*: grouping is per-server data (an
 * override in globalState, keyed by server id) and nothing else. No override
 * means no grouping — which is also what Reset restores.
 */
export const DEFAULT_PROCESS_GROUP_MODE: ProcessGroupingMode = 'suffix';

export interface ProcessGroup {
  /**
   * Group label; `null` for the "ungrouped" bucket. In the literal modes this
   * is the marker *process* name (token included); in the pattern modes it is
   * the matched text — a key, not a process.
   */
  marker: string | null;
  /**
   * Process names in this group, alphabetically ordered (case-insensitive).
   * For marker groups the marker itself is included as the first child so it
   * remains openable as a TI process.
   */
  children: string[];
}

/**
 * Groups process names for the given mode — the single entry point used by the
 * tree provider and the grouping panel's live preview.
 */
export function groupProcesses(
  names: string[],
  token: string,
  mode: ProcessGroupingMode = DEFAULT_PROCESS_GROUP_MODE,
): ProcessGroup[] {
  if (mode === 'patternPrefix' || mode === 'patternSuffix') {
    return groupProcessesByPattern(names, token, mode === 'patternPrefix' ? 'start' : 'end');
  }
  return groupProcessesByMarker(names, token, mode);
}

/**
 * Groups process names by marker token.
 *
 * Sorts `names` case-insensitively, then walks the list: each name matching
 * `token` (via `endsWith` for `suffix` mode, `startsWith` for `prefix` mode)
 * starts a new group; other names land in the most recently opened group
 * (or in a leading bucket with `marker: null` when no marker has been seen
 * yet). Empty inputs return `[]`. The leading bucket is omitted when it
 * would be empty.
 *
 * An empty `token` means "no grouping" (so documented in the input box) and
 * returns a single `marker: null` bucket with all names — without this guard
 * every name would match (`'x'.endsWith('') === true`) and end up as its own
 * one-child group.
 */
export function groupProcessesByMarker(
  names: string[],
  token: string,
  mode: ProcessGroupingMode = 'suffix',
): ProcessGroup[] {
  if (names.length === 0) { return []; }
  const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  // Empty token = no grouping: every name would match otherwise.
  if (!token) { return [{ marker: null, children: sorted }]; }
  const groups: ProcessGroup[] = [];
  let current: ProcessGroup = { marker: null, children: [] };
  const matches = mode === 'prefix'
    ? (n: string) => n.startsWith(token)
    : (n: string) => n.endsWith(token);
  for (const name of sorted) {
    if (matches(name)) {
      if (current.children.length > 0) { groups.push(current); }
      current = { marker: name, children: [name] };
    } else {
      current.children.push(name);
    }
  }
  if (current.children.length > 0) { groups.push(current); }
  return groups;
}

/**
 * Pattern grouping: the matched text is the group key, so one pattern covers a
 * whole number range (`s{n}_` → `s001_`, `s002_`, …). Unlike the marker modes
 * there is no header process — the group node is a pure label and every child
 * is a real process.
 *
 * Non-matching names collect in a trailing `marker: null` bucket. An invalid
 * pattern degrades to "no grouping" (the panel reports the error; a tree
 * refresh must not throw).
 */
export function groupProcessesByPattern(
  names: string[],
  pattern: string,
  anchor: PatternAnchor,
): ProcessGroup[] {
  if (names.length === 0) { return []; }
  const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  if (!pattern) { return [{ marker: null, children: sorted }]; }

  const compiled = compileProcessGroupPattern(pattern, anchor);
  if (!compiled.ok) { return [{ marker: null, children: sorted }]; }

  const buckets = new Map<string, string[]>();
  const ungrouped: string[] = [];
  for (const name of sorted) {
    const key = extractPatternKey(name, compiled.regex);
    if (key === null) { ungrouped.push(name); continue; }
    const bucket = buckets.get(key);
    if (bucket) { bucket.push(name); } else { buckets.set(key, [name]); }
  }

  const groups: ProcessGroup[] = [...buckets.entries()]
    .sort((a, b) => a[0].toLowerCase().localeCompare(b[0].toLowerCase()))
    .map(([marker, children]) => ({ marker, children }));
  if (ungrouped.length > 0) { groups.push({ marker: null, children: ungrouped }); }
  return groups;
}
