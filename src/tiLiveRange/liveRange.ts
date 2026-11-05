import type { Def, LiveRange, Pos } from './types';
import type { ReachRead } from './reachingDefs';

export function liveRangeOf(defs: Def[], reaching: ReachRead[], defId: number): LiveRange {
  const def = defs.find(d => d.id === defId);
  if (!def) { return { defId, positions: [], refused: 'notfound' }; }
  const rangeReads = reaching.filter(r => r.reachedBy.includes(defId));
  if (rangeReads.some(r => r.reachedBy.length >= 2)) { return { defId, positions: [], refused: 'merge' }; }
  const positions: Pos[] = [def.lhs, ...rangeReads.map(r => r.occ)];
  return { defId, positions };
}
