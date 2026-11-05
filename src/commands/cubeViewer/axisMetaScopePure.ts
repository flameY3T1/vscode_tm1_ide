/**
 * Trims the axis metadata down to what the client can actually name.
 *
 * Why this exists at all: the full parent maps of an axis dimension cost
 * around 120 bytes per element (measured live on 11.8). For `Accounts`
 * (160,617) and the large test dimension (211,833 elements), that is 41 MB
 * per `cellData` — for a view that shows 8,333 rows. The client only needs
 * the chain over the visible rows from that; the host answers everything
 * else on request.
 *
 * `all` is only kept for elements with MULTIPLE parents: `collectAncestors`
 * on the client prefers `all[n]` and otherwise falls back to `first[n]`, so a
 * single-parent entry in `all` is pure repetition of `first` (measured: 17-24%
 * of elements have multiple parents — the rest is paid for twice).
 */
export interface FullParentMaps {
  first: Record<string, string>;
  all: Record<string, string[]>;
}

export interface ScopedParentMaps {
  first: Record<string, string>;
  all: Record<string, string[]>;
  /** Known names that are a parent in the FULL map. Drives the collapse triangle. */
  hasChildren: Record<string, true>;
}

/** All parents of `n`, either branch — `all` wins, `first` is the fallback. */
function parentsOf(n: string, full: FullParentMaps): string[] {
  const a = full.all[n];
  if (a && a.length > 0) { return a; }
  const p = full.first[n];
  return p === undefined ? [] : [p];
}

export function scopeParentMaps(
  known: Iterable<string>, full: FullParentMaps, parentSet: ReadonlySet<string>,
  flat?: Iterable<string>,
): ScopedParentMaps {
  const closure = new Set<string>();
  const frontier: string[] = [];
  for (const n of known) { if (n && !closure.has(n)) { closure.add(n); frontier.push(n); } }

  while (frontier.length > 0) {
    const n = frontier.pop() as string;
    for (const p of parentsOf(n, full)) {
      if (!closure.has(p)) { closure.add(p); frontier.push(p); }
    }
  }

  const first: Record<string, string> = {};
  const all: Record<string, string[]> = {};
  for (const n of closure) {
    const f = full.first[n];
    if (f !== undefined) { first[n] = f; }
    const a = full.all[n];
    if (a && a.length > 1) { all[n] = a; }
  }

  const hasChildren: Record<string, true> = {};
  for (const n of known) { if (parentSet.has(n)) { hasChildren[n] = true; } }

  // `flat` (added later, counter-measurement 2026-08-11): the active filter list
  // goes into the map WITHOUT an ancestor walk — just its own `first` entry, no
  // `all`, no climbing to parents. Reason: 10,000 filtered leaves on `Accounts`
  // would pull in 15.6 MB via the full ancestor walk (75% of the full map) —
  // exactly the coupling that pays off for the visible rows (comment above)
  // flips into the opposite for a filter list of this size. A name already
  // served by the envelope (`known`) is left untouched — the envelope wins.
  if (flat) {
    for (const n of flat) {
      if (!n || closure.has(n)) { continue; }
      const f = full.first[n];
      if (f !== undefined) { first[n] = f; }
      if (parentSet.has(n)) { hasChildren[n] = true; }
    }
  }

  return { first, all, hasChildren };
}
