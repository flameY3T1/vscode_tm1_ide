/**
 * Translate a NativeView that was read into a write body.
 *
 * Measured against 11.8 (viewCopyProbe2.js, 6 of 6 views read
 * back identically — axis shapes: expression only, expression+title,
 * element list+title, named subset, all three mixed):
 *
 * - The axes are read ONLY in the path form (`Rows/Subset(...)`). The
 *   options form `Rows($expand=...)` is a 400 "Expecting '/' after property
 *   of complex type in expand path" — Rows/Columns/Titles are complex types.
 *   The path form delivers EVERY dimension of an axis this way, including
 *   the second and third one; a read model with only one row dimension
 *   would silently lose them.
 * - The body needs `@odata.type: '#ibm.tm1.api.v1.NativeView'`. Without it,
 *   the POST answers 400 "Object in payload is not a derived type of
 *   tm1.View" — even when the read response is written back stripped of
 *   only its `@odata.*` fields.
 * - A NAMED subset is written as a reference (`Subset@odata.bind`), not as
 *   a copy. So on a foreign server it must exist there.
 * - An anonymous subset with an expression goes as `Expression`, one without
 *   as an `Elements@odata.bind` list.
 * - A title axis additionally carries `Selected@odata.bind`.
 *
 * No vscode, no network — the build is testable, the reading lives in
 * `viewCopyApi.ts`.
 */

import { encodeODataKey as encodeKey } from '../utils/odataKey';

export {};

/**
 * How many members an anonymous, expression-less axis subset may have so
 * that the copy can still be written element by element.
 *
 * Each member becomes its own URL in the POST. Uncapped, an axis with 295k
 * members is a double-digit-megabyte POST — realistically a timeout. Same
 * cap as in the Cube Viewer (`VIEW_AXIS_ELEMENTS_MAX`). What lies above it
 * is REPORTED, not truncated: a silently halved axis would be a different
 * view.
 */
export const VIEW_COPY_ELEMENTS_MAX = 10000;

export interface RawViewSubset {
  Name?: string;
  Expression?: string;
  Alias?: string;
  Hierarchy?: { Name?: string; Dimension?: { Name?: string } };
  Elements?: Array<{ Name?: string }>;
}

export interface RawViewAxisEntry {
  Subset?: RawViewSubset;
  Selected?: { Name?: string };
}

export interface RawNativeView {
  Name?: string;
  Rows?: RawViewAxisEntry[];
  Columns?: RawViewAxisEntry[];
  Titles?: RawViewAxisEntry[];
  SuppressEmptyRows?: boolean;
  SuppressEmptyColumns?: boolean;
}

/** A named subset that the copy references — it must exist over there. */
export interface NamedSubsetRef {
  dim: string;
  hier: string;
  name: string;
}

export interface ViewCopyPlan {
  body: Record<string, unknown>;
  /** References the target server must know about so the POST goes through. */
  namedSubsets: NamedSubsetRef[];
  /** Axes that are too large to be copied element by element. */
  oversized: string[];
  /** Axis entries without a hierarchy — not reproducible. */
  unreadable: number;
}

function hierRef(dim: string, hier: string): string {
  return `Dimensions('${encodeKey(dim)}')/Hierarchies('${encodeKey(hier)}')`;
}

interface AxisResult {
  entry: Record<string, unknown> | null;
  named?: NamedSubsetRef;
  oversized?: string;
}

function axisEntry(entry: RawViewAxisEntry, withSelected: boolean): AxisResult {
  const sub = entry?.Subset ?? {};
  const hier = sub.Hierarchy?.Name;
  // Without a hierarchy, the anchor that everything binds to is missing.
  if (!hier) { return { entry: null }; }
  const dim = sub.Hierarchy?.Dimension?.Name ?? hier;
  const ref = hierRef(dim, hier);

  let out: Record<string, unknown>;
  let named: NamedSubsetRef | undefined;
  if (sub.Name) {
    out = { 'Subset@odata.bind': `${ref}/Subsets('${encodeKey(sub.Name)}')` };
    named = { dim, hier, name: sub.Name };
  } else if (sub.Expression) {
    out = { Subset: { 'Hierarchy@odata.bind': ref, Expression: sub.Expression, Alias: sub.Alias ?? '' } };
  } else {
    const names = (sub.Elements ?? []).map(e => e.Name).filter((n): n is string => !!n);
    if (names.length > VIEW_COPY_ELEMENTS_MAX) { return { entry: null, oversized: hier }; }
    out = {
      Subset: {
        'Hierarchy@odata.bind': ref,
        'Elements@odata.bind': names.map(n => `${ref}/Elements('${encodeKey(n)}')`),
        Alias: sub.Alias ?? '',
      },
    };
  }

  if (withSelected) {
    // Without an explicit choice, the first member — TM1 has no such thing
    // as a title axis without a selection, and the context must point
    // somewhere.
    const sel = entry.Selected?.Name ?? (sub.Elements ?? [])[0]?.Name;
    if (sel) { out['Selected@odata.bind'] = `${ref}/Elements('${encodeKey(sel)}')`; }
  }
  return { entry: out, named };
}

/**
 * Build the POST/PATCH body for a copy.
 *
 * `targetName` is in the body: on POST it names the new view, on PATCH TM1
 * ignores it (no rename trap like with processes).
 */
export function buildNativeViewCopyBody(view: RawNativeView, targetName: string): ViewCopyPlan {
  const namedSubsets: NamedSubsetRef[] = [];
  const oversized: string[] = [];
  let unreadable = 0;

  const axis = (list: RawViewAxisEntry[] | undefined, withSelected: boolean): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const e of list ?? []) {
      const r = axisEntry(e, withSelected);
      if (r.oversized) { oversized.push(r.oversized); continue; }
      if (!r.entry) { unreadable++; continue; }
      if (r.named) { namedSubsets.push(r.named); }
      out.push(r.entry);
    }
    return out;
  };

  return {
    body: {
      '@odata.type': '#ibm.tm1.api.v1.NativeView',
      Name: targetName,
      Rows: axis(view.Rows, false),
      Columns: axis(view.Columns, false),
      Titles: axis(view.Titles, true),
      SuppressEmptyRows: !!view.SuppressEmptyRows,
      SuppressEmptyColumns: !!view.SuppressEmptyColumns,
    },
    namedSubsets,
    oversized,
    unreadable,
  };
}

/** Body of an MDX view. It has no subsets to preserve. */
export function buildMdxViewCopyBody(mdx: string, targetName: string): Record<string, unknown> {
  return { '@odata.type': '#ibm.tm1.api.v1.MDXView', Name: targetName, MDX: mdx };
}
