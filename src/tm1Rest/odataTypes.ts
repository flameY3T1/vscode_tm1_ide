// src/tm1Rest/odataTypes.ts
// Shared OData v4 wire-shapes for TM1 REST responses (Cellsets, MDX axes/tuples).
//
// These are the EXPORTED, proven shapes promoted from the private
// `Api*` interfaces in `src/mdx/cellsetParser.ts` (see `ApiMember`/`ApiTuple`/
// `ApiHierarchy`/`ApiAxis`/`ApiCell`/`ApiCellset` there). They are widened to
// a strict superset covering every field read by BOTH `cellsetParser.ts` and
// `src/commands/cubeViewer/cellParse.ts` (`RawCell`, `parseTitleAndTuples`).
// Migrating `cellsetParser.ts` is a pure type-swap (it already guards
// `typeof c.Ordinal === 'number'`). Migrating `cellParse.ts` needs one narrowing
// guard: `RawCell.Ordinal` is REQUIRED and used in unguarded arithmetic
// (`cellParse.ts` ~:24, `cell.Ordinal / cols`), whereas `ODataCell.Ordinal` is
// optional here (it must also satisfy TM1 responses that omit it) — so a literal
// param-type swap there trips strict-null-check until Ordinal is narrowed.
//
// No runtime dependencies — type-only module.

/** A single member on an axis tuple. */
export interface ODataMember {
  Name?: string;
}

/** One tuple (row/column/title combination) on an axis. */
export interface ODataTuple {
  Members?: ODataMember[];
}

/** A hierarchy participating in an axis (identifies the dimension/hierarchy column). */
export interface ODataHierarchy {
  Name?: string;
  /** Present only when the request expands it; tells an alternate hierarchy from its dimension. */
  Dimension?: { Name?: string };
}

/** One cellset axis (Columns/Rows/Title, per TM1's `Axes[N]` convention). */
export interface ODataAxis {
  Ordinal?: number;
  Cardinality?: number;
  Hierarchies?: ODataHierarchy[];
  Tuples?: ODataTuple[];
}

/** A single cell in a cellset, keyed by `Ordinal` (row-major: `row * numCols + col`). */
export interface ODataCell {
  Ordinal?: number;
  Value?: number | string | null;
  FormattedValue?: string;
  Consolidated?: boolean;
  RuleDerived?: boolean;
  /** Bit mask (`Edm.Int32`); see `cubeViewer/cellParse.ts`. */
  Updateable?: number | boolean;
}

/** Full cellset response shape (`GET /Cellsets('<id>')?$expand=Axes(...),Cells`). */
export interface ODataCellset {
  Axes?: ODataAxis[];
  Cells?: ODataCell[];
}

/**
 * OData v4 error envelope (`{ error: { code, message } }`).
 *
 * `message` is a union because TM1 REST returns it two ways depending on
 * call site: security-api MDX/cellset errors use a plain string; some
 * cube-level errors (e.g. `Cubes('<n>').tm1.ReorderDimensions`) nest it as
 * `{ value: string }` (the OData-spec "annotated string" shape). Use
 * `odataErrorMessage()` (`./parseRest`) to extract the message uniformly.
 */
export interface ODataError {
  error?: {
    code?: string;
    message?: string | { value?: string };
  };
}
