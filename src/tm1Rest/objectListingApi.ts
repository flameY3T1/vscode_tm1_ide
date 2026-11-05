// src/tm1Rest/objectListingApi.ts
// Server-wide listing of objects by kind — the shared basis for bulk
// deletion (`bulkDeleteWebview.ts`) and bulk migration
// (`bulkDeployWebview.ts`). Both sides must see the same set: what one side
// deletes, the other side brings to a different server, and a mismatch in
// the enumeration would be the wrong inventory in both cases.
//
// Views and subsets cost ONE call each for the whole server, not one per
// parent object (measured 2026-09-18: 146 views in 34 KB / 24 ms,
// 463 subsets in 124 KB / 6 ms).
//
// PRIVATE views and subsets are NOT included: those live under
// `PrivateViews`/`PrivateSubsets` and belong to the respective user.

import type { Tm1Config } from './transport/types';
import { apiRequest } from './client';
import { parseBody } from './parseRest';
import { listCubes, type Tm1CubeSummary } from './cubeApi';
import { listDimensionNames } from './dimensionApi';
import { listProcesses } from './processApi';
import { listChores } from './choreApi';
import { isControlName, type ObjKind } from '../utils/objectKinds';
import { Tm1HttpError } from './httpError';

/**
 * `rule` is not its own TM1 collection, but the rule text OF a cube.
 * Bulk migration needs it as its own row (a cube without rules has nothing
 * to transfer), bulk deletion does not know it — there the rule text goes
 * with the cube.
 */
export type ListKind = ObjKind | 'rule';

export interface ObjectRow<K extends ListKind = ListKind> {
  kind: K;
  /** Cube of a view, or dimension of a subset; unset otherwise. */
  parent?: string;
  /** Hierarchy of a subset — `deleteSubset` needs it alongside the dimension. */
  hierarchy?: string;
  name: string;
  isControl: boolean;
}

interface RawViewCube { Name?: string; Views?: Array<{ Name?: string }> }
interface RawSubsetDim {
  Name?: string;
  Hierarchies?: Array<{ Name?: string; Subsets?: Array<{ Name?: string }> }>;
}

export function objectRow(
  kind: ListKind, name: string, parent?: string, hierarchy?: string,
): ObjectRow {
  return { kind, name, parent, hierarchy, isControl: isControlName(name, parent) };
}

/** GET that throws instead of returning an empty list — otherwise `listObjectRows` would wrongly report the kind as empty. */
async function getOrThrow<T>(cfg: Tm1Config, url: string): Promise<T> {
  const res = await apiRequest('GET', url, undefined, 60_000, cfg);
  if (res.statusCode !== 200) {
    throw new Tm1HttpError(`HTTP ${res.statusCode}: ${String(res.body ?? '').slice(0, 200)}`, res.statusCode);
  }
  return parseBody<T>(res);
}

/**
 * One list per REQUESTED object kind. A failure reports the kind, not the
 * whole page.
 *
 * Only the chosen kinds: the view and subset queries fetch the whole server
 * at once. Whoever is looking for processes should not have to pay for them.
 */
export async function listObjectRows<K extends ListKind>(
  cfg: Tm1Config,
  wanted: readonly K[],
): Promise<{ rows: ObjectRow<K>[]; failed: K[] }> {
  const tasks: Array<[ListKind, () => Promise<ObjectRow[]>]> = [
    ['cube', async () => (await listCubes(cfg, { select: 'Name', top: 10000 }))
      .map(c => objectRow('cube', String(c.Name)))],
    ['dimension', async () => (await listDimensionNames(cfg)).map(n => objectRow('dimension', n))],
    ['process', async () => (await listProcesses(cfg, { select: 'Name', top: 10000 }))
      .map(p => objectRow('process', String(p.Name)))],
    ['chore', async () => (await listChores(cfg, 'Name')).map(c => objectRow('chore', String(c.Name)))],
    // Which cubes have rules at all — without fetching the rule texts.
    //
    // Measured 2026-09-20 on 11.8: `$select=Name,Rules&$top=10000` pulled
    // 51,039 bytes in 34 ms, `$filter=Rules ne null` 1,787 bytes in 2 ms, and
    // both named the SAME 19 cubes — 0 missing, 0 extra. On a production
    // instance that is megabytes per search, just to check
    // `.trim() !== ''` afterward.
    //
    // `ne ''` would be wrong: `null ≠ ''` is true, the query returned 132
    // instead of 19 cubes (113 of them ruleless). Measured, not reasoned out.
    ['rule', () => listRuleCubes(cfg)],
    // One call for the whole server, not one per cube.
    ['view', async () => {
      const body = await getOrThrow<{ value?: RawViewCube[] }>(
        cfg, 'Cubes?$select=Name&$expand=Views($select=Name)');
      const out: ObjectRow[] = [];
      for (const c of body.value ?? []) {
        for (const v of c.Views ?? []) {
          if (v?.Name) { out.push(objectRow('view', String(v.Name), String(c.Name ?? ''))); }
        }
      }
      return out;
    }],
    // Subsets live under the HIERARCHIES, not directly under the dimension —
    // both deleting and writing need both names, so the row carries both.
    ['subset', async () => {
      const body = await getOrThrow<{ value?: RawSubsetDim[] }>(
        cfg, 'Dimensions?$select=Name&$expand=Hierarchies($select=Name;$expand=Subsets($select=Name))');
      const out: ObjectRow[] = [];
      for (const d of body.value ?? []) {
        for (const h of d.Hierarchies ?? []) {
          for (const sub of h.Subsets ?? []) {
            if (sub?.Name) {
              out.push(objectRow('subset', String(sub.Name), String(d.Name ?? ''), String(h.Name ?? '')));
            }
          }
        }
      }
      return out;
    }],
  ];

  const rows: ObjectRow[] = [];
  const failed: K[] = [];
  const picked = tasks.filter(([kind]) => (wanted as readonly ListKind[]).includes(kind));
  const results = await Promise.allSettled(picked.map(([, fn]) => fn()));
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') { rows.push(...r.value); } else { failed.push(picked[i][0] as K); }
  });
  return { rows: rows as ObjectRow<K>[], failed };
}

/**
 * Cubes with rule text. Filter first, full fetch as the fallback.
 *
 * Why the fallback: the filter is measured on 11.8 (exactly matching), but on
 * v12 only confirmed EMPTY — the v12 test database has no rules at all, the
 * filter returned 0 and so did the old approach. That does not contradict
 * itself, but it does not prove anything either. A server that silently
 * ignores the filter and returns an empty set would otherwise show "no
 * rules" instead of a list — and that is exactly the kind of thing nobody
 * notices.
 *
 * The fallback costs a second fetch only where truly no cube carries rules.
 * That is rare and cheap; the reverse would be expensive and silent.
 */
async function listRuleCubes(cfg: Tm1Config): Promise<ObjectRow[]> {
  const withRules = (cubes: Tm1CubeSummary[]): ObjectRow[] => cubes
    .filter(c => String((c as { Rules?: unknown }).Rules ?? '').trim() !== '')
    .map(c => objectRow('rule', String(c.Name)));

  const filtered = await listCubes(cfg, { select: 'Name', top: 10000, filter: 'Rules ne null' })
    .catch(() => null);
  if (filtered && filtered.length > 0) {
    return filtered.map(c => objectRow('rule', String(c.Name)));
  }
  return withRules(await listCubes(cfg, { select: 'Name,Rules', top: 10000 }));
}
