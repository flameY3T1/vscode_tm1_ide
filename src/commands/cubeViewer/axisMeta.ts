import type { Tm1Config } from '../../tm1Rest/transport/types';
import { getDimStructure, getDimChildIndex } from './dimStructCache';
import { scopeParentMaps } from './axisMetaScopePure';

/** Per-row Level array for a tuple slice, computed from per-dim level maps. Pure. */
export function levelsForSlice(
  tuples: string[][], dims: string[], levelMaps: ReadonlyArray<Map<string, number>>,
): number[][] {
  return tuples.map((t) => dims.map((_, di) => levelMaps[di]?.get(t[di] ?? '') ?? 0));
}

/**
 * Axis metadata bundle: per-row/col Level array + a trimmed parent map per dim.
 * Enables client-side expand/collapse in the webview.
 *
 * `extraKnown` (optional, the active filter list per dimension) goes in as
 * `flat` into `scopeParentMaps` — WITHOUT an ancestor walk. Reason: a
 * counter-measurement on 2026-08-11 — hanging the filter list onto the
 * ancestor envelope costs 15.6 MB for a large filter list (10,000 leaves on
 * `Accounts`) instead of a fraction of that.
 */
export async function _buildAxisMeta(
  dims: string[], tuples: string[][], config: Tm1Config,
  extraKnown?: ReadonlyArray<ReadonlyArray<string>>,
): Promise<{
  levels: number[][] | null;
  parents: Record<string, string>[];
  allParents: Record<string, string[]>[];
  hasChildren: Record<string, true>[];
  levelMaps: Map<string, number>[];
}> {
  if (dims.length === 0) {
    return { levels: null, parents: [], allParents: [], hasChildren: [], levelMaps: [] };
  }

  // Levels, parent maps and the child index all come together from the
  // structure cache: one stamp probe per dimension, and no full table at all
  // when the stamp is unchanged. `scopeParentMaps` then trims down to the
  // ancestor envelope over the loaded tuples (plus, flat, the active filter
  // list) — the client never sees more than it can also name.
  const per = await Promise.all(dims.map(async (d, di) => {
    try {
      const [struct, index] = await Promise.all([
        getDimStructure(d, config),
        getDimChildIndex(d, config),
      ]);
      const known = new Set<string>();
      for (const t of tuples) { const n = t[di]; if (n) { known.add(n); } }
      const scoped = scopeParentMaps(known, struct.parents, index.parentSet, extraKnown?.[di]);
      return { levels: struct.levels, scoped };
    } catch {
      return {
        levels: new Map<string, number>(),
        scoped: { first: {}, all: {}, hasChildren: {} },
      };
    }
  }));

  const levelMaps = per.map((p) => p.levels);
  const parents = per.map((p) => p.scoped.first);
  const allParents = per.map((p) => p.scoped.all);
  const hasChildren = per.map((p) => p.scoped.hasChildren);
  const levels = levelMaps.every((m) => m.size === 0)
    ? null
    : levelsForSlice(tuples, dims, levelMaps);

  return { levels, parents, allParents, hasChildren, levelMaps };
}
