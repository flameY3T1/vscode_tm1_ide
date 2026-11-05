/**
 * Data shapes of the v12 readiness check (spec 2026-10-08-tm1-v12-readiness-check-design.md,
 * Phase 1). No vscode, no REST — the scan in `commands/v12Readiness/` fills `ScanInput`,
 * everything after it is pure.
 */

export type ProcSection = 'prolog' | 'metadata' | 'data' | 'epilog';
export const PROC_SECTIONS: readonly ProcSection[] = ['prolog', 'metadata', 'data', 'epilog'];

/**
 * A process as the analysis sees it. The data source is reduced to type and name on
 * purpose: TM1 returns `password` and `userName` with an ODBC source, and the scan drops
 * them before anything else touches the object.
 */
export interface SourceProcess {
  name: string;
  dataSource: { type: string; nameForServer?: string };
  code: Record<ProcSection, string>;
  /**
   * Names and types, no default values. The compiler takes a parameter's type from its value —
   * without one a numeric parameter reads as text (143 instead of 49 rejections on 11.8 → 12.5.9) —
   * so `compileCheck` sends a neutral `0` / `''` instead of the real default.
   */
  parameters?: Array<{ Name: string; Type?: 'Numeric' | 'String' }>;
  /** `Position` is required by TM1 12's CompileProcess — without it every call answers 400 code 114. */
  variables?: Array<{ Name: string; Type?: 'Numeric' | 'String'; Position: number }>;
}

/** A statically resolved `ExecuteProcess`/`RunProcess` call (from the reference index). */
export interface StaticCall {
  caller: string;
  callee: string;
  section: ProcSection;
  /** 0-based within the section. */
  line: number;
}

/** What the message log said about process runs, or why it said nothing. */
export interface RunLogWindow {
  /** Lines read (logger `TM1.Process`). */
  lines: number;
  /** True when the read stopped at the cap — older runs were not seen. */
  capped: boolean;
  /** Oldest and newest timestamp read; absent when the log was empty. */
  from?: string;
  to?: string;
  /** Process names with at least one run in the window, lowercase. */
  processesLc: string[];
}

/** A cube's rule text — only cubes that have one. */
export interface CubeRules { cube: string; rules: string }

export type ObjectKind = 'cube' | 'dimension' | 'view' | 'subset' | 'parameter';
/** A model object by name; `parent` is the cube of a view, the hierarchy of a subset. */
export interface ModelObject { kind: ObjectKind; name: string; parent?: string }

/** MDX stored on the server: a dynamic subset's expression or an MDX view. */
export interface MdxSource { kind: 'subset' | 'view'; owner: string; name: string; mdx: string }

export interface ScanInput {
  serverAlias: string;
  productVersion?: string;
  scannedAt: string;
  /** False when the user cancelled — the report is then marked as partial. */
  complete: boolean;
  processes: SourceProcess[];
  /** Lowercase names of processes that are a task of an ACTIVE chore. */
  activeChoreProcessesLc: string[];
  calls: StaticCall[];
  /** Undefined when the rules were not read (older saved scans, read failure → gap). */
  cubeRules?: CubeRules[];
  /** Subset expressions and MDX views; undefined when not read. */
  mdxSources?: MdxSource[];
  /** Public cubes, dimensions, views and subsets; undefined when not read. */
  objects?: ModelObject[];
  /**
   * Parameters set in tm1s.cfg (`/StaticConfiguration`, non-null leaves) under their tm1s.cfg
   * name. Undefined when not read — the endpoint needs admin rights.
   */
  configParams?: Array<{ name: string; path: string; value: string }>;
  /**
   * Result of dry-compiling every process on a connected TM1 12 database
   * (`POST /CompileProcess`, nothing is saved). Undefined until the user runs it.
   */
  compile?: CompileResult;
  /** Number of chores named `}tp_*` (TM1 Applications). */
  tpChores?: number;
  /** Undefined when the message log could not be read. */
  runLog?: RunLogWindow;
  /** Sources whose read failed (`chores`, `message log`, `call index`, …). */
  gaps: string[];
}

export interface CompileFailure { process: string; section: ProcSection; /** 0-based. */ line: number; message: string }
export interface CompileResult {
  server: string;
  version?: string;
  checked: number;
  failures: CompileFailure[];
  /** Processes TM1 refused to take for compiling (HTTP error) — neither passed nor failed. */
  notCheckable: string[];
  /** True when the run was cancelled before every process was compiled. */
  partial: boolean;
}

export type Evidence = 'ibm' | 'measured' | 'reported';
export type Severity = 'blocker' | 'integration' | 'config';
export type RuleId = 'removed-function' | 'file-path' | 'odbc' | 'control-cube' | 'invalid-name' | 'cfg-param' | 'compile-error' | 'mdx';

export interface Occurrence {
  /** Process name, or the cube name when `rules` is set. */
  process: string;
  /** Set for findings in a cube's rule text; `line` is then 0-based within the rules. */
  rules?: true;
  /** Set for findings on a model object's name; `process` then holds the object's display name. */
  object?: ObjectKind;
  /** Absent for findings on the process object (its data source). */
  section?: ProcSection;
  /** 0-based within the section. */
  line?: number;
  /** What was matched — function name, path or DSN. Never a code excerpt. */
  detail: string;
}

/**
 * One cause with all its occurrences. A cause, not a code line, is the unit of work:
 * 33 processes calling `ExecuteCommand` are one decision about running external commands.
 */
export interface CauseGroup {
  rule: RuleId;
  /** Grouping key: function name, `C:\Export`, `\\host\share`, DSN or cube name. */
  key: string;
  severity: Severity;
  evidence: Evidence;
  /** IBM's successor, only where IBM names one. */
  replacement?: string;
  occurrences: Occurrence[];
}

export interface UsageRow {
  process: string;
  ranInWindow: boolean;
  inActiveChore: boolean;
  calledBy: string[];
}

export interface Analysis {
  groups: CauseGroup[];
  /** Callers of a process with a blocker finding, with the blocked callee(s). */
  affectedViaCall: Array<{ process: string; callees: string[] }>;
  /** Processes that call another process through a name only known at runtime. */
  dynamicCallers: string[];
  /** Processes without any usage signal. */
  usageNotEvidenced: UsageRow[];
  processCount: number;
  /** Cubes with rule text that were checked; undefined when rules were not read. */
  rulesCubeCount?: number;
  controlProcessCount: number;
  /**
   * TM1 Applications (`}tp_*`): carried over by the migration but useless on TM1 12, so a
   * separate decision. Their findings are kept out of the cause groups and counts above.
   */
  tm1Applications: { processes: number; chores: number; withBlocker: string[] };
  /** Compile check summary: rejected on TM1 12, and how many of those the static rules already found. */
  compileSummary?: { server: string; version?: string; checked: number; rejected: number; alsoStatic: number; partial: boolean; notCheckable: number };
}
