// src/providers/contextListFetch.ts
//
// The server-side lists that CONTEXT completion draws its suggestions from:
// cubes, dimensions, hierarchies, processes with their signature, cubes with
// their dimensions.
//
// Why in one place: the same five fetches were written out twice — in the
// TI console's host (`webviews/tiConsoleWebview.ts`) and in the process
// editor's host (`commands/processEditor/messaging.ts`) —, along with the
// same `top: 10000` limit and the same signature building. The CLIENT is the
// same for both (`webviewClient/*/contextCompletions.ts`), the hosts were
// not: the console sent the parameter type as `'Numeric' | 'String'`, the
// editor sent the server's raw string. Two contracts for one recipient are
// one too many.
//
// ── Errors are called "empty list" here ─────────────────────────────────────
//
// A failure must NOT cause the host to not respond at all: the client then
// waits forever for its list, and suggestions stay unavailable on every
// further attempt too. That is why every function here catches its own
// errors and returns the empty list. Whoever wants to see the failure passes
// in `onError` — the process editor does that (`logFetchError`), the console
// does not.
import type { Tm1Config } from '../tm1Rest/transport/types';
import { fetchNames } from './fetchNames';
import { listCubes } from '../tm1Rest/cubeApi';
import { listHierarchyNames } from '../tm1Rest/dimensionApi';
import { listProcesses } from '../tm1Rest/processApi';

/** Called on a failure; the function still returns a list regardless. */
export type FetchErrorSink = (operation: string, err: unknown) => void;

/**
 * TI knows exactly two parameter types. The server writes them as a string;
 * anything that is not `Numeric` is `String` — that is also how completion
 * reads it when it builds the argument list from this.
 */
export type ContextParamType = 'Numeric' | 'String';

export interface ContextProcess {
  name: string;
  /** `(p1, p2)` or empty — completion appends it to the name. */
  sig: string;
  params: Array<{ name: string; type: ContextParamType }>;
}

export interface ContextCube {
  name: string;
  dims: string[];
}

/**
 * Upper bound for the list fetches.
 *
 * Stood in both hosts as a bare number. It is a SAFEGUARD, not a design
 * decision: an instance with more processes then delivers a truncated
 * suggestion list — better than a fetch that blocks the UI.
 */
const LIST_TOP = 10000;

async function guarded<T>(
  operation: string, run: () => Promise<T>, fallback: T, onError?: FetchErrorSink,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    onError?.(operation, err);
    return fallback;
  }
}

const sorted = (names: string[]): string[] => names.slice().sort();

export function fetchCubeNames(cfg: Tm1Config, onError?: FetchErrorSink): Promise<string[]> {
  return guarded('fetchCubes', async () => sorted(await fetchNames('Cubes', cfg)), [], onError);
}

export function fetchDimensionNames(cfg: Tm1Config, onError?: FetchErrorSink): Promise<string[]> {
  return guarded('fetchDimensions',
    async () => sorted(await fetchNames('Dimensions', cfg)), [], onError);
}

export function fetchHierarchyNamesFor(
  cfg: Tm1Config, dimension: string, onError?: FetchErrorSink,
): Promise<string[]> {
  return guarded('fetchHierarchies',
    async () => sorted(await listHierarchyNames(cfg, dimension)), [], onError);
}

export function fetchProcessList(
  cfg: Tm1Config, onError?: FetchErrorSink,
): Promise<ContextProcess[]> {
  return guarded('fetchProcesses', async () => {
    const items = await listProcesses(cfg, { select: 'Name,Parameters', orderby: 'Name', top: LIST_TOP });
    return items.map(p => {
      const params = (p.Parameters ?? []).map(x => ({
        name: String(x.Name),
        type: (String(x.Type ?? 'String') === 'Numeric' ? 'Numeric' : 'String') as ContextParamType,
      }));
      return {
        name: p.Name,
        sig: params.length > 0 ? `(${params.map(pp => pp.name).join(', ')})` : '',
        params,
      };
    });
  }, [], onError);
}

export function fetchCubesWithDims(
  cfg: Tm1Config, onError?: FetchErrorSink,
): Promise<ContextCube[]> {
  return guarded('fetchCubesWithDims', async () => {
    const items = await listCubes(cfg, {
      select: 'Name', top: LIST_TOP, expand: 'Dimensions($select=Name)',
    });
    return items.map(c => ({
      name: String(c.Name),
      dims: (c.Dimensions ?? []).map(d => String(d.Name)),
    }));
  }, [], onError);
}
