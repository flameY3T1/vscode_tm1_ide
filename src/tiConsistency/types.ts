import type { TiVarType } from '../references/variableEnv';
import type { ProcessParameter, ProcessVariable } from '../tm1Rest/transport/types';

export type RuleKind =
  | 'var-casing'
  | 'param-casing'
  | 'datasource-casing'
  | 'function-casing'
  | 'keyword-casing'
  | 'variable-naming'
  | 'param-naming'
  | 'datasource-naming';
export type IdentifierKind = 'local' | 'param' | 'datasource' | 'function' | 'keyword';
export type UnitKey = 'prolog' | 'metadata' | 'data' | 'epilog';

export interface Occurrence { process: string; unit: UnitKey; line: number; column: number; length: number; }
export interface Variant { spelling: string; count: number; occurrences: Occurrence[]; }

export interface FindingGroup {
  key: string; // grouping key (name.toLowerCase())
  kind: IdentifierKind;
  targetSuggestion: string;
  editableTarget: boolean;
  variants: Variant[]; // sorted by count desc
  collision?: string; // set by planRename per process; informational in UI
}

export interface RawFinding {
  key: string;
  kind: IdentifierKind;
  spelling: string;            // the spelling found in this process
  occurrences: Occurrence[];   // within one process
  target?: string;             // rule-supplied target (function/keyword/naming); undefined → engine derives most-frequent
}

export interface ConsistencyProcess {
  name: string;
  units: { key: UnitKey; text: string }[];
  params: { name: string; type: TiVarType }[];
  datasourceVars: { name: string; type: TiVarType }[];
  rawParams: ProcessParameter[];       // full objects, for PATCH rebuild
  rawVariables: ProcessVariable[];
}

export interface DeclPatch {
  params?: { from: string; to: string }[];
  datasourceVars?: { from: string; to: string }[];
}
export interface ConsistencyEdit {
  process: string;
  changedSections: Partial<Record<UnitKey, string>>;
  declPatch?: DeclPatch;
}

export interface RenamePlan {
  edits: ConsistencyEdit[];
  skipped: { process: string; reason: string }[];
}

/** Naming-convention prefixes, shared with the TI linter config (`namingPrefixes`). */
export interface NamingPrefixes {
  numeric?: string;
  string?: string;
  param?: string;
  datasource?: string;
}

/** Optional per-scan configuration. Only the naming rules read it today. */
export interface ScanOpts {
  namingPrefixes?: NamingPrefixes;
}

export interface ConsistencyRule {
  kind: RuleKind;
  editableTarget: boolean;
  touchesDeclarations: boolean;
  minVariantsToReport: number; // var-casing:2, others:1
  scan(proc: ConsistencyProcess, opts?: ScanOpts): RawFinding[];
}

export interface ConsistencyApplyReport {
  applied: string[];
  failed?: { process: string; error: string };
  notAttempted: string[];
  skipped: { process: string; reason: string }[];
}
