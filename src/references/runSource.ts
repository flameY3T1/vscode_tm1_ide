/**
 * Fetch the runs of a process from the TM1 log — heads for the expand field,
 * tree only on selection.
 *
 * Two-stage, because the field needs only time/duration/status and a run tree
 * costs a query of its own that is considerably more expensive.
 *
 * `apiRequest` comes DIRECTLY from `tm1Rest/client` — the facade `tm1Client` is
 * forbidden to deep layers by the depcruise rule `no-tm1client-in-deep-layers`.
 */
import { apiRequest } from '../tm1Rest/client';
import { parseBody } from '../tm1Rest/parseRest';
import { escapeODataKey } from '../utils/odataKey';
import { analyze, parseLine, type RawEntry, type CallNode } from '../messageLog/messageLogAnalysisPure';
import { listRunLogFiles, readRunLogContentForFile } from '../messageLog/messageLogV12';
import { sortEntriesByTime } from '../messageLog/messageLogV12Pure';
import type { RootRun } from './runOverlayPure';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { isOk } from '../tm1Rest/httpError';

/** Log lines for the run search. Roughly seven lines per run — covers plenty. */
const SEARCH_ROWS = 500;
/** This many runs are shown by the expand field. */
export const MAX_RUNS = 20;
/** Lines per run window. If it is not enough, `analyze()` marks `truncated`. */
const WINDOW_ROWS = 5000;
/**
 * Margin on the upper window end.
 *
 * The reported runtime ends before the end line: TM1 writes it after it has
 * stopped. Without the margin exactly this line falls out of the window and
 * the run would stay `running` forever.
 */
const WINDOW_MARGIN_MS = 2000;

export interface RunHead {
  startedAt: string;
  elapsedSec: number | null;
  status: 'ok' | 'error' | 'running';
  threadId?: number;
  /** User or chore that started the run — `user ?? chore`. */
  originator?: string;
  /**
   * The process this run was started from — only for a run that began as a
   * CHILD (`run from process "X"`). It comes free in the start line and is the
   * only reliable information about who triggered this run; the caller view
   * uses it to mark the real path.
   */
  parent?: string;
}

function ts(e: RawEntry): string { return e.TimeStamp ?? e.Timestamp ?? ''; }

function lc(s: string): string { return s.toLowerCase(); }

async function fetchEntries(path: string, cfg: Tm1Config): Promise<RawEntry[]> {
  const res = await apiRequest('GET', path, undefined, undefined, cfg);
  if (!isOk(res)) { return []; }
  return parseBody<{ value?: RawEntry[] }>(res).value ?? [];
}

/**
 * A `$filter` expression as a query part.
 *
 * `encodeURIComponent` leaves the apostrophe standing; Node then throws when
 * building the path: "Request path contains unescaped characters".
 */
function filterPart(filter: string): string {
  return `&$filter=${encodeURIComponent(filter).replace(/'/g, '%27')}`;
}

/**
 * The most recent runs of a process. One query, filtered server-side:
 * `contains` searches the whole log (shown live on 54017 entries),
 * `tolower` makes it case-insensitive. Foreign names that merely contain the
 * searched one drop out here — `parseLine` returns the name exactly.
 */
export async function listRuns(process: string, cfg: Tm1Config): Promise<RunHead[]> {
  if (cfg.version === 'v12') {
    // v12 has no `MessageLogEntries` any more, but one file per execution:
    // "A file IS a run" (`messageLog/messageLogV12.ts`). Runtime and status
    // are only in the file, so the head does not carry them.
    const files = await listRunLogFiles(cfg);
    return files
      .filter(f => f.kind === 'process' && lc(f.object) === lc(process))
      .slice(0, MAX_RUNS)
      .map(f => ({ startedAt: f.startedAt, elapsedSec: null, status: 'ok' as const }));
  }

  // `escapeODataKey` doubles the apostrophe — the same rule applies in the
  // `$filter` string literal as in the key literal of a path.
  const filter = `Logger eq 'TM1.Process' and contains(tolower(Message),'${escapeODataKey(lc(process))}')`;
  const rows = await fetchEntries(
    `MessageLogEntries?$orderby=TimeStamp%20desc&$top=${SEARCH_ROWS}${filterPart(filter)}`,
    cfg,
  );

  // Walk through ascending: a start opens a run, the next end of the
  // same name closes it. The query returns descending, because that is
  // the order in which `$top` keeps the MOST RECENT lines.
  const ascending = rows.slice().reverse();
  const open: RunHead[] = [];
  const done: RunHead[] = [];
  for (const e of ascending) {
    const ev = parseLine(e.Message ?? e.Text ?? '');
    if (!ev) { continue; }
    if (lc(ev.name) !== lc(process)) { continue; }
    if (ev.type === 'top' || ev.type === 'child') {
      // The originator is `user ?? chore`: a run can have been started by a CHORE,
      // not only by a user. Child lines name only the user.
      const originator = ev.type === 'top' ? ev.user ?? ev.chore : ev.user;
      const parent = ev.type === 'child' ? ev.parent : undefined;
      open.push({
        startedAt: ts(e), elapsedSec: null, status: 'running', parent,
        threadId: e.ThreadID, ...(originator ? { originator } : {}),
      });
    } else if (ev.type === 'end') {
      const h = open.pop();
      if (h) {
        h.elapsedSec = ev.elapsedSec;
        h.status = ev.error ? 'error' : 'ok';
        done.push(h);
      }
    }
  }
  return [...open, ...done]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_RUNS);
}

/** Key of a root run: name and start time together are unique. */
function rootKey(name: string, startTs: string): string {
  return `${lc(name)}|${startTs}`;
}

/**
 * Originator per root run from the raw lines. `analyze()` does not carry it into
 * the tree, but `attachAsync` needs it to exclude foreign runs.
 */
function originatorByRoot(rows: readonly RawEntry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of rows) {
    const ev = parseLine(e.Message ?? e.Text ?? '', e.Name);
    if (ev?.type !== 'top') { continue; }
    const originator = ev.user ?? ev.chore;
    if (originator) { m.set(rootKey(ev.name, ts(e)), originator); }
  }
  return m;
}

/**
 * All runs of the window that began as TOP-LEVEL — base set for
 * `attachAsync`.
 *
 * Not only the roots: since `analyze()` hangs presumably asynchronously started
 * runs under their caller, exactly the runs this is about are NO longer at the
 * root. Without this pass the runtimes of the `RunProcess` edges in the call
 * graph would be empty again.
 */
function asRoots(trees: readonly CallNode[], originator: Map<string, string>): RootRun[] {
  const out: RootRun[] = [];
  const walk = (n: CallNode, isRoot: boolean): void => {
    if (isRoot || n.startedTopLevel) {
      const u = originator.get(rootKey(n.name, n.startTs));
      out.push(u ? { ...n, originator: u } : n as RootRun);
    }
    for (const k of n.children) { walk(k, false); }
  };
  for (const t of trees) { walk(t, true); }
  return out;
}

export async function loadRun(
  process: string, head: RunHead, cfg: Tm1Config,
): Promise<{ tree: CallNode | null; roots: RootRun[] }> {
  if (cfg.version === 'v12') {
    const files = await listRunLogFiles(cfg);
    const file = files.find(f =>
      f.kind === 'process'
      && lc(f.object) === lc(process)
      && f.startedAt === head.startedAt);
    if (!file) { return { tree: null, roots: [] }; }
    // Descending, because `analyze()` expects exactly that and reverses internally — the
    // file itself stands there ascending.
    const entries = sortEntriesByTime(await readRunLogContentForFile(file, cfg), false);
    const res = analyze(entries);
    return {
      tree: res.trees.find(t => lc(t.name) === lc(process)) ?? null,
      // Under v12 a file is ONE run — asynchronously started runs stand
      // in files of their own and do not appear here. The asynchronous edges
      // therefore stay empty instead of guessing from a foreign window.
      roots: asRoots(res.trees, originatorByRoot(entries)),
    };
  }

  const bis = head.status === 'running' || head.elapsedSec === null
    ? new Date().toISOString()
    : new Date(Date.parse(head.startedAt) + head.elapsedSec * 1000 + WINDOW_MARGIN_MS).toISOString();
  const filter = `Logger eq 'TM1.Process' and TimeStamp ge ${head.startedAt} and TimeStamp le ${bis}`;
  // Descending: `analyze()` reverses what it gets (v11 fetches newest-first),
  // and its tie-break repair depends on this direction.
  const rows = await fetchEntries(
    `MessageLogEntries?$orderby=TimeStamp%20desc&$top=${WINDOW_ROWS}${filterPart(filter)}`,
    cfg,
  );
  const res = analyze(rows);
  const matching = res.trees.filter(t => lc(t.name) === lc(process));
  const tree = matching.length <= 1
    ? matching[0] ?? null
    // Several runs of the same name in the window: the one with the matching start.
    : matching.find(t => t.startTs === head.startedAt) ?? matching[0];
  return { tree, roots: asRoots(res.trees, originatorByRoot(rows)) };
}
