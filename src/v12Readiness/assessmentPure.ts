/**
 * Saved state of the readiness check: which causes are known false alarms, which unused
 * processes are to be retired, and the comparison of a new scan with the last saved one.
 * Owners, tasks and effort stay out on purpose (decision 2026-10-07) — they belong in the
 * consultant's own tools, which the Markdown export feeds. Pure — the host does the file I/O.
 *
 * The file holds names, counts and decisions only: no TI code, no data source details,
 * no server URL (the alias the user gave the server is the only server reference).
 */
import type { Analysis, CauseGroup, ScanInput } from './types';

export type CauseStatus = 'open' | 'not-an-issue';
export type UsageStatus = 'unclear' | 'retire' | 'keep';
export const CAUSE_STATUSES: readonly CauseStatus[] = ['open', 'not-an-issue'];
export const USAGE_STATUSES: readonly UsageStatus[] = ['unclear', 'retire', 'keep'];

export interface Decision {
  status: CauseStatus | UsageStatus;
  updatedAt: string;
}

/** What the next scan is compared against. */
export interface Baseline {
  scannedAt: string;
  complete: boolean;
  /** Sources that could not be read — a cause from one of them was never looked for. */
  gaps: string[];
  /** A full compile check ran: only then can a compiler error be "no longer found". */
  compiled: boolean;
  /** Cause id → display label and number of processes and cubes. */
  causes: Record<string, { label: string; processes: number }>;
  usage: string[];
}

export interface AssessmentFile {
  kind: 'tm1-v12-readiness-assessment';
  schemaVersion: 1;
  serverAlias: string;
  savedAt: string;
  baseline: Baseline;
  decisions: Record<string, Decision>;
}

export const causeId = (g: Pick<CauseGroup, 'rule' | 'key'>): string => `${g.rule}|${g.key.toLowerCase()}`;
export const usageId = (process: string): string => `usage|${process.toLowerCase()}`;

/** Distinct processes and cubes of a cause — a cube may share its name with a process. */
const objectCount = (g: CauseGroup): number => new Set(g.occurrences.map(o => (o.rules ? 'cube|' : 'proc|') + o.process)).size;

const compiledFully = (scan: ScanInput): boolean => !!scan.compile && !scan.compile.partial;

export function baselineOf(scan: ScanInput, a: Analysis): Baseline {
  const causes: Baseline['causes'] = {};
  for (const g of a.groups) {
    causes[causeId(g)] = { label: `${g.rule}: ${g.key}`, processes: objectCount(g) };
  }
  return {
    scannedAt: scan.scannedAt, complete: scan.complete, gaps: [...scan.gaps], compiled: compiledFully(scan),
    causes, usage: a.usageNotEvidenced.map(r => r.process),
  };
}

export function toAssessmentFile(scan: ScanInput, a: Analysis, decisions: Record<string, Decision>, savedAt: string): AssessmentFile {
  return {
    kind: 'tm1-v12-readiness-assessment',
    schemaVersion: 1,
    serverAlias: scan.serverAlias,
    savedAt,
    baseline: baselineOf(scan, a),
    decisions,
  };
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const ALL_STATUSES = new Set<string>([...CAUSE_STATUSES, ...USAGE_STATUSES]);

/**
 * Reads a file written by `toAssessmentFile`. Throws on anything else — a foreign or newer
 * file must not be half-read and then saved back over itself. Unknown statuses are dropped
 * per entry, not per file; extra fields are ignored.
 */
export function parseAssessmentFile(text: string): AssessmentFile {
  const j = JSON.parse(text) as Partial<AssessmentFile> | null;
  if (!j || j.kind !== 'tm1-v12-readiness-assessment') { throw new Error('not an assessment file'); }
  if (j.schemaVersion !== 1) { throw new Error(`unsupported schema version ${String(j.schemaVersion)}`); }
  const b = j.baseline;
  if (!b || !isStr(b.scannedAt) || typeof b.causes !== 'object' || !Array.isArray(b.usage)) { throw new Error('baseline missing'); }
  const decisions: Record<string, Decision> = {};
  for (const [id, d] of Object.entries(j.decisions ?? {})) {
    if (!d || !ALL_STATUSES.has(d.status as string)) { continue; }
    decisions[id] = { status: d.status, updatedAt: isStr(d.updatedAt) ? d.updatedAt : '' };
  }
  return {
    kind: 'tm1-v12-readiness-assessment',
    schemaVersion: 1,
    serverAlias: isStr(j.serverAlias) ? j.serverAlias : '',
    savedAt: isStr(j.savedAt) ? j.savedAt : '',
    baseline: {
      scannedAt: b.scannedAt,
      complete: b.complete === true,
      gaps: Array.isArray(b.gaps) ? b.gaps.filter(isStr) : [],
      // Files from before the field: a compiler finding in the baseline means a compile ran.
      compiled: typeof b.compiled === 'boolean' ? b.compiled : Object.keys(b.causes).some(id => id.startsWith('compile-error|')),
      causes: Object.fromEntries(Object.entries(b.causes).filter(([, c]) => c && isStr(c.label) && typeof c.processes === 'number')),
      usage: b.usage.filter(isStr),
    },
    decisions,
  };
}

export interface Comparison {
  since: string;
  /**
   * False when either scan was incomplete, the new one missed a source the baseline read, or
   * the baseline was compiled and the new scan was not: "no longer found" may then just be
   * "not read".
   */
  comparable: boolean;
  newCauses: string[];
  /** Causes of the baseline without a finding now — never called "fixed". */
  goneCauses: Array<{ id: string; label: string; processes: number }>;
  /** Cause id → object count in the baseline, where it changed. */
  changedCount: Record<string, number>;
}

export function compare(base: Baseline, scan: ScanInput, a: Analysis): Comparison {
  const now = new Map(a.groups.map(g => [causeId(g), g]));
  const newCauses: string[] = [];
  const changedCount: Record<string, number> = {};
  for (const [id, g] of now) {
    const before = base.causes[id];
    if (!before) { newCauses.push(id); continue; }
    const n = objectCount(g);
    if (n !== before.processes) { changedCount[id] = before.processes; }
  }
  const goneCauses = Object.entries(base.causes)
    .filter(([id]) => !now.has(id))
    .map(([id, c]) => ({ id, label: c.label, processes: c.processes }));
  const comparable = base.complete && scan.complete
    && scan.gaps.every(g => base.gaps.includes(g))
    && (!base.compiled || compiledFully(scan));
  return { since: base.scannedAt, comparable, newCauses, goneCauses, changedCount };
}
