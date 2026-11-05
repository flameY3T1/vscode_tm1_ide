import type { TiAst, TiStatement } from '../tiLogicVisualizer/types';
import type { Def, ReadOcc, Pos } from './types';

export interface ReachRead { occ: Pos; reachedBy: number[] }

type DefSet = Set<number>;
const clone = (s: DefSet): DefSet => new Set(s);
const union = (a: DefSet, b: DefSet): DefSet => { const o = new Set(a); for (const x of b) { o.add(x); } return o; };
const eq = (a: DefSet, b: DefSet): boolean => a.size === b.size && [...a].every(x => b.has(x));

export function computeReaching(ast: TiAst, varLc: string, defs: Def[], reads: ReadOcc[]): ReachRead[] {
  const defIdByLine = new Map<number, number>();
  for (const d of defs) { defIdByLine.set(d.line, d.id); }
  const readsByLine = new Map<number, ReadOcc[]>();
  for (const r of reads) { const a = readsByLine.get(r.line); if (a) { a.push(r); } else { readsByLine.set(r.line, [r]); } }

  const raw: ReachRead[] = [];
  const emit = (line: number, cur: DefSet): void => {
    for (const r of readsByLine.get(line) ?? []) { raw.push({ occ: r.occ, reachedBy: [...cur] }); }
  };

  const run = (stmts: TiStatement[], inSet: DefSet): DefSet => {
    let cur = clone(inSet);
    for (const s of stmts) {
      if (s.type === 'assignment') {
        emit(s.line, cur); // RHS reads (incl. self-read) see the pre-kill set
        if (s.variable.toLowerCase() === varLc) {
          const id = defIdByLine.get(s.line);
          if (id !== undefined) { cur = new Set([id]); }
        }
      } else if (s.type === 'if') {
        emit(s.line, cur);
        const e = cur;
        const exits: DefSet[] = [run(s.thenBody, clone(e))];
        for (const c of s.elseIfClauses) { emit(c.line, e); exits.push(run(c.body, clone(e))); }
        if (s.elseBody.length > 0) { exits.push(run(s.elseBody, clone(e))); }
        else { exits.push(clone(e)); } // no else → fall-through
        cur = exits.reduce((acc, x) => union(acc, x), new Set<number>());
      } else if (s.type === 'while') {
        const e = cur;
        let bodyIn = clone(e);
        let bodyOut = clone(e);
        for (;;) {
          emit(s.line, bodyIn); // condition reads see the current fixpoint-in set
          const next = run(s.body, clone(bodyIn));
          const merged = union(e, next);
          if (eq(merged, bodyIn)) { bodyOut = next; break; }
          bodyIn = merged;
        }
        cur = union(e, bodyOut);
      } else if (s.type === 'functionCall') {
        emit(s.line, cur);
      }
    }
    return cur;
  };

  run(ast, new Set<number>());

  // Collapse duplicate emits (WHILE fixpoint re-runs the body): union reachedBy per position.
  const byKey = new Map<string, Set<number>>();
  const occByKey = new Map<string, Pos>();
  for (const r of raw) {
    const k = `${r.occ.line}:${r.occ.column}`;
    const set = byKey.get(k) ?? new Set<number>();
    for (const id of r.reachedBy) { set.add(id); }
    byKey.set(k, set); occByKey.set(k, r.occ);
  }
  return [...byKey].map(([k, set]) => ({ occ: occByKey.get(k)!, reachedBy: [...set].sort((a, b) => a - b) }));
}
