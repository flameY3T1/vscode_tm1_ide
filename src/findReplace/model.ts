import { Match, MatchOpts, findMatches, applyReplacements } from './matchEngine';

export type UnitKey = 'prolog' | 'metadata' | 'data' | 'epilog' | 'rule';
export interface SearchableUnit { key: UnitKey; text: string; }
export interface ObjectCorpusEntry { objectKind: 'process' | 'rule'; objectName: string; units: SearchableUnit[]; }
export interface FileMatch { id: string; objectKind: 'process' | 'rule'; objectName: string; unit: UnitKey; match: Match; }
export interface ObjectGroup { objectKind: 'process' | 'rule'; objectName: string; matches: FileMatch[]; }
export interface ObjectEdit {
  objectKind: 'process' | 'rule';
  objectName: string;
  changedSections: Partial<Record<'prolog' | 'metadata' | 'data' | 'epilog', string>>;
  newRules?: string;
}

function matchId(kind: string, name: string, unit: UnitKey, m: Match): string {
  // length is part of the id so a stale id (from a previous query) cannot collide
  // with a new-query match that happens to start at the same line:column.
  return `${kind}:${name}:${unit}:${m.line}:${m.column}:${m.length}`;
}

export interface CorpusFilter {
  includeProcesses: boolean;
  includeRules: boolean;
  /** Process-name prefixes (case-insensitive). Empty → no prefix restriction. */
  prefixes: string[];
  /** Process-name suffixes (case-insensitive). Empty → no suffix restriction. */
  suffixes: string[];
  /** Process-name substrings (case-insensitive). Empty → no contains restriction. */
  contains: string[];
  /** Include TM1 control objects (name starts with `}`, case-sensitive) — both
   *  processes and rules/cubes. Default (missing/false) excludes them. */
  includeControl?: boolean;
}

/**
 * Narrow a corpus before searching: drop object kinds the user unticked, drop
 * control objects (name starts with `}`, case-sensitive — applies to BOTH
 * processes and rules/cubes) unless `includeControl` is true, and — for
 * processes only — keep just those whose name starts with any of `prefixes`
 * OR ends with any of `suffixes`. Prefix/suffix matching is case-insensitive to
 * mirror the case-insensitive search. Rules are unaffected by prefix/suffix
 * (those name filters target TI processes). Empty prefix+suffix lists impose no
 * name restriction.
 */
export function filterCorpus(corpus: ObjectCorpusEntry[], filter: CorpusFilter): ObjectCorpusEntry[] {
  const pre = filter.prefixes.map(p => p.toLowerCase()).filter(p => p !== '');
  const suf = filter.suffixes.map(s => s.toLowerCase()).filter(s => s !== '');
  const con = (filter.contains ?? []).map(c => c.toLowerCase()).filter(c => c !== '');
  const hasNameFilter = pre.length > 0 || suf.length > 0 || con.length > 0;
  const includeControl = filter.includeControl ?? false;
  return corpus.filter(entry => {
    if (!includeControl && entry.objectName.startsWith('}')) { return false; }
    if (entry.objectKind === 'process' && !filter.includeProcesses) { return false; }
    if (entry.objectKind === 'rule' && !filter.includeRules) { return false; }
    if (entry.objectKind === 'process' && hasNameFilter) {
      const name = entry.objectName.toLowerCase();
      return pre.some(p => name.startsWith(p)) || suf.some(s => name.endsWith(s)) || con.some(c => name.includes(c));
    }
    return true;
  });
}

export function runSearch(corpus: ObjectCorpusEntry[], query: string, opts: MatchOpts): ObjectGroup[] {
  const groups: ObjectGroup[] = [];
  for (const entry of corpus) {
    const matches: FileMatch[] = [];
    for (const unit of entry.units) {
      for (const m of findMatches(unit.text, query, opts)) {
        matches.push({
          id: matchId(entry.objectKind, entry.objectName, unit.key, m),
          objectKind: entry.objectKind, objectName: entry.objectName, unit: unit.key, match: m,
        });
      }
    }
    if (matches.length > 0) { groups.push({ objectKind: entry.objectKind, objectName: entry.objectName, matches }); }
  }
  return groups;
}

/** Every match id present in `corpus` for `query`. Used to verify, at Replace
 *  time, that a selected id (captured at search time) still refers to a live
 *  match in a freshly re-fetched corpus. */
export function collectMatchIds(corpus: ObjectCorpusEntry[], query: string, opts: MatchOpts): Set<string> {
  const ids = new Set<string>();
  for (const entry of corpus) {
    for (const unit of entry.units) {
      for (const m of findMatches(unit.text, query, opts)) {
        ids.add(matchId(entry.objectKind, entry.objectName, unit.key, m));
      }
    }
  }
  return ids;
}

export interface ReplacePlan { edits: ObjectEdit[]; skipped: number; }

/**
 * Plan a Replace against `corpus`, which the caller MUST re-fetch fresh (never a
 * cached search snapshot). Each selected id is verified against the fresh corpus:
 * ids with no matching fresh match are dropped and counted in `skipped` — their
 * source changed since the search (colleague/own edit), so applying the stale
 * replacement would silently revert that change. Edits are rebuilt from the fresh
 * text, so non-overlapping foreign changes are preserved.
 */
export function planReplace(
  corpus: ObjectCorpusEntry[],
  selectedIds: string[],
  replacement: string,
  query: string,
  opts: MatchOpts,
): ReplacePlan {
  const freshIds = collectMatchIds(corpus, query, opts);
  const valid = new Set(selectedIds.filter(id => freshIds.has(id)));
  const skipped = selectedIds.length - valid.size;
  const edits = corpus
    .map(e => buildObjectEdits(e, valid, replacement, query, opts))
    .filter((e): e is ObjectEdit => e !== null);
  return { edits, skipped };
}

export function buildObjectEdits(
  entry: ObjectCorpusEntry,
  selectedIds: Set<string>,
  replacement: string,
  query: string,
  opts: MatchOpts,
): ObjectEdit | null {
  const edit: ObjectEdit = { objectKind: entry.objectKind, objectName: entry.objectName, changedSections: {} };
  let touched = false;
  for (const unit of entry.units) {
    const unitMatches = findMatches(unit.text, query, opts).filter(m =>
      selectedIds.has(matchId(entry.objectKind, entry.objectName, unit.key, m)));
    if (unitMatches.length === 0) { continue; }
    touched = true;
    const newText = applyReplacements(unit.text, unitMatches, replacement, query, opts);
    if (unit.key === 'rule') { edit.newRules = newText; }
    else { edit.changedSections[unit.key] = newText; }
  }
  return touched ? edit : null;
}
