/**
 * TM1 element-name normalization for comparison/lookup.
 *
 * TM1 matches element (and object) names case-insensitively AND ignores
 * whitespace — "Element 1", "element1" and "ELEMENT1" all denote the same
 * element. Any code that compares a rule-text element reference against the
 * server's element list MUST normalize both sides with `normalizeElementName`,
 * otherwise valid references produce false "element not found" diagnostics.
 * (Same `wsInsensitive` rule already applied in tiServerLinter / check-temp-objects.)
 */

/** Lowercases and strips ALL whitespace — the TM1 element-name match key. */
export function normalizeElementName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

/**
 * Extracts non-empty string values from a TM1 element's `Attributes`
 * complex-type object (`{ attrName: value }`, as returned by
 * `Elements?$select=Name,Attributes`). Alias attributes live in here; treating
 * every string attribute value as a valid element reference avoids flagging
 * alias-based references (we can't tell alias-typed attrs apart without a
 * second metadata call, so we accept all string values — under-reporting
 * beats false positives).
 */
export function attributeStringValues(attrs: unknown): string[] {
  if (!attrs || typeof attrs !== 'object') { return []; }
  const out: string[] = [];
  for (const v of Object.values(attrs as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim() !== '') { out.push(v); }
  }
  return out;
}
