/**
 * Compare two ordered op lists (dim/attr/subset/view/cube). Each op gets a
 * stable identity-key derived from its semantic fields; entries present in
 * one list but not the other become missing/extra. Same-key entries with
 * differing payload (e.g. AttrPutN value) become valueDiff.
 */

import type { HiddenCounts } from './cellDiff';

export type GenericDiffEntry<T> = {
  key: string;
  expected: T | undefined;
  actual: T | undefined;
};

export type GenericDiffResult<T> = {
  equal: GenericDiffEntry<T>[];
  valueDiff: GenericDiffEntry<T>[];
  missing: GenericDiffEntry<T>[];
  extra: GenericDiffEntry<T>[];
  /** Entries dropped by `capDiffResult`, per kind. */
  hidden?: HiddenCounts;
};

function defaultDeepEqual<T>(a: T, b: T): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i++) {
    if (ka[i] !== kb[i]) return false;
    const va = (a as Record<string, unknown>)[ka[i]];
    const vb = (b as Record<string, unknown>)[ka[i]];
    if (!defaultDeepEqual(va, vb)) return false;
  }
  return true;
}

export function diffOpList<T>(
  expected: T[],
  actual: T[],
  keyFn: (op: T) => string,
  compareFn: (a: T, b: T) => boolean = defaultDeepEqual,
): GenericDiffResult<T> {
  const expectedMap = new Map<string, T>();
  for (const op of expected) expectedMap.set(keyFn(op), op);
  const actualMap = new Map<string, T>();
  for (const op of actual) actualMap.set(keyFn(op), op);

  const equal: GenericDiffEntry<T>[] = [];
  const valueDiff: GenericDiffEntry<T>[] = [];
  const missing: GenericDiffEntry<T>[] = [];
  const extra: GenericDiffEntry<T>[] = [];

  for (const [key, eOp] of expectedMap) {
    const aOp = actualMap.get(key);
    if (!aOp) {
      missing.push({ key, expected: eOp, actual: undefined });
      continue;
    }
    if (compareFn(eOp, aOp)) {
      equal.push({ key, expected: eOp, actual: aOp });
    } else {
      valueDiff.push({ key, expected: eOp, actual: aOp });
    }
  }

  for (const [key, aOp] of actualMap) {
    if (!expectedMap.has(key)) {
      extra.push({ key, expected: undefined, actual: aOp });
    }
  }

  const sortFn = (a: GenericDiffEntry<T>, b: GenericDiffEntry<T>) =>
    a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  equal.sort(sortFn);
  valueDiff.sort(sortFn);
  missing.sort(sortFn);
  extra.sort(sortFn);

  return { equal, valueDiff, missing, extra };
}

export function dimOpKey(op: {
  op: string;
  dim?: string;
  hier?: string;
  name?: string;
  parent?: string;
  child?: string;
}): string {
  return [op.op, op.dim ?? '', op.hier ?? '', op.name ?? '', op.parent ?? '', op.child ?? ''].join(
    '|',
  );
}

export function attrOpKey(op: {
  op: string;
  dim?: string;
  hier?: string;
  element?: string;
  subset?: string;
  attribute: string;
}): string {
  return [
    op.op,
    op.dim ?? '',
    op.hier ?? '',
    op.element ?? '',
    op.subset ?? '',
    op.attribute,
  ].join('|');
}

export function subsetOpKey(op: {
  op: string;
  dim?: string;
  hier?: string;
  subset?: string;
  element?: string;
}): string {
  return [op.op, op.dim ?? '', op.hier ?? '', op.subset ?? '', op.element ?? ''].join('|');
}

export function viewOpKey(op: {
  op: string;
  cube: string;
  view: string;
  dim?: string;
  element?: string;
}): string {
  return [op.op, op.cube, op.view, op.dim ?? '', op.element ?? ''].join('|');
}

export function cubeOpKey(op: { op: string; name: string }): string {
  return [op.op, op.name].join('|');
}

/** Stable identity for `TranOp` — discriminated by transactionId. */
export function tranOpKey(op: { op: string; transactionId: string }): string {
  return [op.op, op.transactionId].join('|');
}

/** Canonicalize a negative-zero numeric arg (`-0`, `-0,00`, `-0.0`) to positive.
 *  TM1's `NumberToStringEx` keeps the sign of a value that rounds to zero (`-0`),
 *  but the source dump's `NumberToString` drops it, so the replayed value is `0`.
 *  `-0` and `0` are the same number — treat them as equal for diff identity. */
function canonZero(arg: string): string {
  return /^-0([.,]0*)?$/.test(arg) ? arg.slice(1) : arg;
}

/** Stable identity key for `GenericMetaRow` — op + ordered args. Two meta-op
 *  log lines with identical op-name and args collapse to a single key. */
export function metaOpKey(op: { op: string; args: string[] }): string {
  return [op.op, ...op.args.map(canonZero)].join('|');
}
