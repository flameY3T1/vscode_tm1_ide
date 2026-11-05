import * as vscode from 'vscode';
import { apiRequest } from '../../tm1Client';
import { cacheScope } from '../../tm1Rest/transport/session';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { parseBodySafe } from '../../tm1Rest/parseRest';
import { withSandbox } from '../../tm1Rest/sandboxTracker';
import { enc } from './state';
import { hierODataPath } from '../../utils/hierKeyPure';
import { judgeViewSize, subsetAllDimension, type AxisSize } from './viewSizeGuardPure';
import { isOk } from '../../tm1Rest/httpError';
import { SIDE_READ_CAP_MS } from '../../tm1Rest/timeouts';
import { registerServerDisposer } from '../../serverState/serverDisposeRegistry';

/**
 * Refuse to execute a saved NativeView whose axes are a provably unbounded cross
 * product. See `viewSizeGuardPure.ts` for the reasoning and the measured example.
 *
 * Cost discipline — this sits in front of every native view open, so it must not
 * be felt (all figures measured against 11.8):
 *  - one small GET for axes + suppression: 0.9 ms, 3 KB.
 *  - `Elements/$count` ONLY for axis entries that take a whole dimension, and
 *    only when suppression is off; all in parallel — 11 dimensions cost 12 ms
 *    and 37 bytes. A normal view never triggers a single one.
 *  - the verdict is cached per view for the session, so refreshes and re-opens
 *    cost nothing.
 * Anything not cheaply determinable counts as unknown, and unknown never blocks.
 */

/** Above this many tuples a view cannot be displayed under any circumstance. */
const TUPLE_LIMIT = 5_000_000;

/** `${serverUrl}|${user}|${cube}|${view}|${isPrivate}` → message, or null for "fine". */
const _verdictCache = new Map<string, string | null>();
/**
 * `${serverUrl}|${user}|${dim}` → element count. Dimension sizes barely move.
 * The user part (`cacheScope`) matters: two profiles on one URL see different
 * elements and private views.
 */
const _dimCountCache = new Map<string, number | null>();

interface RawAxisEntry { Subset?: { Name?: string; Expression?: string; Hierarchy?: { Name?: string } } }
interface RawView {
  SuppressEmptyRows?: boolean;
  SuppressEmptyColumns?: boolean;
  Rows?: RawAxisEntry[];
  Columns?: RawAxisEntry[];
}

async function _dimElementCount(dim: string, config: Tm1Config): Promise<number | null> {
  const key = `${cacheScope(config)}|${dim}`;
  const hit = _dimCountCache.get(key);
  if (hit !== undefined) { return hit; }
  // `/$count` REQUIRES $format=text/plain — the transport asks for JSON and TM1
  // answers 400 code 278 otherwise.
  const res = await apiRequest(
    'GET',
    `${hierODataPath(dim)}/Elements/$count?$format=text/plain`,
    undefined, 10000, config, withSandbox(config),
  ).catch(() => null);
  const n = res && isOk(res)
    ? Number.parseInt(String(res.body).trim(), 10)
    : NaN;
  const out = Number.isFinite(n) ? n : null;
  _dimCountCache.set(key, out);
  return out;
}

/**
 * Turn raw axis entries into sizes. Only a whole-dimension selection
 * (`TM1SubsetAll([D])`) is cheap enough to resolve; everything else stays
 * `null` = unknown, which disables the block.
 */
async function _sizeAxis(entries: RawAxisEntry[], config: Tm1Config): Promise<AxisSize[]> {
  return await Promise.all(entries.map(async (e) => {
    const dim = e.Subset?.Hierarchy?.Name ?? '?';
    const all = subsetAllDimension(e.Subset?.Expression);
    if (all === null) { return { dim, count: null }; }
    return { dim, count: await _dimElementCount(all, config) };
  }));
}

/**
 * Throws a user-facing error when the view is provably too large; returns
 * silently in every other case — including every failure of the check itself.
 * A guard that cannot decide must never stand in the way.
 */
export async function assertViewExecutable(
  cubeName: string, viewName: string, isPrivate: boolean, config: Tm1Config,
): Promise<void> {
  const key = `${cacheScope(config)}|${cubeName}|${viewName}|${isPrivate}`;
  const cached = _verdictCache.get(key);
  if (cached !== undefined) {
    if (cached) { throw new Error(cached); }
    return;
  }

  let message: string | null = null;
  try {
    const collection = isPrivate ? 'PrivateViews' : 'Views';
    const url = `Cubes('${enc(cubeName)}')/${collection}('${enc(viewName)}')`
      + '?$select=SuppressEmptyRows,SuppressEmptyColumns'
      + '&$expand=Rows/Subset($select=Name,Expression;$expand=Hierarchy($select=Name))'
      + ',Columns/Subset($select=Name,Expression;$expand=Hierarchy($select=Name))';
    const res = await apiRequest('GET', url, undefined, SIDE_READ_CAP_MS, config, withSandbox(config));
    if (isOk(res)) {
      const v = parseBodySafe<RawView>(res, {});
      const suppressed = !!v.SuppressEmptyRows || !!v.SuppressEmptyColumns;
      const rowsRaw = v.Rows ?? [];
      const colsRaw = v.Columns ?? [];
      // Nothing to weigh unless suppression is off AND some axis takes a whole
      // dimension — this is what keeps a normal view free of extra requests.
      const anyWholeDim = [...rowsRaw, ...colsRaw]
        .some((e) => subsetAllDimension(e.Subset?.Expression) !== null);
      if (!suppressed && anyWholeDim) {
        const [rows, cols] = await Promise.all([
          _sizeAxis(rowsRaw, config),
          _sizeAxis(colsRaw, config),
        ]);
        const verdict = judgeViewSize(rows, cols, suppressed, TUPLE_LIMIT);
        if (verdict.block) {
          const top = verdict.drivers.slice(0, 3)
            .map((d) => `${d.dim} (${d.count.toLocaleString()})`).join(', ');
          message = vscode.l10n.t(
            'View "{0}" cannot be displayed: its axes span {1} combinations with empty suppression switched off. Largest dimensions: {2}. Switch suppression on in the view or restrict the axes.',
            viewName,
            verdict.tuples === Number.MAX_SAFE_INTEGER ? '> 9 quadrillion' : String(verdict.tuples),
            top,
          );
        }
      }
    }
  } catch {
    // A guard that fails is a guard that steps aside.
    message = null;
  }

  _verdictCache.set(key, message);
  if (message) { throw new Error(message); }
}

/**
 * Same judgement for an axis layout the viewer holds in memory — the MDX read
 * path never persists a view for the guard to inspect. Nothing is cached here:
 * a layout changes with every click, and a per-layout cache would grow without
 * ever being hit.
 */
export async function assertLayoutExecutable(
  rowDims: string[], colDims: string[],
  wholeDim: (dim: string) => boolean,
  suppressed: boolean,
  config: Tm1Config,
): Promise<void> {
  // Suppression makes the cross product meaningless, and without a whole
  // dimension on an axis nothing can be determined cheaply — same reasoning as
  // the saved-view guard above.
  if (suppressed) { return; }
  if (![...rowDims, ...colDims].some(wholeDim)) { return; }

  let message: string | null = null;
  try {
    const size = async (dims: string[]): Promise<AxisSize[]> => await Promise.all(dims.map(async (dim) => (
      wholeDim(dim) ? { dim, count: await _dimElementCount(dim, config) } : { dim, count: null }
    )));
    const [rows, cols] = await Promise.all([size(rowDims), size(colDims)]);
    const verdict = judgeViewSize(rows, cols, suppressed, TUPLE_LIMIT);
    if (verdict.block) {
      const top = verdict.drivers.slice(0, 3)
        .map((d) => `${d.dim} (${d.count.toLocaleString()})`).join(', ');
      message = vscode.l10n.t(
        'This layout cannot be displayed: its axes span {0} combinations with empty suppression switched off. Largest dimensions: {1}. Switch suppression on or restrict the axes.',
        verdict.tuples === Number.MAX_SAFE_INTEGER ? '> 9 quadrillion' : String(verdict.tuples),
        top,
      );
    }
  } catch {
    // A guard that fails is a guard that steps aside.
    message = null;
  }
  if (message) { throw new Error(message); }
}

/** Drops one server's verdicts and dimension sizes (disconnect, impersonation). */
export function clearViewSizeCacheForServer(serverUrl: string): void {
  const prefix = `${serverUrl}|`;
  for (const cache of [_verdictCache, _dimCountCache]) {
    for (const k of [...cache.keys()]) {
      if (k.startsWith(prefix)) { cache.delete(k); }
    }
  }
}

registerServerDisposer('viewSizeGuard', (url) => clearViewSizeCacheForServer(url));
