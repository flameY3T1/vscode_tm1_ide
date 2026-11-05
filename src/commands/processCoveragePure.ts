/**
 * Coverage of a TI process: which lines a real run reached, how often, and
 * which branches of an IF/WHILE were taken.
 *
 * Measured via the debugger (see `processCoverageWalk.ts`) — TM1 reports no
 * lines during a normal execution. This file holds only what follows from
 * the source text and the collected hits; no `vscode`, no network.
 */
import { parseTiCode } from '../tiLogicVisualizer/tiParser';
import type { TiStatement } from '../tiLogicVisualizer/types';

export const SECTIONS = ['prolog', 'metadata', 'data', 'epilog'] as const;
export type Section = typeof SECTIONS[number];
export type Sections = Record<Section, string>;

/** Name of the tab, as the debugger carries it in `Procedure`. */
export function procedureName(s: Section): string {
  return s[0].toUpperCase() + s.slice(1);
}

export function sectionOf(procedure: string | undefined): Section | undefined {
  const s = (procedure ?? '').toLowerCase();
  return (SECTIONS as readonly string[]).includes(s) ? s as Section : undefined;
}

/** Breakpoint id per tab and line: four tabs, none has 10,000 lines. */
export function breakpointId(s: Section, line: number): number {
  return SECTIONS.indexOf(s) * 10000 + line;
}

export function lineKey(s: Section, line: number): string {
  return `${s}:${line}`;
}

/** A branch: the IF part, ELSEIF, ELSE, the silent "no part ran", or a loop body. */
export interface BranchDef {
  section: Section;
  /** Line of the branch point (IF or WHILE). */
  line: number;
  kind: 'if' | 'elseif' | 'else' | 'implicitElse' | 'whileBody' | 'whileSkipped';
  condition: string;
  /** Line of the first statement in the branch; `undefined` for an empty body. */
  firstLine?: number;
}

export interface SectionModel {
  /**
   * The measurable lines: for each statement, the line with its closing
   * `;`. That is where the debugger stops — measured 2026-09-23 (v11): a
   * statement spanning lines 7-8 (`|` continuation) stops on 8, a
   * breakpoint on 7 is never hit.
   */
  lines: number[];
  /** First line of a multi-line statement, per measurable line (only where different). */
  starts: Record<number, number>;
  branches: BranchDef[];
  /** The parser did not get through: rough lines, no branches. */
  parseError?: string;
}

export type CoverageModel = Record<Section, SectionModel>;

/**
 * Rough line selection when the parser fails: everything except blank and
 * comment lines. Continuation lines then count wrongly too.
 */
function roughLines(text: string): number[] {
  const out: number[] = [];
  text.split('\n').forEach((l, i) => {
    const t = l.trim();
    if (t !== '' && !t.startsWith('#')) { out.push(i + 1); }
  });
  return out;
}

/** Without string literals and comment — what remains decides the statement end. */
function codeOnly(line: string): string {
  let out = '';
  let inStr = false;
  for (const c of line) {
    if (inStr) { if (c === "'") { inStr = false; } continue; }
    if (c === "'") { inStr = true; continue; }
    if (c === '#') { break; }
    out += c;
  }
  return out.trim();
}

/** Line on which the statement starting at `start` ends with `;`. */
function statementEnd(src: string[], start: number): number {
  for (let i = start; i <= src.length && i < start + 200; i++) {
    if (codeOnly(src[i - 1]).endsWith(';')) { return i; }
  }
  return start;
}

function walk(stmts: TiStatement[], section: Section, lines: Set<number>, branches: BranchDef[], end: (l: number) => number): void {
  for (const st0 of stmts) {
    const st = { ...st0, line: end(st0.line) } as TiStatement;
    lines.add(st.line);
    if (st.type === 'if') {
      const parts: Array<{ kind: BranchDef['kind']; condition: string; body: TiStatement[] }> = [
        { kind: 'if', condition: st.condition, body: st.thenBody },
        ...st.elseIfClauses.map(c => ({ kind: 'elseif' as const, condition: c.condition, body: c.body })),
      ];
      const hasElse = st.elseBody.length > 0;
      if (hasElse) { parts.push({ kind: 'else', condition: '', body: st.elseBody }); }
      for (const p of parts) {
        branches.push({ section, line: st.line, kind: p.kind, condition: p.condition, firstLine: p.body[0] && end(p.body[0].line) });
        walk(p.body, section, lines, branches, end);
      }
      for (const c of st.elseIfClauses) { lines.add(end(c.line)); }
      if (!hasElse) { branches.push({ section, line: st.line, kind: 'implicitElse', condition: st.condition }); }
    } else if (st.type === 'while') {
      branches.push({ section, line: st.line, kind: 'whileBody', condition: st.condition, firstLine: st.body[0] && end(st.body[0].line) });
      branches.push({ section, line: st.line, kind: 'whileSkipped', condition: st.condition });
      walk(st.body, section, lines, branches, end);
    }
  }
}

export function buildModel(sections: Sections): CoverageModel {
  const out = {} as CoverageModel;
  for (const s of SECTIONS) {
    const text = sections[s] ?? '';
    const res = parseTiCode(text);
    if (!res.ok) {
      out[s] = { lines: roughLines(text), starts: {}, branches: [], parseError: `${res.error.line}: ${res.error.message}` };
      continue;
    }
    const src = text.split('\n');
    const starts: Record<number, number> = {};
    const end = (l: number): number => {
      const e = statementEnd(src, l);
      if (e !== l) { starts[e] = l; }
      return e;
    };
    const lines = new Set<number>();
    const branches: BranchDef[] = [];
    walk(res.ast, s, lines, branches, end);
    out[s] = { lines: [...lines].sort((a, b) => a - b), starts, branches };
  }
  return out;
}

/** One recorded run. */
export interface CoverageRun {
  at: string;
  params: Array<{ Name: string; Value: string | number }>;
  /** Hits per `lineKey`. */
  hits: Record<string, number>;
  /** Lines whose count was capped at the ceiling (the value is "at least"). */
  capped: string[];
  /** This run's ceiling; 1 means: reached/not reached only. */
  cap: number;
  status: string;
  /** Recording aborted, the process ran to the end without hitting breakpoints. */
  cancelled?: boolean;
  durationMs: number;
}

/**
 * How often a branch was taken in ONE run. `undefined` = not determinable
 * (capped count, empty body, branch on the head line). `>= 1` means taken,
 * `0` means definitely not taken.
 */
export function branchTaken(b: BranchDef, all: BranchDef[], run: CoverageRun): number | undefined {
  const k = (l: number) => lineKey(b.section, l);
  const n = (l: number) => run.hits[k(l)] ?? 0;
  const exact = (l: number) => run.cap > 1 && !run.capped.includes(k(l));
  const head = n(b.line);
  if (head === 0) { return 0; }
  if (b.kind === 'implicitElse' || b.kind === 'whileSkipped') {
    // The bodies of the same branch point; without their own first line, nothing can be derived.
    const bodies = all.filter(o => o.section === b.section && o.line === b.line
      && o.kind !== 'implicitElse' && o.kind !== 'whileSkipped');
    if (bodies.some(o => o.firstLine === undefined || o.firstLine === b.line)) { return undefined; }
    const inBodies = bodies.reduce((sum, o) => sum + n(o.firstLine!), 0);
    // The head ran, no body did: definitely taken.
    if (inBodies === 0) { return head; }
    // A WHILE head runs once per round plus once to exit — whether it was
    // ever left without a single round is not something the sums can tell.
    if (b.kind === 'whileSkipped') { return undefined; }
    // Head ran more often than all bodies combined: the rest fell through. Only with exact counts.
    if (![b.line, ...bodies.map(o => o.firstLine!)].every(exact)) { return undefined; }
    return Math.max(0, head - inBodies);
  }
  if (b.firstLine === undefined || b.firstLine === b.line) { return undefined; }
  return n(b.firstLine);
}

export interface Summary {
  lines: number;
  hitLines: number;
  branches: number;
  /** Branches taken in at least one run. */
  takenBranches: number;
  /** Branches that no run says anything about. */
  unknownBranches: number;
}

/** Hits across all runs; `capped` when a run counted with a ceiling. */
export function mergedHits(runs: CoverageRun[]): { hits: Map<string, number>; capped: Set<string>; byRun: Map<string, number[]> } {
  const hits = new Map<string, number>();
  const capped = new Set<string>();
  const byRun = new Map<string, number[]>();
  runs.forEach((r, i) => {
    for (const [k, v] of Object.entries(r.hits)) {
      hits.set(k, (hits.get(k) ?? 0) + v);
      if (v > 0) { byRun.set(k, [...(byRun.get(k) ?? []), i + 1]); }
    }
    for (const k of r.capped) { capped.add(k); }
    if (r.cap <= 1) { for (const k of Object.keys(r.hits)) { capped.add(k); } }
  });
  return { hits, capped, byRun };
}

/** Per branch: which runs took it, and whether anything is known at all. */
export function branchStatus(b: BranchDef, model: CoverageModel, runs: CoverageRun[]): { runs: number[]; unknown: boolean } {
  const taken: number[] = [];
  let known = false;
  runs.forEach((r, i) => {
    const t = branchTaken(b, model[b.section].branches, r);
    if (t === undefined) { return; }
    known = true;
    if (t > 0) { taken.push(i + 1); }
  });
  return { runs: taken, unknown: !known && runs.length > 0 };
}

export function summarize(model: CoverageModel, runs: CoverageRun[], only?: Section): Summary {
  const { hits } = mergedHits(runs);
  const out: Summary = { lines: 0, hitLines: 0, branches: 0, takenBranches: 0, unknownBranches: 0 };
  for (const s of only ? [only] : SECTIONS) {
    for (const l of model[s].lines) {
      out.lines++;
      if ((hits.get(lineKey(s, l)) ?? 0) > 0) { out.hitLines++; }
    }
    for (const b of model[s].branches) {
      out.branches++;
      const st = branchStatus(b, model, runs);
      if (st.runs.length > 0) { out.takenBranches++; } else if (st.unknown) { out.unknownBranches++; }
    }
  }
  return out;
}

export function percent(part: number, whole: number): number {
  return whole === 0 ? 100 : Math.floor((part / whole) * 1000) / 10;
}

/** Same source text? Merging runs against a different revision would make no sense. */
export function sameSections(a: Sections, b: Sections): boolean {
  return SECTIONS.every(s => (a[s] ?? '') === (b[s] ?? ''));
}
