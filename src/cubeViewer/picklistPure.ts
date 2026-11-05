/**
 * Parser for TM1 picklist definitions.
 *
 * The basis is exclusively live measurements against 11.8, not the IBM docs:
 * the prefix is case-insensitive, `dimension:` and `subset:` carry an
 * optional hierarchy segment, and anything not understood yields `null`.
 *
 * `null` means "no list", NOT "error". The server behaves the same way:
 * an unknown prefix or a dead reference lets every value through.
 */

export type PicklistDef =
  | { kind: 'static'; values: string[] }
  | { kind: 'dimension'; dimension: string; hierarchy?: string }
  | { kind: 'subset'; dimension: string; hierarchy?: string; subset: string };

export function parsePicklistDefinition(raw: string | undefined | null): PicklistDef | null {
  if (raw === undefined || raw === null) {
    return null;
  }

  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  const colon = trimmed.indexOf(':');
  if (colon === -1) {
    // No prefix → no list
    return null;
  }

  const prefix = trimmed.substring(0, colon).trim().toLowerCase();
  const restStr = trimmed.substring(colon + 1);
  const parts = restStr.split(':');

  if (prefix === 'static') {
    // At least one value required
    if (parts.length === 1 && parts[0] === '') {
      // `static:` alone → no list
      return null;
    }
    return { kind: 'static', values: parts };
  }

  if (prefix === 'dimension') {
    // `dimension:Dim` (2-segment form) or `dimension:Dim:Hier` (3-segment form)
    if (parts.length === 2) {
      const [dimension, hierarchy] = parts;
      return dimension && hierarchy ? { kind: 'dimension', dimension, hierarchy } : null;
    }
    if (parts.length === 1) {
      const [dimension] = parts;
      return dimension ? { kind: 'dimension', dimension } : null;
    }
    return null;
  }

  if (prefix === 'subset') {
    // `subset:Dim:Subset` (3-segment form) or `subset:Dim:Hier:Subset` (4-segment form)
    if (parts.length === 2) {
      const [dimension, subset] = parts;
      return dimension && subset ? { kind: 'subset', dimension, subset } : null;
    }
    if (parts.length >= 3) {
      const [dimension, hierarchy, subset] = parts;
      return dimension && hierarchy && subset
        ? { kind: 'subset', dimension, hierarchy, subset }
        : null;
    }
    return null;
  }

  // Unknown prefix
  return null;
}

export interface PicklistLookup {
  /** Raw definition of the cell level for this cell, if already known —
   *  since Task 15 from the LAZY single query, no longer from a
   *  grid-wide read. */
  cellDef?: string;
  /** Element names in CUBE dimension order. */
  coordinates: string[];
  /** Cube dimension names, same order as `coordinates`. */
  cubeDims: string[];
  /** dim → element → raw definition (attribute level) */
  byElement: Record<string, Record<string, string>>;
  /** element → raw definition from the rule text of the control cube.
   *  DIMENSIONLESS: the area bracket of a TM1 rule names elements without
   *  their dimension, TM1 resolves them itself. */
  byRuleElement?: Record<string, string>;
}

/**
 * The precedence chain from the live measurement:
 *
 *   1. Cell level (`cellDef`) — the evaluated value of the cell itself; the
 *      rule has already won on the server side, and a stored cell
 *      beats the rule anyway.
 *   2. Rule map (`byRuleElement`) — the rule text of the control cube.
 *   3. Element ATTRIBUTE (`byElement`).
 *
 * Why the rule map comes BEFORE the attribute: both are "area-wide" (there is
 * no single-cell query, only rule and attribute). The measurements
 * (2026-08-13) confirm: the control cube (`}PickList_<Cube>`) beats the
 * dimension attributes. That means the rule map wins.
 *
 * Within one level the LATER cube dimension wins (backward pass) —
 * unchanged from the live measurement.
 *
 * The return value is the RAW definition, not the parsed object: the caller
 * passes it on unchanged as a cache key to the resolution.
 */
export function pickDefinitionForCell(input: PicklistLookup): string | null {
  // 1. Stored cell in the control cube (highest priority).
  if (parsePicklistDefinition(input.cellDef)) {
    return input.cellDef!.trim();
  }

  // 2. Rule text of the control cube (cell level, beats attribute).
  // Precedence chain: later cube dimension wins; `['Status']` beats `['Measures']`.
  const byRule = input.byRuleElement;
  if (byRule) {
    for (let i = input.coordinates.length - 1; i >= 0; i--) {
      const def = byRule[input.coordinates[i]];
      if (parsePicklistDefinition(def)) {
        return def.trim();
      }
    }
  }

  // 3. Element attribute (dimension level, lowest priority).
  // Precedence chain: later cube dimension wins.
  for (let i = input.cubeDims.length - 1; i >= 0; i--) {
    const def = input.byElement[input.cubeDims[i]]?.[input.coordinates[i]];
    if (parsePicklistDefinition(def)) {
      return def.trim();
    }
  }
  return null;
}
