/**
 * Combined diff result returned by the replay engine. Aggregates the
 * per-domain diff outputs and exposes a single `pass` flag plus a flat
 * counter for summary UI.
 */

import type { CellDiffResult, HiddenCounts } from './cellDiff';
import type { GenericDiffResult } from './dimDiff';
import type { StatusDiffResult } from './statusDiff';
import type {
  DimOp,
  AttrOp,
  SubsetOp,
  ViewOp,
  CubeOp,
  TranOp,
  GenericMetaRow,
} from '../log/logSchema';

export type DiffResult = {
  cell: CellDiffResult;
  dim: GenericDiffResult<DimOp>;
  attr: GenericDiffResult<AttrOp>;
  subset: GenericDiffResult<SubsetOp>;
  view: GenericDiffResult<ViewOp>;
  cube: GenericDiffResult<CubeOp>;
  tran: GenericDiffResult<TranOp>;
  meta: GenericDiffResult<GenericMetaRow>;
  status: StatusDiffResult;
};

export type DiffSummary = {
  pass: boolean;
  totalDiffs: number;
  cellDiffs: number;
  dimDiffs: number;
  attrDiffs: number;
  subsetDiffs: number;
  viewDiffs: number;
  cubeDiffs: number;
  tranDiffs: number;
  metaDiffs: number;
  statusDiff: boolean;
};

type DiffKind = keyof HiddenCounts;
const KINDS: readonly DiffKind[] = ['equal', 'valueDiff', 'missing', 'extra'];
type AnyDiff = Record<DiffKind, unknown[]> & { hidden?: HiddenCounts };

/** Entries of one kind, including those `capDiffResult` dropped. */
export function diffCount(r: AnyDiff, kind: DiffKind): number {
  return r[kind].length + (r.hidden?.[kind] ?? 0);
}

function listDiffCount(r: AnyDiff): number {
  return diffCount(r, 'valueDiff') + diffCount(r, 'missing') + diffCount(r, 'extra');
}

function capList<R extends AnyDiff>(r: R, max: number): R {
  const hidden = { equal: 0, valueDiff: 0, missing: 0, extra: 0 };
  const out = { ...r };
  for (const k of KINDS) {
    hidden[k] = (r.hidden?.[k] ?? 0) + Math.max(0, r[k].length - max);
    (out as AnyDiff)[k] = r[k].slice(0, max);
  }
  return { ...out, hidden };
}

/**
 * Keep at most `max` entries per kind and count the rest, so the run result
 * cached for the diff view stays small. Kinds are capped separately, so equal
 * rows never push differences out. Measured on a production test: 2M kept
 * entries held 1.39 GB after the run.
 */
export function capDiffResult(r: DiffResult, max: number): DiffResult {
  const n = Math.max(0, Math.floor(max));
  return {
    ...r,
    cell: capList(r.cell, n),
    dim: capList(r.dim, n),
    attr: capList(r.attr, n),
    subset: capList(r.subset, n),
    view: capList(r.view, n),
    cube: capList(r.cube, n),
    tran: capList(r.tran, n),
    meta: capList(r.meta, n),
  };
}

export function summarize(result: DiffResult): DiffSummary {
  const cellDiffs = listDiffCount(result.cell);
  const dimDiffs = listDiffCount(result.dim);
  const attrDiffs = listDiffCount(result.attr);
  const subsetDiffs = listDiffCount(result.subset);
  const viewDiffs = listDiffCount(result.view);
  const cubeDiffs = listDiffCount(result.cube);
  const tranDiffs = listDiffCount(result.tran);
  const metaDiffs = listDiffCount(result.meta);
  const statusDiff = !result.status.equal;
  const totalDiffs =
    cellDiffs +
    dimDiffs +
    attrDiffs +
    subsetDiffs +
    viewDiffs +
    cubeDiffs +
    tranDiffs +
    metaDiffs +
    (statusDiff ? 1 : 0);

  return {
    pass: totalDiffs === 0,
    totalDiffs,
    cellDiffs,
    dimDiffs,
    attrDiffs,
    subsetDiffs,
    viewDiffs,
    cubeDiffs,
    tranDiffs,
    metaDiffs,
    statusDiff,
  };
}
