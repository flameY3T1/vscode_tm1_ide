import type { HierarchyStructure } from './types';

export function children(s: HierarchyStructure, n: string): string[] {
  return (s.childrenOf[n] || []).slice();
}

export function descendants(s: HierarchyStructure, n: string): string[] {
  const out: string[] = [];
  const seen: Record<string, boolean> = { [n]: true };
  const walk = (m: string): void => {
    for (const c of s.childrenOf[m] || []) {
      if (seen[c]) { continue; }
      seen[c] = true;
      out.push(c);
      walk(c);
    }
  };
  walk(n);
  return out;
}

export function expandAllSet(s: HierarchyStructure, n: string): string[] {
  return [n, ...descendants(s, n)];
}

export function leaves(s: HierarchyStructure, n: string): string[] {
  return descendants(s, n).filter((c) => {
    const m = s.meta[c];
    return !!m && m.level === 0;
  });
}

export function parents(s: HierarchyStructure, n: string): string[] {
  const p = s.allParentsOf[n] && s.allParentsOf[n].length
    ? s.allParentsOf[n]
    : (s.parentOf[n] ? [s.parentOf[n] as string] : []);
  return p.slice();
}

export function allParents(s: HierarchyStructure, n: string): string[] {
  const out: string[] = [];
  const seen: Record<string, boolean> = { [n]: true };
  const queue = [...parents(s, n)];
  while (queue.length) {
    const p = queue.shift() as string;
    if (seen[p]) { continue; }
    seen[p] = true;
    out.push(p);
    queue.push(...parents(s, p));
  }
  return out;
}
