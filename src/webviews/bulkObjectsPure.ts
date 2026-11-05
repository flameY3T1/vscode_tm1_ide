// src/webviews/bulkObjectsPure.ts
//
// What bulk delete and bulk migration share: the vocabulary of the
// object kinds, the pattern matching, the control object detection and the formation
// of row key and label.
//
// Why a file of its own: until 2026-09-20 all of this lived in `bulkDeletePure.ts`.
// The migration page was thereby tied to the word "Delete", although it deletes nothing,
// and `tm1Rest/objectListingApi.ts` would have had to reach into a
// webview module for a control-object question. Only what both pages need is here.
// The bare vocabulary (`ObjKind`, `isControlName`) lives one layer
// lower in `utils/objectKinds.ts`: `tm1Rest/objectListingApi.ts` needs it
// too, and a REST file does not reach up into `webviews/`.
import { splitQualifiedName } from '../utils/qualifiedName';

/** Everything that has a meaning in a regexp literal — except `*` and `?`. */
const RE_SPECIAL = /[.+^${}()|[\]\\]/g;

/**
 * An empty pattern matches everything.
 *
 * If the pattern contains `*` or `?`, it counts as a wildcard pattern and must cover the
 * WHOLE name (`zzTest_*`); otherwise one occurrence anywhere in the
 * name (`Test`) suffices. Upper and lower case never matter — TM1
 * itself does not distinguish them in object names.
 */
export function matchesPattern(name: string, pattern: string): boolean {
  const p = pattern.trim();
  if (p === '') { return true; }
  if (!p.includes('*') && !p.includes('?')) {
    return name.toLowerCase().includes(p.toLowerCase());
  }
  const body = p.replace(RE_SPECIAL, '\\$&').split('*').join('.*').split('?').join('.');
  return new RegExp(`^${body}$`, 'i').test(name);
}
/**
 * Names for a table cell: the first `max`, behind them the remaining count.
 * The whole list belongs in the cell's `title`, not in the row — 300
 * process names side by side are no longer information.
 */
export function capNames(names: readonly string[], max: number): { shown: string; rest: number } {
  return {
    shown: names.slice(0, max).join(', '),
    rest: Math.max(0, names.length - max),
  };
}
/** What makes a row unique — key of the selection AND of the delete list. */
export interface RowRef {
  /**
   * `string`, not `ObjKind`: the bulk migration carries `rule` as a kind
   * that does not exist for deleting (there the rule text goes with the cube). Both
   * sides form the key and the label with the same three
   * functions — two copies of them would be two key forms.
   */
  kind: string;
  name: string;
  parent?: string;
  hierarchy?: string;
}

/**
 * The HIERARCHY belongs in the key.
 *
 * Subsets live under the hierarchies, and the page lists those of all
 * hierarchies: `Region / Region / Default` and `Region / Sales / Default`
 * carried the same key without it. One click marked both, the counter
 * showed one — and two were deleted.
 *
 * `JSON.stringify` instead of a separator: a name may contain any character
 * that one would pick as a separator.
 */
export function rowKey(r: RowRef): string {
  return JSON.stringify([r.kind, r.parent ?? '', r.hierarchy ?? '', r.name]);
}

/**
 * The parent object before the name. The hierarchy only if it is not named like the
 * dimension — `Region / Region / Default` would be noise, `Region / Sales /
 * Default` is the distinction.
 */
export function rowOwner(r: RowRef): string {
  if (!r.parent) { return ''; }
  return r.hierarchy && r.hierarchy !== r.parent ? `${r.parent} / ${r.hierarchy}` : r.parent;
}

/** Full designation for the name column and the confirmation. */
export function rowLabel(r: RowRef): string {
  const owner = rowOwner(r);
  return owner ? `${owner} / ${r.name}` : r.name;
}

/**
 * The qualified reference name of the index, made readable.
 *
 * The index carries views as `Cube:View` and subsets as
 * `Dim:Hier:Subset`. Which of the two forms is present is NOT told by the number
 * of colons — v12 allows `:` in the object name —, but by the kind, and
 * that is on the reference. After that `rowLabel` forms the label, so that a
 * subset is called here exactly what it is called in its own row.
 */
export function qualifiedLabel(sourceName: string, kind: 'view' | 'subset'): string {
  if (kind === 'view') {
    const [cube, view] = splitQualifiedName(sourceName, 2);
    return rowLabel({ kind, name: view ?? sourceName, parent: cube });
  }
  const [dim, hier, sub] = splitQualifiedName(sourceName, 3);
  return rowLabel({ kind, name: sub ?? sourceName, parent: dim, hierarchy: hier });
}
