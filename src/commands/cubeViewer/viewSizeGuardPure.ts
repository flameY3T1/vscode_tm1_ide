// Pure, vscode-free arithmetic for the "this view cannot possibly be executed"
// guard. The REST side lives in `viewSizeGuard.ts`.
//
// Why this exists: a saved NativeView may put every dimension of the cube on one
// axis, each entry being the WHOLE dimension (`TM1SubsetAll([D])`), suppression
// off. `Cubes('C')/Views('V')/tm1.Execute` then asks TM1 to materialise the full
// cross product. Measured on 11.8:
//
//   Cube A / View1 — 11 dimensions on rows, columns empty, no suppression
//   85 × 24 × 68 × 105 × 309 × 13936 × 211852 × 10839 × 160659 × 82 × 9
//   ≈ 1.7e31 row tuples
//
// That is not "a big view", it is unbounded, and it takes the server's RAM with
// it. Cell paging further down only ever sees a cellset that already exists, so
// the brake has to sit BEFORE the execute.
//
// Deliberately narrow: block only what can be PROVEN extreme from axis sizes we
// actually know. One unknown axis makes the whole estimate unknown, and unknown
// never blocks — a false positive would make a legitimate view unopenable, which
// is worse than the rare miss.

/** One axis entry with the member count we managed to determine, or `null`. */
export interface AxisSize {
  /** Hierarchy/dimension the entry sits on — used for the message. */
  dim: string;
  /** Members on that entry, or `null` when it could not be determined cheaply. */
  count: number | null;
}

export interface ViewSizeVerdict {
  /** True only when the product is KNOWN and exceeds the limit. */
  block: boolean;
  /** Product of all axis sizes, saturated; `null` when any size is unknown. */
  tuples: number | null;
  /** Dimensions that drove the size, largest first — for the message. */
  drivers: Array<{ dim: string; count: number }>;
}

/**
 * Multiply the axis sizes. Returns `null` as soon as one size is unknown, and
 * saturates at `Number.MAX_SAFE_INTEGER` rather than drifting into a float that
 * compares wrong — the exact magnitude past the limit is irrelevant, only that
 * it is past it.
 */
function _product(sizes: AxisSize[]): number | null {
  let acc = 1;
  for (const s of sizes) {
    if (s.count === null) { return null; }
    if (s.count === 0) { return 0; }
    if (acc > Number.MAX_SAFE_INTEGER / s.count) { return Number.MAX_SAFE_INTEGER; }
    acc *= s.count;
  }
  return acc;
}

/**
 * Decide whether a view is provably too large to execute.
 *
 * `suppressed` short-circuits to "don't block": with suppression on TM1 only
 * materialises populated tuples, so the cross product says nothing about the real
 * size — a sparse cube can carry a huge nominal product and return few rows.
 */
export function judgeViewSize(
  rows: AxisSize[],
  cols: AxisSize[],
  suppressed: boolean,
  limit: number,
): ViewSizeVerdict {
  const drivers = [...rows, ...cols]
    .filter((a): a is AxisSize & { count: number } => a.count !== null)
    .map((a) => ({ dim: a.dim, count: a.count }))
    .sort((x, y) => y.count - x.count);

  if (suppressed) { return { block: false, tuples: null, drivers }; }

  const rowT = _product(rows);
  const colT = _product(cols);
  if (rowT === null || colT === null) { return { block: false, tuples: null, drivers }; }

  // An empty axis contributes one implicit tuple, not zero — TM1 fills it in.
  const r = rows.length === 0 ? 1 : rowT;
  const c = cols.length === 0 ? 1 : colT;
  const tuples = r > Number.MAX_SAFE_INTEGER / Math.max(c, 1) ? Number.MAX_SAFE_INTEGER : r * c;

  return { block: tuples > limit, tuples, drivers };
}

/** `TM1SubsetAll([Dim])` — the whole dimension, the usual driver of the blow-up. */
const SUBSET_ALL_RE = /^\s*TM1SUBSETALL\s*\(\s*\[(.+?)\]\s*\)\s*$/i;

/** The dimension an expression selects in full, or `null` for anything else. */
export function subsetAllDimension(expression: string | undefined): string | null {
  if (!expression) { return null; }
  const m = SUBSET_ALL_RE.exec(expression);
  return m ? m[1].replace(/\]\]/g, ']') : null;
}
