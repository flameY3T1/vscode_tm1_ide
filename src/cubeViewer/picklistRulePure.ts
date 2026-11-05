/**
 * Reads from the RULE TEXT of the control cube `}PickList_<Cube>` which
 * elements carry a picklist.
 *
 * WHY from the rule text and not from the cube (measured 2026-08-13, TM1
 * 11.8, on a planning cube, probes picklistViewProbe*.js):
 *
 * | Query form against `}PickList_<Cube>`       | Cost              |
 * |---------------------------------------------|-------------------|
 * | `GET Cubes('}PickList_<c>')/Rules`          | 1 ms              |
 * | ONE cell, even never queried before         | 1–2 ms            |
 * | 417 cells in ONE cellset                    | 12 521 ms         |
 * | Window of a real saved view                 | > 10 min, cancelled |
 * | Scan per dimension over its elements        | 19 s total        |
 *
 * The control cube is NOT expensive per cell, but with the CELLSET SIZE.
 * Cheap individually, ruinous in bulk. Every area-wide query is thereby ruled out —
 * including the obvious "scan per dimension". Whoever wants to build a range
 * query in here again later: the numbers above are here for exactly that reason.
 *
 * The parser accepts ONLY the simple form: an area bracket with EXACTLY ONE
 * element name in quotes, assigned a string literal.
 *
 *     ['Status_Feld'] = S: 'Dimension:Dropdown_Status';
 *
 * WHY exactly one and not several: `['A','B']` in TM1 is a CONJUNCTION
 * over dimensions — "cells in which one dimension is at A AND another
 * is at B". This map is dimensionless (see below) and cannot represent an AND;
 * splitting it into `{A: def, B: def}` would turn it into an OR
 * and hit every cell with A, even without B. The consequence would be exactly the wrong
 * arrow: a dropdown that TM1 never enforces there, plus an insert
 * pre-check that rejects values TM1 would accept. Multi-element brackets
 * are therefore skipped ENTIRELY — the affected cells continue to be served
 * by the lazy single query on double-click (1–2 ms, see table above).
 *
 * Everything else — conditions, `DB(...)`, functions, calculated areas,
 * `FEEDERS`/`SKIPCHECK`, comments — is SKIPPED, not guessed. A
 * wrong arrow is worse than no arrow: without an arrow the cell keeps
 * working (single query on double-click), with a wrong arrow the display
 * promises a dropdown that TM1 never enforces.
 */

/** `''` is TM1's escape for a single `'` in the literal. */
const unescapeLiteral = (s: string): string => s.split("''").join("'");

/**
 * One statement of the simple form. Both sides are deliberately narrow:
 * - on the left ONLY `'name'` literals, separated by commas (no `!dim`, no
 *   `{...}`, no function) — multiple literals are discarded afterwards by the
 *   caller (conjunction, see file header); the form is still
 *   admitted here so that `['A','B'] = …` ends as a RECOGNIZED statement and does not
 *   drift on as a not understood remainder,
 * - on the right ONE string literal, optionally after the type marker `S:`/`N:`.
 * The type marker describes the CELL, not the definition — a
 * picklist definition is always a string, which is why both count.
 */
const SIMPLE_ASSIGNMENT =
  /^\[\s*((?:'(?:[^']|'')*'\s*)(?:,\s*'(?:[^']|'')*'\s*)*)\]\s*=\s*(?:[SNsn]\s*:\s*)?'((?:[^']|'')*)'$/;

/** The element names from the area bracket — at this point the bracket has
 *  already been recognized as "literals only". There must be EXACTLY ONE,
 *  see file header. */
const NAME_LITERAL = /'((?:[^']|'')*)'/g;

/**
 * Rule text → `element name → raw definition`.
 *
 * Dimensionless, and that is no negligence: the area bracket of a
 * TM1 rule names elements WITHOUT their dimension, TM1 resolves them itself against the
 * dimension that contains the element. The map therefore deliberately has a
 * different shape than the attribute map (`dim → element → def`) and is kept in
 * `pickDefinitionForCell` as a separate, lower-ranking source.
 */
export function parsePicklistRules(rulesText: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rulesText) { return out; }

  const lines: string[] = [];
  for (const rawLine of rulesText.split('\n')) {
    const line = rawLine.trim();
    // TM1 comment line. Only at the start of a line: a `#` in the middle of a line
    // can be inside a literal, and guessing is forbidden here.
    if (line.startsWith('#')) { continue; }
    // From `FEEDERS;` on the feeder section begins — it contains not a single
    // picklist definition, but forms that resemble an assignment.
    if (/^FEEDERS\s*;?$/i.test(line)) { break; }
    lines.push(line);
  }

  // Statements end at the semicolon, not at the end of the line: an assignment may
  // run over several lines. Conversely, two statements without a
  // separator must NOT merge into one — that is why the semicolon is taken
  // seriously as a separator and anything without a separator remains a single,
  // not understood statement.
  for (const rawStatement of lines.join(' ').split(';')) {
    const statement = rawStatement.trim();
    if (statement === '') { continue; }
    const m = SIMPLE_ASSIGNMENT.exec(statement);
    if (!m) { continue; }

    const def = unescapeLiteral(m[2]).trim();
    // An empty definition means "no list" — TM1 then switches the picklist off
    // silently itself (same rule as in `picklistPure.ts`).
    if (def === '') { continue; }

    NAME_LITERAL.lastIndex = 0;
    const names: string[] = [];
    let nameMatch: RegExpExecArray | null;
    while ((nameMatch = NAME_LITERAL.exec(m[1])) !== null) {
      names.push(unescapeLiteral(nameMatch[1]).trim());
    }
    // EXACTLY ONE. Several names in one bracket are a conjunction over
    // dimensions ("A AND B") that this dimensionless map cannot represent
    // — splitting it would turn it into an OR and put an arrow on
    // cells where TM1 enforces nothing. Skip the whole line; the
    // cells stay served via the single query (rationale in the header).
    if (names.length !== 1) { continue; }
    const name = names[0];
    // TM1 evaluates rules from top to bottom: the FIRST matching
    // statement wins, later ones are dead for the same cell.
    if (name !== '' && out[name] === undefined) { out[name] = def; }
  }

  return out;
}
