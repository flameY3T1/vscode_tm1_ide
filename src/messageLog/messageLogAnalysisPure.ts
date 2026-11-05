/** Pure parser + aggregator for the Message Log Analysis view — no vscode deps. */

export interface RawEntry {
  TimeStamp?: string;
  Timestamp?: string;
  /**
   * Server-side write sequence (`MessageLogEntries.ID`). Optional because it is
   * not part of the contract every server honours — the ordering code treats it
   * as evidence when present and falls back when it is not (see `chronological`).
   */
  ID?: number;
  /**
   * TM1 worker thread the line was written on (`MessageLogEntries.ThreadID`).
   *
   * This is the strongest pairing signal there is: an end line is ALWAYS written
   * on the thread that ran the process. Measured twice — 8277 of 8277 pairings in
   * a 29560-line `tm1server.log`, and 1997 of 1997 over REST on live 11.8 — with
   * ZERO end lines belonging to a start on another thread.
   *
   * Optional, because it is not part of the contract every server honours: the
   * matcher narrows by it only when the evidence is actually there (see
   * `narrowByThread`) and is otherwise unchanged.
   */
  ThreadID?: number;
  Level?: string;
  Message?: string;
  Text?: string;
  /**
   * The object a line belongs to, from the `name` field of a TM1 **v12** run-log
   * line. v11 has no counterpart and leaves it undefined.
   *
   * It is not a convenience: a v12 end line reads `Process execution finished
   * normally.` and names nobody, so this field is the ONLY place the process is
   * written. A parent and the children it launched share one file, so without it
   * every end line in a nested run would be unattributable.
   */
  Name?: string;
  /**
   * The chore this line's run belongs to — v12 only, and taken from the run-log
   * FILE NAME, because that is the only place it appears: the lines inside a
   * `ChoreLog_*.jsonl` name the processes the chore launched and never the chore
   * itself. v11 needs neither field: there the chore has its own start line and
   * every launched process says `by chore "X"` in its own text.
   */
  Chore?: string;
  /**
   * Identity of that ONE chore run (the run log's filename).
   *
   * Grouping by the chore NAME would merge tonight's run with last night's into
   * one node, since v12 gives a chore no start line to open and no end line to
   * close it — there would be nothing to tell two runs apart. The file is exactly
   * one run, so it is the honest key.
   */
  ChoreRun?: string;
  /**
   * v12 process run log the line came from. A `RunProcess` start names its
   * caller only by a thread number, so the caller is found inside this file.
   */
  RunFile?: string;
}

/**
 * `group` is NOT a run state: it is a chore whose end line is outside the fetched
 * window. A chore is a container for the processes it launched, so it must not sit
 * at 'running' forever (M5). TM1 *does* log a chore end (`Chore "x" finished
 * executing` / `Chore "x" time = 0.11 seconds`, both confirmed on live 11.8); when
 * that line is in the window the chore becomes `ok` and carries the scheduler
 * runtime. It still never enters the per-process statistics (M5).
 */
export type CallStatus = 'ok' | 'error' | 'running' | 'orphan' | 'group';

export interface CallNode {
  name: string;
  kind: 'process' | 'chore';
  /** '' when the start line is outside the fetched window (`truncated`) — never a fabricated time. */
  startTs: string;
  /**
   * Timestamp of the end line, raw from the log. `undefined` as long as no
   * end has been seen.
   *
   * This is a FACT from the log, not a runtime: `elapsedSec` stays untouched
   * and `null` where the server does not report one (a rollback on a lock
   * conflict does not report one). The display can build the time span from
   * this without a measurement being invented here.
   */
  endTs?: string;
  /**
   * The run started as TOP-LEVEL (`executed by user/chore`), even if it is
   * now hanging under a presumed caller.
   *
   * `references/runSource.ts#asRoots` collects on this afterwards: without
   * the flag, the runtimes of the `RunProcess` edges in the call graph would
   * be empty again.
   */
  startedTopLevel?: boolean;
  /**
   * The run was hung, as a presumably ASYNCHRONOUSLY started call, under
   * another run (`RunProcess`), instead of staying a root.
   *
   * Separate from `startedTopLevel`, because a process started by a CHORE is
   * also a top-level event — but it is a genuine child of its chore, and its
   * time counts there quite normally.
   */
  asyncAttached?: boolean;

  elapsedSec: number | null;
  selfSec: number | null;
  /** Clamped to 0..100 — text and bar must not disagree (M6). `inconsistent` flags the clamp. */
  selfPct: number | null;
  status: CallStatus;
  /**
   * End line seen without a matching start in the fetched window ($top cuts
   * mid-run). Runtime is real, start time and tree position are unknown (M3).
   */
  truncated: boolean;
  /**
   * Several runs of this name were open when an end line arrived and none of the
   * available discriminators separated them — the runtime shown may belong to a
   * sibling run (H4). Also set on the other candidates of that decision.
   */
  ambiguous: boolean;
  /** Children report more inclusive time than this node — the numbers cannot both be right (M6). */
  inconsistent: boolean;
  /**
   * Log file holding the failure, for `ErrorLogFiles('…')/Content`: v11 names it in
   * the end line (`<TM1ProcessError_….log>`), v12 has the run log itself.
   */
  errorFile?: string;
  /** First error line of the run — v12 only; v11 keeps the text in `errorFile`. */
  errorText?: string;
  children: CallNode[];
}

export interface ProcStat {
  name: string;
  kind: 'process' | 'chore';
  calls: number;
  totalSec: number;
  avgSec: number;
  minSec: number;
  maxSec: number;
  failures: number;
  /** Calls whose runtime could not be attributed with certainty (H4). */
  uncertain: number;
  /**
   * Sum of the runtimes of those `uncertain` calls. They are NOT part of
   * total/avg/min/max — a guessed runtime averaged into the aggregates is
   * indistinguishable from a measured one (LOW-4) — but they are not dropped
   * either: the UI shows them as the qualifier on the row.
   */
  uncertainSec: number;
}

export interface AnalysisResult {
  trees: CallNode[];
  stats: ProcStat[];
  parsedRuns: number;
  ignoredLines: number;
  entryCount: number;
}

export type LogEvent =
  /** `byRunProcess`: v12 `RunProcess` start — a top-level start whose caller
   *  is a process in the same run log, named only by its thread number. */
  | { type: 'top'; name: string; kind: 'process' | 'chore'; user?: string; chore?: string; byRunProcess?: true }
  | { type: 'child'; name: string; parent: string; user?: string }
  /**
   * `initFail` = the compile-failure verdict. It is the one end form that CANNOT be
   * a truncated end: TM1 writes it in the same breath as the start line it kills, so
   * a start line for it is always in the window too. When it finds no open run the
   * cause is the log's tie order at equal millisecond timestamps, not a `$top` cut —
   * and a truncated root for it would show nothing (no runtime, no children) while
   * double-counting the run in the statistics.
   */
  | {
      type: 'end'; name: string; elapsedSec: number | null; error: boolean; initFail?: true;
      /**
       * The log states no runtime and the wall clock is the only source — set on
       * v12 end lines, which report no seconds at all. v11 stays untouched: there
       * an absent runtime means the END FORM carries none (abort, rollback), and
       * timing it off the clock would invent a number the log never claimed.
       */
      elapsedFromClock?: true;
    }
  /**
   * TM1 splits the chore end over two lines and emits them in EITHER order (both
   * orders observed in one live 11.8 log), so each half is its own event and
   * whichever arrives second must still reach the already-closed node.
   */
  | { type: 'choreEnd'; name: string; elapsedSec: number | null };

// Match on quoted name + keyword, DE + EN. Order matters: end forms and child are
// checked before the generic top-level start (all begin `Process "X"`).
//
// Quoted names use `"([^"]+)"` instead of `"(.+?)"`: a dot-any lazy gap between two
// quotes backtracks quadratically on quote-dense lines (48 KB of TI LogOutput
// measured at 281 ms), a negated class cannot.
//
// The gap `(?:[^"]|"[^"]*")*?` still has to cross further quoted tokens — end lines
// name the data source (`data source "C:\tmp\x.csv", elapsed time 3.00 seconds`),
// and a quote-free gap drops those lines silently, leaving the run 'running'
// forever. Each iteration consumes either ONE non-quote char or ONE whole quoted
// token; the two alternatives are disjoint on their first character, so the
// decomposition is unique and the match stays linear.
//
// `+` (not `*`) is a DECISION, not an accident: live 11.8 emits nameless pairs
// (`Process "" executed by user "tm1user"` / `Prozess "":  Ausführung normal
// beendet, verstrichene Zeit 0.00 Sekunden`) for transient processes it deleted
// before it could resolve the name. Matching them makes the output strictly
// worse: in the observed log the nameless END is written BEFORE its start line,
// so the pair does not even close — it would render as one truncated stray root
// plus one node stuck at 'running', the exact defect this parser exists to avoid,
// and every unrelated nameless run would then share a single `""` statistics row.
// They stay out and are counted in `ignoredLines`.
const RE_END =/(?:Process|Prozess)\s+"([^"]+)":?\s(?:[^"]|"[^"]*")*?(?:verstrichene Zeit|elapsed time)\s+(\d+(?:[.,]\d+)?)\s+(?:Sekunden|seconds)/i;
// Error end WITHOUT an elapsed value: "mit Fehlern beendet", "abnormal beendet",
// "ended in error", or a rollback/lock abort.
//
// The phrase must sit in the FIRST segment behind the process name (gap excludes
// ':' and '"') and must end a word there. Otherwise a TI `LogOutput` line quoting
// the wording — `Prozess "A": Zeile 5: Text mit Fehlern beendet? no` — closes the
// run early, and the real end line then lands on the truncated-root path (M3).
const RE_END_ERROR = /(?:Process|Prozess)\s+"([^"]+)":?\s[^":]{0,80}?(?:mit\s+Fehlern?\s+beendet|abnormal\s+beendet|ended\s+in\s+error|rolling\s+back|rollback)(?=[\s.,;!]|$)/i;
// Compile failure: the run is over before it started and TM1 emits NO further line
// for it — no "mit Fehlern beendet", no runtime, nothing. Without this the node
// would sit at `running` for the rest of the log AND stay in the open-candidate
// pool, where it turns every later run of the same name into a tie (see
// `plausibleOpen` for the same defect from the other side).
//
// Matched on the trailing verdict, NOT on the `Fehler in Zeile N` head: that head
// also introduces ordinary RUNTIME errors, whose real end line still arrives and
// must not be pre-empted. The verdict must close the message (`\s*$`) so a TI
// `LogOutput` line quoting the wording mid-message cannot end the run (M3).
//
// Only the German verdict is live-evidenced (15× on 11.8); the English form is the
// documented counterpart and costs nothing to accept.
const RE_END_INIT_FAIL = /(?:Process|Prozess)\s+"([^"]+)":\s(?:[^"]|"[^"]*")*?(?:Der\s+Prozess\s+konnte\s+nicht\s+initialisiert\s+werden|(?:The\s+)?[Pp]rocess\s+could\s+not\s+be\s+initiali[sz]ed)\s*$/i;
// ── Ends WITHOUT a runtime, all three anchored directly behind `"<name>":` ──
//
// Aborted from outside (ProcessQuit, cancel, timeout). The German 11.8 build
// writes a DOUBLED colon behind the name — `Prozess "}zzP": : Die Ausführung
// wurde abgebrochen. Fehlerdatei: <…>` — so this one gap must tolerate a ':',
// which RE_END_ERROR's gap deliberately does not.
//
// TM1 may NAME the cause inside the sentence, which splits the two words this
// pattern used to require adjacent: `Prozess "X": : Die Ausführung wurde von der
// ProcessQuit-Funktion abgebrochen.` (live 11.8), likewise `Execution was aborted
// by the ProcessQuit function`. A bounded, colon- and quote-free gap in front of
// the participle covers every observed cause phrase and subsumes the former fixed
// alternatives (empty gap = the plain wording). Bounded like RE_END_ERROR's gap,
// and the verdict must end a word, so a TI `LogOutput` line quoting the wording
// cannot close a run from far away (M3).
const RE_END_ABORT = /(?:Process|Prozess)\s+"([^"]+)":\s*:?\s*(?:Die\s+)?(?:Ausführung\s+(?:wurde\s+)?[^":]{0,80}?abgebrochen|Execution\s+[^":]{0,80}?(?:aborted|cancell?ed))(?=[\s.,;!]|$)/i;
// Backstop for a ProcessQuit verdict whose sentence does NOT open with
// `Ausführung`/`Execution`. Only the German wording is live-evidenced; the English
// build is a translation of the same template, but the lead word is exactly the part
// a translation is free to drop (`Aborted by the ProcessQuit function`). Matching on
// the two tokens that must both be present — the function name and an abort verb,
// in EITHER order — is wording-independent, and demanding `ProcessQuit` keeps it far
// away from the generic-verb false positives a bare `aborted` would invite.
const RE_END_QUIT = /(?:Process|Prozess)\s+"([^"]+)":\s*:?\s*(?=[^":]{0,120}\bProcessQuit\b)(?=[^":]{0,160}(?:abgebrochen|aborted|cancell?ed|terminated)\b)/i;
// `Prozess "}bedrock.cube.data.copy":  mit ProcessBreak beendet` — a deliberate
// early exit of the data loop (Epilog still runs), logged at Info. A normal end,
// it just carries no runtime.
const RE_END_BREAK = /(?:Process|Prozess)\s+"([^"]+)":\s*(?:mit\s+ProcessBreak\s+beendet|(?:ended|finished|exited)\s+with\s+ProcessBreak)/i;
// Normal end with no runtime attached, e.g. `Prozess "}zzDir":  finished executing
// normally.  Check new message in the file: <…>` — note the GERMAN prefix on an
// ENGLISH body: 11.8 mixes both languages inside one log file, so every pattern
// here accepts either prefix with either body.
const RE_END_OK = /(?:Process|Prozess)\s+"([^"]+)":\s*(?:finished\s+executing\s+normally|Ausführung\s+normal\s+beendet)(?=[\s.,;!]|$)/i;
const RE_CHILD = /(?:Process|Prozess)\s+"([^"]+)"\s+(?:run from process|aus Prozess|von Prozess)\s+"([^"]+)"/i;
// PA as a Service (12.6.4) quotes names with ' instead of " — measured
// 2026-10-14. `(["'])…\1` takes either, and a quote of the OTHER kind stays
// part of the name.
const RE_TOP = /(?:Process|Prozess)\s+(["'])(.+?)\1\s+(?:executed by|ausgeführt von)/i;
const RE_CHORE = /(?:Chore|Ablauf)\s+"([^"]+)"\s+(?:executed|ausgeführt|started|gestartet|run)/i;
// Chore end, two halves in either order. Neither can be confused with RE_CHORE:
// that one requires its keyword immediately behind the name, and neither
// `finished executing` nor `time =` starts with one.
const RE_CHORE_TIME = /(?:Chore|Ablauf)\s+"([^"]+)"\s+(?:time|Zeit)\s*=\s*(\d+(?:[.,]\d+)?)\s+(?:seconds|Sekunden)/i;
const RE_CHORE_END = /(?:Chore|Ablauf)\s+"([^"]+)"\s+(?:finished\s+executing|beendet)/i;
// The launching principal — the ONLY discriminator TM1 puts on start lines when
// one process runs concurrently for several users/chores (end lines carry neither
// user nor thread id).
const RE_BY_USER = /\b(?:by user|von Benutzer)\s+(["'])(.+?)\1(?=[\s.,;]|$)/i;
const RE_BY_CHORE = /\b(?:by chore|von Ablauf)\s+(["'])(.+?)\1(?=[\s.,;]|$)/i;
// A normal end contains "normal"; an abnormal end contains "abnormal" (which itself
// contains "normal"). Test ONLY abnormal/error markers, never a bare "normal".
const RE_ERROR = /abnormal|in error|mit\s+Fehlern?/i;

// ── TM1 v12 (PA Engine) run-log forms ────────────────────────────────────────
// Measured live against 12.5.9 on 2026-08-26 by running throwaway processes for
// every exit path and reading the file back (`ProcessLog_*.jsonl`). English only:
// v12 writes these lines in English regardless of the server locale — unlike the
// v11 message log, which follows it.
//
// Two things make them their own parser rather than another alternative in the
// v11 patterns: the end lines name NOBODY (the process is in the line's `name`
// field, hence the `entryName` parameter), and none of them reports a runtime.
// On-prem: `Process "K" executed by Process "E" via ExecuteProcess.`
// SaaS:    `Process 'K' executed by process 'E' via ExecuteProcess() with parameters: (…).`
const RE_V12_CHILD = /^Process\s+(["'])(.+?)\1\s+executed\s+by\s+Process\s+(["'])(.+?)\3\s+via\s+ExecuteProcess/i;
// RunProcess names the caller by thread number only (measured 2026-10-14):
// on-prem `Process "A" executed by Process [1] via RunProcess with parameters: (…)`,
// SaaS `Process 'A' executed by process '3' via RunProcess() with parameters: (…)`.
const RE_V12_RUNPROCESS = /^Process\s+(["'])(.+?)\1\s+executed\s+by\s+Process\s+(?:\[[^\]]*\]|(["'])[^"']*\3)\s+via\s+RunProcess/i;
/**
 * The six end verdicts, all measured:
 *   finished normally.                    ← clean run
 *   finished with messages.               ← ItemReject / minor complaints
 *   finished with minor errors.
 *   finished with ProcessQuit().          ← deliberate stop
 *   aborted with errors.                  ← ProcessError, runtime failure
 *   aborted on initialization.            ← compile failure
 *   aborted with ProcessRollback().
 */
const RE_V12_END = /^Process execution (finished normally|finished with messages|finished with minor errors|finished with ProcessQuit\(\)|aborted with errors|aborted on initialization|aborted with ProcessRollback\(\))\.?$/i;

/**
 * Which v12 verdicts count as a failed run.
 *
 * `finished with messages` / `with minor errors` are errors here for the same
 * reason v11's `mit Fehlern beendet` is: the run wrote error lines and TM1
 * answers the execution with `CompletedWithMessages`, not `CompletedSuccessfully`.
 * `ProcessQuit()` follows v11's `RE_END_QUIT`, which is also an error — the run
 * stopped before doing its work, and the analysis exists to make that visible.
 */
function v12EndIsError(verdict: string): boolean {
  return !/^finished normally$/i.test(verdict);
}

function toNum(s: string): number { return parseFloat(s.replace(',', '.')); }

/**
 * `entryName` is the v12 line's `name` field (see `RawEntry.Name`); v11 callers
 * pass nothing and reach exactly the code they did before.
 */
export function parseLine(msg: string, entryName?: string): LogEvent | null {
  // v12 first: `Process "K" executed by Process "E" via ExecuteProcess.` also
  // satisfies the v11 top-level pattern (`Process "X" executed by`), which would
  // make every child its own root and lose the tree.
  let v = RE_V12_CHILD.exec(msg);
  if (v) { return { type: 'child', name: v[2], parent: v[4] }; }
  v = RE_V12_RUNPROCESS.exec(msg);
  if (v) { return { type: 'top', name: v[2], kind: 'process', byRunProcess: true }; }
  v = RE_V12_END.exec(msg.trim());
  if (v) {
    // No name in the text — without the entry's own name there is nothing to
    // close, and guessing from the open runs would attach the verdict to whatever
    // ran last. Report it as unparsed instead.
    if (!entryName) { return null; }
    const verdict = v[1];
    return {
      type: 'end',
      name: entryName,
      elapsedSec: null,
      elapsedFromClock: true,
      error: v12EndIsError(verdict),
      ...(/^aborted on initialization$/i.test(verdict) ? { initFail: true as const } : {}),
    };
  }

  let m = RE_END.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: toNum(m[2]), error: RE_ERROR.test(msg) }; }
  m = RE_END_ERROR.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: null, error: true }; }
  // An abort counts as `error`, not as a sixth CallStatus: TM1 logs it at Level
  // Error and writes the same `TM1ProcessError_*.log` artefact as any other
  // failure, the run did not do its work, and the log does not distinguish the
  // causes (ProcessQuit / cancel / timeout all land on this one line).
  m = RE_END_ABORT.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: null, error: true }; }
  m = RE_END_QUIT.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: null, error: true }; }
  // Same treatment as an abort: logged at Level Error, the run did not do its work,
  // and no runtime exists to report because none was spent.
  m = RE_END_INIT_FAIL.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: null, error: true, initFail: true }; }
  m = RE_END_BREAK.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: null, error: false }; }
  m = RE_END_OK.exec(msg);
  if (m) { return { type: 'end', name: m[1], elapsedSec: null, error: false }; }
  m = RE_CHORE_TIME.exec(msg);
  if (m) { return { type: 'choreEnd', name: m[1], elapsedSec: toNum(m[2]) }; }
  m = RE_CHORE_END.exec(msg);
  if (m) { return { type: 'choreEnd', name: m[1], elapsedSec: null }; }
  m = RE_CHILD.exec(msg);
  if (m) { return { type: 'child', name: m[1], parent: m[2], user: RE_BY_USER.exec(msg)?.[2] }; }
  m = RE_TOP.exec(msg);
  if (m) {
    return {
      type: 'top', name: m[2], kind: 'process',
      user: RE_BY_USER.exec(msg)?.[2],
      chore: RE_BY_CHORE.exec(msg)?.[2],
    };
  }
  m = RE_CHORE.exec(msg);
  if (m) { return { type: 'top', name: m[1], kind: 'chore' }; }
  return null;
}

/**
 * v11 end line naming an error file. Measured 2026-10-29 on 11.8 (chore step with
 * ItemReject): `Process "p2":  finished executing normally.  Check new message in
 * the file: <TM1ProcessError_….log>` — "normally", yet the chore answered REST with
 * "Chore execution finished with errors", the same run TM1 12 logs as
 * `finished with messages`, which already counts as an error here.
 */
const RE_ERROR_FILE = /<([^<>]+\.log)>/;

/**
 * A failed chore step makes the chore failed. Bottom-up so nested chores (a chore
 * launching processes that launch more) report the deepest failure too.
 */
function rollUpChoreErrors(node: CallNode): boolean {
  let failed = node.status === 'error';
  for (const c of node.children) { failed = rollUpChoreErrors(c) || failed; }
  if (failed && node.kind === 'chore') { node.status = 'error'; }
  return failed;
}

function round2(n: number): number { return Math.round(n * 100) / 100; }

function mkNode(
  name: string, kind: 'process' | 'chore', startTs: string, startedTopLevel?: boolean,
): CallNode {
  return {
    name, kind, startTs,
    ...(startedTopLevel ? { startedTopLevel: true } : {}),
    elapsedSec: null, selfSec: null, selfPct: null,
    status: kind === 'chore' ? 'group' : 'running',
    truncated: false, ambiguous: false, inconsistent: false,
    children: [],
  };
}

/** One still-open run plus the start-line facts an end line can be matched against. */
/** Start and end facts of a process run, raw from the log. */
interface RunFacts {
  user?: string;
  thread?: number;
  startMs: number | null;
  /** `null` as long as no end has been seen — the run is cut off at the window edge. */
  endMs: number | null;
}

/**
 * Hangs asynchronously started runs (`RunProcess`) under their presumed
 * caller, instead of leaving them standing as childless roots.
 *
 * Why at all: `RunProcess` writes NO `run from process` line — the call
 * appears as its own top-level run on its own thread. In a real log (29,581
 * lines), this left 3,767 of 3,829 roots childless.
 *
 * Why as a POST-PASS and not during the main pass: during that pass, only
 * the start is known for a candidate. A run whose end lies outside the
 * window would stay "open" forever and would catch everything later as a
 * false parent — exactly what happened on the fixture
 * `real-tm1-11.8-same-ms.json`. Here every end is fixed, and a candidate
 * must genuinely enclose the child's start.
 *
 * Three conditions, each from a counterexample:
 * - **different thread** — the same thread means sequential, not
 *   concurrent.
 * - **different name** — if a chore fans the same process out over many
 *   threads, the next candidate would be a SIBLING; the rule would build a
 *   chain among equals.
 * - **completed** — a run cut off at the window edge has no reliable end
 *   and may not adopt anyone.
 *
 * On the real log the rule fires for 3,606 of 3,615 top-level starts; the
 * caller thus chosen is the same caller process in 3,523 cases.
 */
function attachAsyncRuns(roots: CallNode[], meta: Map<CallNode, RunFacts>): CallNode[] {
  const candidates = roots.filter(r => r.kind === 'process' && r.startedTopLevel);
  // ALWAYS return a new list: the caller reassigns its `roots` from this
  // return value, and a `roots` returned as the same reference would have
  // emptied itself in the process.
  if (candidates.length === 0) { return roots.slice(); }

  // Possible callers: every COMPLETED process run with a user and a thread.
  const possible = [...meta.entries()]
    .filter(([, f]) => f.endMs != null && f.startMs != null && f.user && f.thread !== undefined);

  const attached = new Set<CallNode>();
  for (const kind of candidates) {
    const f = meta.get(kind);
    if (!f || f.startMs == null || !f.user || f.thread === undefined) { continue; }
    let best: CallNode | undefined;
    let bestStart = -Infinity;
    for (const [node, p] of possible) {
      if (node === kind) { continue; }
      if (p.user !== f.user || p.thread === f.thread) { continue; }
      if (node.name === kind.name) { continue; }
      // The child's start must genuinely lie within the caller's window.
      if (!(p.startMs! < f.startMs && f.startMs < p.endMs!)) { continue; }
      // The INNERMOST matching run: the latest start wins.
      if (p.startMs! > bestStart) { best = node; bestStart = p.startMs!; }
    }
    if (best && !isDescendant(kind, best)) {
      kind.asyncAttached = true;
      best.children.push(kind);
      attached.add(kind);
    }
  }
  return roots.filter(r => !attached.has(r));
}

/** Guard against a cycle: is `possible` already hanging below `node`? */
function isDescendant(node: CallNode, possible: CallNode): boolean {
  if (node === possible) { return true; }
  for (const k of node.children) { if (isDescendant(k, possible)) { return true; } }
  return false;
}

interface OpenRun {
  node: CallNode;
  user?: string;
  /** Epoch ms of the start line, `null` when the timestamp is unparsable. */
  startMs: number | null;
  /** Thread the START line was written on, `undefined` when the server omits it. */
  thread?: number;
}

/**
 * Narrow candidates to the ones started on `thread`.
 *
 * Evidence-gated on purpose: it only ever narrows when at least one candidate
 * actually carries that thread, so a server that omits `ThreadID`, a start line
 * cut off by `$top`, and the chore→process case (the chore is registered on the
 * scheduler thread, the process runs on a worker) all fall through to the
 * previous behaviour untouched. It can remove a candidate only in favour of one
 * the thread positively points at.
 *
 * Why this beats the arithmetic it precedes: TM1 rounds the reported runtime to
 * 1/100 s, and a chore fanning one process out over several threads starts them
 * milliseconds apart — so a foreign start routinely scores BETTER than the true
 * one. Counted on the real 29560-line log: of 3540 end lines with more than one
 * same-named candidate, arithmetic picked a different run than the thread in
 * **2329** cases, and 341 of those were error ends that report no runtime at all
 * and were closed by pure LIFO. The thread resolves 3526 of the 3540 outright;
 * the remaining 14 stay the arithmetic's job.
 */
function narrowByThread(cands: OpenRun[], thread: number | undefined): OpenRun[] {
  if (thread === undefined || cands.length < 2) { return cands; }
  const same = cands.filter(c => c.thread === thread);
  return same.length > 0 ? same : cands;
}

function tsMs(ts: string): number | null {
  if (!ts) { return null; }
  const t = Date.parse(ts);
  return Number.isNaN(t) ? null : t;
}

function entryTs(en: RawEntry): string { return en.TimeStamp ?? en.Timestamp ?? ''; }
function entryMsg(en: RawEntry): string { return en.Message ?? en.Text ?? ''; }

/**
 * A run that started and ended inside the SAME millisecond can only ever report
 * 0.00 s, because TM1 rounds elapsed time to 1/100 s. Anything above this is
 * positive proof that an end line does NOT belong to a start at the same instant.
 */
const SAME_MS_ELAPSED_MAX_SEC = 0.005;

/**
 * Reorder one group of entries that share a single millisecond, using the write
 * sequence the server assigned. `ID` counts up in write order, so within a
 * timestamp it is the literal answer to "which line was logged first" — no
 * inference needed, and it is right for both directions of the hard case below.
 *
 * Requires the WHOLE group to carry an ID: a partial sort would interleave
 * sequenced and unsequenced lines by an order that means nothing for half of them.
 */
function orderByWriteSequence(group: RawEntry[]): boolean {
  if (!group.every(e => typeof e.ID === 'number' && Number.isFinite(e.ID))) { return false; }
  group.sort((a, b) => (a.ID as number) - (b.ID as number));
  return true;
}

/**
 * Fallback for servers that do not send `ID`: pull a start line ahead of an end
 * line of the same name in the same millisecond — but ONLY when the end proves it
 * belongs there.
 *
 * The dangerous shape this must not break: one run of a name ENDS and another run
 * of the SAME name STARTS in the same millisecond. Ordering starts before ends
 * blindly would hand the end to the run that just started instead of the one that
 * just finished — the exact inversion of the truth.
 *
 * The reported runtime separates the two cases with no guessing left over. An end
 * that says 0.00 s cannot have come from a run that started earlier than this
 * millisecond, so its start must be the same-millisecond one. An end that says
 * 30 s cannot have come from a run that started in this millisecond, so it is left
 * where it is and reaches the older open run. Ends that report no runtime at all
 * (abort, rollback, init failure) carry no evidence either way and are never moved.
 */
function pullSameMsStartsBeforeTheirEnds(group: RawEntry[]): void {
  for (let i = 0; i < group.length; i++) {
    const ev = parseLine(entryMsg(group[i]), group[i].Name);
    if (!ev || ev.type !== 'end') { continue; }
    if (ev.elapsedSec == null || ev.elapsedSec > SAME_MS_ELAPSED_MAX_SEC) { continue; }
    for (let j = i + 1; j < group.length; j++) {
      const st = parseLine(entryMsg(group[j]), group[j].Name);
      if (!st) { continue; }
      const isProcessStart = st.type === 'child' || (st.type === 'top' && st.kind === 'process');
      if (!isProcessStart || st.name !== ev.name) { continue; }
      group.splice(i, 0, ...group.splice(j, 1));
      // The end now sits at i+1; skip it so a SECOND same-millisecond start of the
      // same name cannot be dragged in front of the end this one already claimed.
      i++;
      break;
    }
  }
}

/**
 * Fetched newest-first → walk oldest-first, with the order inside one millisecond
 * normalised.
 *
 * `$orderby=TimeStamp desc` leaves ties in whatever order the server felt like, and
 * TM1 does emit both halves of a 0.00 s run in one millisecond. Reversing an
 * arbitrary tie order can put an end line ahead of its own start, which renders as
 * a truncated stray root PLUS a node stuck at `running` and counts the one run twice
 * in the statistics.
 *
 * Reordering is confined to entries sharing one millisecond: whatever the tie-break
 * evidence is worth on a given server, it can never permute lines that the clock
 * already separates.
 */
function chronological(entries: RawEntry[]): RawEntry[] {
  const asc = [...entries].reverse();
  const stamps = asc.map(e => tsMs(entryTs(e)));
  for (let i = 0; i < asc.length;) {
    let j = i + 1;
    // An unparsable timestamp joins no group — nothing to tie-break against.
    if (stamps[i] != null) { while (j < asc.length && stamps[j] === stamps[i]) { j++; } }
    if (j - i > 1) {
      const group = asc.slice(i, j);
      if (!orderByWriteSequence(group)) { pullSameMsStartsBeforeTheirEnds(group); }
      for (let k = 0; k < group.length; k++) { asc[i + k] = group[k]; }
    }
    i = j;
  }
  return asc;
}

/**
 * Plausibility window for "did this end line come from that start line": the
 * wall-clock gap start→end must match the reported elapsed time. TM1 timestamps
 * are millisecond-precision but the elapsed value is rounded to 1/100 s and the
 * log write itself lags the run end, so allow 2 s of slack.
 */
const MATCH_TOL_SEC = 2.0;
/**
 * Minimum score distance between best and runner-up candidate. Below it the two
 * runs are indistinguishable and the pairing would be a coin flip → ambiguous.
 *
 * A systematic log-write lag `L` shifts the end timestamp of EVERY candidate by the
 * same amount, so the true owner scores `L` while a sibling that started `L` earlier
 * scores 0 — the winner flips silently whenever the start spacing is in the order of
 * the lag. The margin therefore has to exceed the plausible lag (`MATCH_TOL_SEC`),
 * not merely be non-zero (LOW-2).
 *
 * For short runs that absolute margin flags everything: two clean 0.4 s runs 0.3 s
 * apart can never be 2 s apart in score. The margin is therefore capped at a
 * fraction of the reported runtime — a lag can only mis-assign a run it is large
 * relative to (LOW-3).
 */
const MATCH_MARGIN_FACTOR = 0.5;
/**
 * Runtime off the wall clock, for end lines that report none and say so
 * (`elapsedFromClock`). Only v12 sets that flag; see the field's doc for why the
 * v11 paths must NOT get a clock-derived number.
 *
 * Returns null when either end of the interval is unknown or the pair is out of
 * order — a negative runtime is worse than none.
 */
function clockElapsedSec(
  ev: { elapsedSec: number | null; elapsedFromClock?: true },
  startMs: number | null,
  endMs: number | null,
): number | null {
  if (ev.elapsedSec != null) { return ev.elapsedSec; }
  if (!ev.elapsedFromClock || startMs == null || endMs == null || endMs < startMs) { return null; }
  return round2((endMs - startMs) / 1000);
}

/** Floor so a 0.00 s run does not end up with a zero margin (= always confident). */
const MATCH_MARGIN_MIN_SEC = 0.1;

/**
 * Age at which an open run stops being a plausible PARENT (or end-line owner) for a
 * line that arrives now.
 *
 * `matchEnd` already refuses to pair an end line with a start that cannot arithmetically
 * own it; the lookup that finds a parent had no such window, so a run that never
 * closes stayed a candidate for the whole log and turned every later run of the same
 * name into a tie. On the live 11.8 log two `## test1` starts from 07-23 never got an
 * end line and dragged all five child attachments of a 07-25 run into `ambiguous`.
 *
 * The window has to clear the longest runtime a TI process can REALLY still be inside
 * while another instance of it starts. Overnight loads of a few hours are ordinary, so
 * anything on the scale of minutes or a single hour would break real nesting; half a
 * day outlives every batch cycle a chore schedules. Ages beyond it are produced by lost
 * end lines (compile failure, server restart or log rotation between start and end),
 * not by running processes.
 *
 * Deliberately NOT symmetric with `MATCH_TOL_SEC`: that one bounds clock/log-write lag
 * (seconds), this one bounds process runtime (hours). They answer different questions.
 */
const STALE_OPEN_AGE_SEC = 12 * 3600;

/**
 * Drop candidates too old to own `nowMs` — but only while a plausible one survives.
 *
 * Never returning an empty list is what makes the window safe. A genuinely long-running
 * parent is normally the ONLY candidate for its child, and a sole candidate is always
 * kept however old it is; the guard can only ever choose between same-named runs, where
 * the fresh one is the answer. It also means an `end` lookup can never be starved into
 * fabricating a truncated stray root.
 *
 * A candidate with an unparsable start timestamp counts as plausible: no evidence of
 * staleness is not evidence of staleness.
 */
function plausibleOpen(cands: OpenRun[], nowMs: number | null): OpenRun[] {
  if (nowMs == null || cands.length < 2) { return cands; }
  const fresh = cands.filter(c => c.startMs == null || (nowMs - c.startMs) / 1000 <= STALE_OPEN_AGE_SEC);
  return fresh.length > 0 ? fresh : cands;
}

function matchMargin(elapsedSec: number): number {
  return Math.max(MATCH_MARGIN_MIN_SEC, Math.min(MATCH_TOL_SEC, MATCH_MARGIN_FACTOR * elapsedSec));
}

/**
 * Pick the open run an end line belongs to, AFTER `narrowByThread` has had its
 * say — this sees only candidates the thread could not separate (14 of 3540 on
 * the real log: same process opened twice on one thread).
 *
 * The end line's message text carries no user and no thread, so within one
 * thread the only usable signal is arithmetic: `endTs - startTs` must equal the
 * reported elapsed time. Where that separates the candidates the pairing is exact (LIFO
 * swaps the runtimes of a 100 s and a 5 s run finishing in completion order);
 * where it does not — same start instant, or an error end that carries no elapsed
 * value at all — the result is flagged instead of silently guessed (H4).
 */
function matchEnd(
  cands: OpenRun[],
  endMs: number | null,
  elapsedSec: number | null,
): { chosen: OpenRun; ambiguous: boolean } {
  if (cands.length === 1) { return { chosen: cands[0], ambiguous: false }; }
  if (elapsedSec != null && endMs != null) {
    const scored = cands
      .filter((c): c is OpenRun & { startMs: number } => c.startMs != null)
      .map(c => ({ c, score: Math.abs((endMs - c.startMs) / 1000 - elapsedSec) }))
      .sort((a, b) => a.score - b.score);
    if (scored.length > 0) {
      const best = scored[0];
      const runnerUp = scored[1];
      const margin = matchMargin(elapsedSec);
      const separated = best.score <= MATCH_TOL_SEC
        && (runnerUp === undefined || runnerUp.score - best.score > margin);
      return { chosen: best.c, ambiguous: !separated };
    }
  }
  // No arithmetic handle (error end without elapsed, unparsable timestamps):
  // close the most recently started run and say so.
  return { chosen: cands[cands.length - 1], ambiguous: true };
}

/** A run already closed by an end line, kept for the rollback→final-verdict merge. */
interface ClosedRun {
  node: CallNode;
  /** Epoch ms of the end line that closed it, `null` when unparsable. */
  endMs: number | null;
  /** Epoch ms of its start line, `null` when truncated or unparsable. */
  startMs: number | null;
}

/**
 * TM1 writes the rollback notice and the final verdict of ONE aborted run back to
 * back. Without a bound, any later end line of the same name is folded into that
 * run: a genuinely separate instance whose start was cut off by `$top` disappears
 * and the survivor shows a runtime it cannot have had (MED-2).
 */
const MERGE_WINDOW_SEC = 5.0;

function canMerge(prev: ClosedRun, endMs: number | null, elapsedSec: number | null): boolean {
  // No usable clock on either line → nothing to bound the merge with; keep the
  // rollback pairing, which is the far more common shape.
  if (endMs == null || prev.endMs == null) { return true; }
  const gap = (endMs - prev.endMs) / 1000;
  if (gap >= 0 && gap <= MERGE_WINDOW_SEC) { return true; }
  // Written late, but the reported runtime still lands on this run's start → same run.
  if (elapsedSec != null && prev.startMs != null) {
    return Math.abs((endMs - prev.startMs) / 1000 - elapsedSec) <= MATCH_TOL_SEC;
  }
  return false;
}

/**
 * One tie the matcher could not resolve. `tied` are the interchangeable runs,
 * `dependents` the nodes whose placement merely followed from the pick (the child
 * that had to be attached to one of several identical parents).
 */
interface AmbiguityTie { tied: CallNode[]; dependents: CallNode[] }

/**
 * Everything a viewer can see on a row and its subtree. `startTs` is bound to the
 * START line and does NOT move when an end line is re-attributed, so it is
 * deliberately excluded — as is `ambiguous` itself, which every tie member carries
 * by construction.
 */
function renderSig(n: CallNode): string {
  return [
    n.name, n.kind, n.status, n.elapsedSec, n.selfSec, n.selfPct, n.truncated, n.inconsistent,
    '(', n.children.map(renderSig).join(','), ')',
  ].join('');
}

/**
 * Drop the ≈ marker wherever the tie has no observable consequence.
 *
 * If every candidate renders identically, picking the other one yields the very
 * same tree, so the flag warns about a difference that does not exist. On the live
 * 11.8 log that is the bulk of the flags — the same process re-run within
 * milliseconds, each time for 0.00 s — and it buries the ties that DO change the
 * picture. A node that takes part in even ONE unresolvable tie keeps its flag.
 */
function suppressIndistinguishableTies(ties: AmbiguityTie[]): void {
  const keep = new Set<CallNode>();
  const suppressible: AmbiguityTie[] = [];
  for (const t of ties) {
    const sig = renderSig(t.tied[0]);
    if (t.tied.every(n => renderSig(n) === sig)) {
      suppressible.push(t);
    } else {
      for (const n of t.tied) { keep.add(n); }
      for (const n of t.dependents) { keep.add(n); }
    }
  }
  for (const t of suppressible) {
    for (const n of t.tied) { if (!keep.has(n)) { n.ambiguous = false; } }
    for (const n of t.dependents) { if (!keep.has(n)) { n.ambiguous = false; } }
  }
}

/** Fill selfSec / selfPct bottom-up. `rootIncl` = the owning root's elapsedSec. */
function derive(node: CallNode, rootIncl: number | null): void {
  let childSum = 0;
  for (const c of node.children) {
    derive(c, rootIncl);
    // An asynchronously attached child runs
    // CONCURRENTLY and can outlive its caller — its time is not contained
    // in the caller's. Subtracting it would make the self time negative (on
    // the real log: an 82 s caller against a 7,378 s fan-out), clamped to
    // 0, and the whole tree marked as `inconsistent`.
    if (c.asyncAttached) { continue; }
    childSum += c.elapsedSec ?? 0;
  }
  if (node.elapsedSec != null) {
    const raw = node.elapsedSec - childSum;
    // Children longer than their parent is arithmetically impossible — it means a
    // child was attached to the wrong instance or an end line was mispaired. Clamp
    // (a negative self-time is meaningless) but FLAG it, so the UI can say the
    // numbers don't add up instead of quietly showing 0 (M6).
    if (raw < -0.005) { node.inconsistent = true; }
    node.selfSec = round2(Math.max(0, raw));
    if (rootIncl && rootIncl > 0) {
      const pct = (node.selfSec / rootIncl) * 100;
      if (pct > 100.005) { node.inconsistent = true; }
      // Clamp here, not in the renderer: bar width and percentage text must come
      // from the same number.
      node.selfPct = Math.max(0, Math.min(100, pct));
    } else {
      node.selfPct = null;
    }
  }
}

/** Reverse children in tree for display (newest-started first, consistent with roots). */
function reverseChildrenTree(node: CallNode): void {
  node.children.reverse();
  for (const child of node.children) {
    reverseChildrenTree(child);
  }
}

function buildStats(roots: CallNode[]): ProcStat[] {
  interface Acc { kind: 'process' | 'chore'; calls: number; times: number[]; failures: number; uncertain: number; uncertainSec: number; }
  const map = new Map<string, Acc>();

  const visit = (node: CallNode): void => {
    // Chores are containers, not runs: a chore row would read calls:1 with
    // 0 s total/avg/min/max forever (M5). Its children are still counted.
    if (node.kind !== 'chore') {
      let acc = map.get(node.name);
      if (!acc) { acc = { kind: node.kind, calls: 0, times: [], failures: 0, uncertain: 0, uncertainSec: 0 }; map.set(node.name, acc); }
      acc.calls++;
      // An ambiguous runtime may belong to a sibling run — keep it out of the time
      // columns and account for it separately instead (LOW-4).
      if (node.elapsedSec != null) {
        if (node.ambiguous) { acc.uncertainSec += node.elapsedSec; } else { acc.times.push(node.elapsedSec); }
      }
      if (node.status === 'error') { acc.failures++; }
      if (node.ambiguous) { acc.uncertain++; }
    }
    for (const c of node.children) { visit(c); }
  };
  for (const r of roots) { visit(r); }

  const stats: ProcStat[] = [];
  for (const [name, a] of map) {
    const total = a.times.reduce((s, t) => s + t, 0);
    stats.push({
      name,
      kind: a.kind,
      calls: a.calls,
      totalSec: round2(total),
      avgSec: a.times.length ? total / a.times.length : 0,
      minSec: a.times.length ? Math.min(...a.times) : 0,
      maxSec: a.times.length ? Math.max(...a.times) : 0,
      failures: a.failures,
      uncertain: a.uncertain,
      uncertainSec: round2(a.uncertainSec),
    });
  }
  stats.sort((x, y) => y.totalSec - x.totalSec);
  return stats;
}

/**
 * Drops runs of `}` (control) processes and chores from the roots and the
 * statistics. A `}` child under a user process stays: its time is part of that
 * run. On v12 the fetch already skipped those files; v11 has only lines, so the
 * result is filtered here. The statistics are rebuilt from the kept roots: a
 * user process called by a hidden `}` run must not keep that run's time.
 */
export function withoutControlRuns(r: AnalysisResult): AnalysisResult {
  const isControl = (name: string): boolean => name.startsWith('}');
  return keepRoots(r, t => !isControl(t.name), s => !isControl(s.name));
}

/** Only the runs of one chore (TM1 names compare case-insensitively). */
export function onlyChoreRuns(r: AnalysisResult, chore: string): AnalysisResult {
  const want = chore.toLowerCase();
  return keepRoots(r, t => t.kind === 'chore' && t.name.toLowerCase() === want, () => true);
}

function keepRoots(
  r: AnalysisResult, keepTree: (t: CallNode) => boolean, keepStat: (s: ProcStat) => boolean,
): AnalysisResult {
  const trees = r.trees.filter(keepTree);
  return {
    ...r,
    trees,
    stats: buildStats(trees).filter(keepStat),
    // Same count as `analyze` — over the kept roots, so the status line
    // matches the tree it stands above.
    parsedRuns: trees.reduce((n, t) => n + (t.kind === 'chore' ? t.children.length : 1), 0),
  };
}

export function analyze(entries: RawEntry[]): AnalysisResult {
  const ordered = chronological(entries);
  const open: OpenRun[] = [];
  const roots: CallNode[] = [];
  /**
   * Last run of a name that was closed by an end line, kept until a new run of
   * that name starts. TM1 emits TWO end lines for an aborted run (rollback notice
   * first, then the final "mit Fehlern beendet"); without this the second line
   * becomes a second root and double-counts calls and failures (M3).
   */
  const lastEnded = new Map<string, ClosedRun>();
  /**
   * Last chore run of a name closed by an end line. TM1 splits the chore end over
   * `Chore "x" time = N seconds` and `Chore "x" finished executing` and emits them
   * in either order, so whichever half arrives second must still reach the node
   * that the first half already took out of `open`.
   */
  const lastEndedChore = new Map<string, CallNode>();
  const ties: AmbiguityTie[] = [];
  let ignored = 0;
  /**
   * v12: first error line per open run, until that run's end line takes it. Keyed by
   * name AND run log: two overlapping runs of one process must not swap their texts.
   */
  const pendingErrorText = new Map<string, string>();
  const errorKey = (en: RawEntry): string => `${en.Name ?? ''}\0${en.RunFile ?? en.ChoreRun ?? ''}`;

  /**
   * Start and end facts per process run — the basis for the post-pass
   * that hangs in asynchronously started runs.
   */
  const runMeta = new Map<CallNode, RunFacts>();

  const openRun = (node: CallNode, user: string | undefined, startMs: number | null, thread?: number): void => {
    open.push({ node, user, startMs, thread });
    if (node.kind === 'process') { runMeta.set(node, { user, thread, startMs, endMs: null }); }
    // Only a new run of the same KIND supersedes the closed one — a chore start is
    // unrelated to the process bookkeeping and vice versa.
    if (node.kind === 'process') { lastEnded.delete(node.name); } else { lastEndedChore.delete(node.name); }
  };



  /**
   * Same-named open runs of the SAME kind that could still own a line at `nowMs`,
   * oldest first.
   *
   * Kind is part of the key: matching on the name alone would let a process end
   * line close a same-named chore, and since chores are skipped in the statistics
   * the run would disappear from them entirely (MED-1).
   *
   * Stale runs are filtered here, at LOOKUP time, and are NOT removed from `open`:
   * their node keeps saying `running`, which is the honest answer for a run whose
   * end simply fell outside the fetched window ($top cut), and a late end line that
   * does arrive still finds its start instead of becoming a truncated stray root.
   */
  const candidates = (name: string, kind: 'process' | 'chore', nowMs: number | null): OpenRun[] =>
    plausibleOpen(open.filter(o => o.node.name === name && o.node.kind === kind), nowMs);

  /**
   * v12 chore containers, keyed by the run they came from (`RawEntry.ChoreRun`).
   *
   * Deliberately NOT part of `open`: that machinery pairs start lines with end
   * lines, and a v12 chore has neither. The file identity settles which node a
   * line belongs to outright, so there is nothing to match and nothing that can
   * be matched wrongly. The node keeps the `group` status a container without a
   * reported end is supposed to have.
   */
  const choreRuns = new Map<string, CallNode>();
  /** v12 process run log of each node (`RawEntry.RunFile`), and each file's first run. */
  const fileOf = new Map<CallNode, string>();
  const fileRoot = new Map<string, CallNode>();
  /**
   * Caller of a v12 `RunProcess` start: the innermost run of the same file that
   * is still open, else the file's first run — on SaaS the async start was
   * logged after its caller had already ended. Never another async run: three
   * `RunProcess` calls in a row overlap, and all three named the same caller
   * number (SaaS, 2026-10-14) — the newest open one is a sibling, not the caller.
   */
  const runProcessCaller = (en: RawEntry): CallNode | undefined => {
    if (!en.RunFile) { return undefined; }
    for (let i = open.length - 1; i >= 0; i--) {
      const n = open[i].node;
      if (fileOf.get(n) === en.RunFile && !n.asyncAttached) { return n; }
    }
    return fileRoot.get(en.RunFile);
  };
  const noteFile = (node: CallNode, en: RawEntry): void => {
    if (!en.RunFile) { return; }
    fileOf.set(node, en.RunFile);
    if (!fileRoot.has(en.RunFile)) { fileRoot.set(en.RunFile, node); }
  };
  const choreContainerFor = (en: RawEntry, ts: string): CallNode | undefined => {
    if (!en.ChoreRun || !en.Chore) { return undefined; }
    let node = choreRuns.get(en.ChoreRun);
    if (!node) {
      // Started when its first process did: the chore itself logs no start line,
      // and inventing an earlier time would claim a measurement nobody made.
      node = mkNode(en.Chore, 'chore', ts);
      choreRuns.set(en.ChoreRun, node);
      roots.push(node);
    }
    return node;
  };

  for (const en of ordered) {
    const msg = entryMsg(en);
    const ts = entryTs(en);
    const ev = parseLine(msg, en.Name);
    if (!ev) {
      if (en.Name && en.Level === 'Error' && !pendingErrorText.has(errorKey(en))) { pendingErrorText.set(errorKey(en), msg); }
      ignored++;
      continue;
    }
    const ms = tsMs(ts);
    // 0 is TM1's "no worker thread" marker on server-startup lines, never a real
    // worker — treat it as absent rather than as a thread every such line shares.
    const thread = typeof en.ThreadID === 'number' && en.ThreadID > 0 ? en.ThreadID : undefined;

    if (ev.type === 'top') {
      const node = mkNode(ev.name, ev.kind, ts, ev.kind === 'process');
      const caller = ev.byRunProcess ? runProcessCaller(en) : undefined;
      noteFile(node, en);
      if (caller) {
        // Same flag the v11 post-pass sets: the run is shown under its caller
        // but its time is not part of the caller's own time.
        node.asyncAttached = true;
        caller.children.push(node);
        openRun(node, ev.user, ms, thread);
        continue;
      }
      // v12 first: the chore is known from the run log's name, with no start line
      // to look up and no ambiguity to resolve. Without this every process a chore
      // launched would sit in the tree as its own top-level run.
      const v12Chore = ev.kind === 'process' ? choreContainerFor(en, ts) : undefined;
      if (v12Chore) {
        v12Chore.children.push(node);
        openRun(node, ev.user, ms, thread);
        continue;
      }
      // A chore-launched process belongs UNDER its chore: the start line names the
      // chore, so the link exists and the chore stops being a childless leaf (M5).
      const choreCands = narrowByThread(ev.chore ? candidates(ev.chore, 'chore', ms) : [], thread);
      if (choreCands.length > 0) {
        const parent = choreCands[choreCands.length - 1];
        if (choreCands.length > 1) {
          node.ambiguous = true;
          for (const c of choreCands) { c.node.ambiguous = true; }
          ties.push({ tied: choreCands.map(c => c.node), dependents: [node] });
        }
        parent.node.children.push(node);
      } else {
        // Chore outside the fetched window (or plain user start) → own root.
        // Whether the run was in truth started asynchronously out of
        // another one (`RunProcess`) is decided by the post-pass
        // `attachAsyncRuns` — here, only the start is known yet for the
        // candidates, not the end.
        roots.push(node);
      }
      openRun(node, ev.user, ms, thread);
    } else if (ev.type === 'child') {
      const node = mkNode(ev.name, 'process', ts);
      noteFile(node, en);
      // `run from process "X"` — the parent is a process, never a same-named chore.
      // `ExecuteProcess` is synchronous, so the child is logged on its parent's
      // thread — the sharpest handle available here. On the real log 1440 of 1551
      // contested parent lookups fall to it; the user name, the previous handle,
      // resolved 37, because a chore fan-out runs every instance as the SAME user.
      let cands = narrowByThread(candidates(ev.parent, 'process', ms), thread);
      if (cands.length > 1 && ev.user) {
        // Same process running concurrently for several users: the child line names
        // the user, so it attaches to the right parent instance (H4).
        const byUser = cands.filter(o => o.user === ev.user);
        if (byUser.length > 0) { cands = byUser; }
      }
      if (cands.length === 0) {
        node.status = 'orphan';
        roots.push(node);
      } else {
        const parent = cands[cands.length - 1];
        if (cands.length > 1) {
          node.ambiguous = true;
          for (const c of cands) { c.node.ambiguous = true; }
          ties.push({ tied: cands.map(c => c.node), dependents: [node] });
        }
        parent.node.children.push(node);
      }
      openRun(node, ev.user, ms, thread);
    } else if (ev.type === 'choreEnd') {
      const cands = candidates(ev.name, 'chore', ms);
      let node: CallNode | undefined;
      if (cands.length > 0) {
        // LIFO: chores of one name do not overlap on a TM1 scheduler.
        const chosen = cands[cands.length - 1];
        node = chosen.node;
        open.splice(open.indexOf(chosen), 1);
        lastEndedChore.set(ev.name, node);
      } else {
        // The other half of an end this loop already applied.
        node = lastEndedChore.get(ev.name);
      }
      if (!node) {
        // Chore end whose start is outside the fetched window. A chore is a pure
        // container: without its start line there are no children to contain, so a
        // stray chore root would be a permanently empty row. Count it as ignored
        // rather than invent one (unlike a process end, which carries a real
        // runtime worth showing on a truncated root).
        ignored++;
        continue;
      }
      node.status = 'ok';
      if (ev.elapsedSec != null) { node.elapsedSec = ev.elapsedSec; }
    } else {
      const errorFile = RE_ERROR_FILE.exec(msg)?.[1] ?? (ev.error ? (en.RunFile ?? en.ChoreRun) : undefined);
      const errorText = en.Name ? pendingErrorText.get(errorKey(en)) : undefined;
      if (en.Name) { pendingErrorText.delete(errorKey(en)); }
      const markFailure = (node: CallNode): void => {
        if (!errorFile) { return; }
        node.status = 'error';
        node.errorFile ??= errorFile;
        if (errorText) { node.errorText ??= errorText; }
      };
      // Narrow BEFORE matchEnd, not inside it: what survives here is also what
      // gets flagged as a tie, so a tie the thread resolved must not be reported.
      const cands = narrowByThread(candidates(ev.name, 'process', ms), thread);
      if (cands.length > 0) {
        const { chosen, ambiguous } = matchEnd(cands, ms, ev.elapsedSec);
        const node = chosen.node;
        node.elapsedSec = clockElapsedSec(ev, chosen.startMs, ms);
        node.status = ev.error ? 'error' : (node.status === 'orphan' ? 'orphan' : 'ok');
        markFailure(node);
        if (ambiguous) {
          for (const c of cands) { c.node.ambiguous = true; }
          ties.push({ tied: cands.map(c => c.node), dependents: [] });
        }
        open.splice(open.indexOf(chosen), 1);
        node.endTs = ts;
        const meta = runMeta.get(node);
        if (meta) { meta.endMs = ms; }
        lastEnded.set(node.name, { node, endMs: ms, startMs: chosen.startMs });
      } else {
        const prev = lastEnded.get(ev.name);
        // Second end line of an already-closed run: the first was a rollback / abort
        // notice (no elapsed value), this one carries the final verdict. Merge
        // instead of creating a phantom run.
        if (prev && prev.node.elapsedSec == null && canMerge(prev, ms, ev.elapsedSec)) {
          const merged = clockElapsedSec(ev, prev.startMs, ms);
          if (merged != null) { prev.node.elapsedSec = merged; }
          if (ev.error) { prev.node.status = 'error'; }
          markFailure(prev.node);
          prev.endMs = ms ?? prev.endMs;
          continue;
        }
        // A compile-failure verdict is never truncated (see `initFail`): its start
        // line is in the window, the log just tied the two at the same millisecond
        // and returned them in the other order. Drop the verdict rather than split
        // one run into an empty stray root plus a node stuck at `running`.
        if (ev.initFail) { ignored++; continue; }
        // Genuine truncation: $top cut the start line off. The runtime is real, the
        // start time is NOT the end timestamp — leave it empty and say so (M3).
        const stray = mkNode(ev.name, 'process', '');
        stray.truncated = true;
        stray.elapsedSec = ev.elapsedSec;
        stray.status = ev.error ? 'error' : 'ok';
        markFailure(stray);
        roots.push(stray);
        lastEnded.set(ev.name, { node: stray, endMs: ms, startMs: null });
      }
    }
  }

  // Only now, when every end is settled: hang asynchronously started runs under
  // their presumed caller (see `attachAsyncRuns`).
  const rerooted = attachAsyncRuns(roots, runMeta);
  roots.length = 0;
  roots.push(...rerooted);

  for (const r of roots) {
    rollUpChoreErrors(r);
    reverseChildrenTree(r);
    if (r.kind === 'chore' && r.elapsedSec == null) {
      // Chore end outside the window → no total for the children to be a
      // percentage OF; each launched process is its own baseline.
      for (const c of r.children) { derive(c, c.elapsedSec); }
    } else {
      derive(r, r.elapsedSec);
    }
  }
  // Runs on `derive`d nodes: whether two tie members render alike depends on the
  // self/percentage columns too, and it must run BEFORE buildStats, whose
  // `uncertain` / `uncertainSec` columns read the very flags it clears.
  suppressIndistinguishableTies(ties);
  // A chore node is a container, not a run: count the processes it launched.
  const parsedRuns = roots.reduce((n, r) => n + (r.kind === 'chore' ? r.children.length : 1), 0);
  roots.reverse(); // newest root first for display

  return { trees: roots, stats: buildStats(roots), parsedRuns, ignoredLines: ignored, entryCount: entries.length };
}
