import { describe, it, expect } from 'vitest';
import {
  sameName,
  normName,
  parseArea,
  parseFeederStatements,
  hitsCell,
  matchesFor,
  type ModelKnowledge,
} from '../../debugUtility/feederTargetMatch';

/** Small model: two dimensions, one of them with a consolidation. */
const DIMS = ['Datenarten', 'Positionen', 'ValueFields'];
const KINDER: Record<string, string[]> = {
  'Positionen|SubTurnover': ['5204', '5151'],
};
const WISSEN: ModelKnowledge = {
  dimensionOf: (el) => {
    if (['PLAN', 'VORSCHAU', 'RULE', 'Rule', 'IST'].includes(el)) { return 'Datenarten'; }
    if (['5204', '5151', 'SubTurnover'].includes(el)) { return 'Positionen'; }
    if (['Wert', 'Menge'].includes(el)) { return 'ValueFields'; }
    return undefined;
  },
  contains: (dim, kons, el) => (KINDER[`${dim}|${kons}`] ?? []).includes(el),
};

describe('parseArea', () => {
  it('reads a simple element', () => {
    expect(parseArea("['Wert']")?.terms).toEqual([{ dimension: undefined, elements: ['Wert'] }]);
  });

  it('reads the qualified form', () => {
    expect(parseArea("['Datenarten':'PLAN']")?.terms)
      .toEqual([{ dimension: 'Datenarten', elements: ['PLAN'] }]);
  });

  // A comma INSIDE the set braces belongs to the set. Without this
  // distinction the term falls apart into two and the whole matching shifts
  // by one position.
  it('keeps a set together', () => {
    expect(parseArea("['Datenarten':{'PLAN','VORSCHAU'}, 'Wert']")?.terms).toEqual([
      { dimension: 'Datenarten', elements: ['PLAN', 'VORSCHAU'] },
      { dimension: undefined, elements: ['Wert'] },
    ]);
  });

  it('resolves doubled single quotes', () => {
    expect(parseArea("['O''Neil']")?.terms[0].elements).toEqual(["O'Neil"]);
  });

  // An expression instead of a literal must NOT be guessed — the term passes
  // through without elements and makes the matching undecidable.
  it('reports an uninterpretable term as empty', () => {
    expect(parseArea("[ATTRS('D','E','A')]")?.terms[0].elements).toEqual([]);
  });

  it('no range without brackets', () => {
    expect(parseArea('kein Bereich')).toBeUndefined();
  });
});

describe('parseFeederStatements', () => {
  const regeln = [
    'SKIPCHECK;',
    "['RULE','Wert'] = N: 1;",
    'FEEDERS;',
    '### Umschlag',
    "['IST','Menge'] => ['RULE','Wert'];",
    "# ['IST','Menge'] => ['RULE','abgeschaltet'];",
    "['PLAN',",
    " 'Menge'] => ['RULE','Wert'];",
  ].join('\n');

  it('finds only statements AFTER the FEEDERS keyword', () => {
    const a = parseFeederStatements(regeln);
    expect(a).toHaveLength(2);
  });

  it('reports the line in which the statement BEGINS', () => {
    // Jump target in the rule editor — for a multi-line statement, the first line.
    expect(parseFeederStatements(regeln).map((a) => a.line)).toEqual([4, 6]);
  });

  it('ueberspringt auskommentierte Anweisungen', () => {
    expect(parseFeederStatements(regeln).some((a) => a.text.includes('abgeschaltet'))).toBe(false);
  });

  it('without a FEEDERS section there is nothing', () => {
    expect(parseFeederStatements("['a'] => ['b'];")).toEqual([]);
  });

  it('splits two statements on one line', () => {
    const a = parseFeederStatements("FEEDERS;\n['a']=>['b']; ['c']=>['d'];");
    expect(a).toHaveLength(2);
  });
});

describe('hitsCell', () => {
  const eine = (text: string) => parseFeederStatements(`FEEDERS;\n${text}`)[0];

  it('matches when the target area fits', () => {
    const z = hitsCell(eine("['IST','Menge'] => ['RULE','Wert'];"),
      DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.hits).toBe(true);
  });

  it('does not match when the target area names a different data type', () => {
    const z = hitsCell(eine("['IST','Menge'] => ['IST','Wert'];"),
      DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.hits).toBe(false);
  });

  // Whatever the target area does NOT name, the fed cell takes over
  // unchanged from the source. So the source has to be checked as well —
  // otherwise every statement with a fitting target counts as a match.
  it('checks the source for dimensions that the target does not name', () => {
    const a = eine("['Positionen':'5151','Menge'] => ['RULE','Wert'];");
    expect(hitsCell(a, DIMS, ['RULE', '5151', 'Wert'], WISSEN).hits).toBe(true);
    expect(hitsCell(a, DIMS, ['RULE', '5204', 'Wert'], WISSEN).hits).toBe(false);
  });

  // Cut 2: a range on a consolidation also feeds its leaves.
  it('resolves a consolidation in the target area', () => {
    const z = hitsCell(eine("['IST','Menge'] => ['RULE','Positionen':'SubTurnover','Wert'];"),
      DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.hits).toBe(true);
  });

  it('resolves a consolidation in the source area as well', () => {
    const z = hitsCell(eine("['IST','Positionen':'SubTurnover','Menge'] => ['RULE','Wert'];"),
      DIMS, ['RULE', '5151', 'Wert'], WISSEN);
    expect(z.hits).toBe(true);
  });

  it('a set matches each of its elements', () => {
    const a = eine("['Datenarten':{'PLAN','VORSCHAU'},'Menge'] => ['Wert'];");
    expect(hitsCell(a, DIMS, ['PLAN', '5204', 'Wert'], WISSEN).hits).toBe(true);
    expect(hitsCell(a, DIMS, ['IST', '5204', 'Wert'], WISSEN).hits).toBe(false);
  });

  it('an uninterpretable term makes the statement undecidable', () => {
    const z = hitsCell(eine("[ATTRS('a','b','c')] => ['RULE','Wert'];"),
      DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.hits).toBeUndefined();
    expect(z.reason).toEqual({ kind: 'termNichtDeutbar', value: "ATTRS('a','b','c')" });
  });

  it('an unknown element is undecidable, not "does not match"', () => {
    const z = hitsCell(eine("['GibtsNicht'] => ['RULE','Wert'];"),
      DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.hits).toBeUndefined();
  });

  // A feeder may point into a different cube; then it says nothing about our
  // cell and must not appear as a match.
  it('a target in a foreign dimension is not a match', () => {
    const z = hitsCell(eine("['IST'] => ['Fremd':'x'];"), DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.hits).toBeUndefined();
  });
});

describe('matchesFor', () => {
  const regeln = [
    'FEEDERS;',
    "['IST','Menge'] => ['RULE','Wert'];",
    "['PLAN','Menge'] => ['RULE','Positionen':'SubTurnover','Wert'];",
    "['IST','Menge'] => ['IST','Wert'];",
  ].join('\n');

  // Several matches are the normal case, not the exception: the same
  // target area is often fed from several sources.
  it('returns all matching statements', () => {
    const z = matchesFor(parseFeederStatements(regeln), DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.filter((x) => x.hits === true)).toHaveLength(2);
  });

  it('leaves out statements that are certainly excluded', () => {
    const z = matchesFor(parseFeederStatements(regeln), DIMS, ['RULE', '5204', 'Wert'], WISSEN);
    expect(z.some((x) => x.statement.text.includes("['IST','Wert']"))).toBe(false);
  });
});

describe('Gross-/Kleinschreibung (TM1 vergleicht Namen unempfindlich)', () => {
  // Found live, not at the desk: the rule writes 'RULE', the element
  // is called 'Rule'. With strict comparison, NOT A SINGLE statement got through
  // on the real cube — three out of three counted as "not decidable".
  it('sameName ignores case and surrounding whitespace', () => {
    expect(sameName('RULE', 'Rule')).toBe(true);
    expect(sameName(' Rule ', 'rule')).toBe(true);
    expect(sameName('Rule', 'Rules')).toBe(false);
  });

  it('normName is the one place for that', () => {
    expect(normName(' PLAN ')).toBe('plan');
  });

  it('a target area in upper case matches the cell', () => {
    const a = parseFeederStatements("FEEDERS;\n['IST','Menge'] => ['RULE','Wert'];")[0];
    expect(hitsCell(a, DIMS, ['Rule', '5204', 'Wert'], WISSEN).hits).toBe(true);
  });

  it('the dimension name may also be spelled differently', () => {
    const a = parseFeederStatements("FEEDERS;\n['IST'] => ['DATENARTEN':'RULE'];")[0];
    expect(hitsCell(a, DIMS, ['Rule', '5204', 'Wert'], WISSEN).hits).toBe(true);
  });
});

describe('set with the dimension name inside', () => {
  // Second form from the real customer cube:
  //   {'TurnoverTypes': 'AAA-BBB', 'BBB-AAA', 'AB-CD-EF', …}
  // The dimension name stands INSIDE the braces and applies to the whole
  // set. Without this form, two out of three statements dropped out as "not interpretable"
  // — the matching returned zero matches where there was one.
  it('interprets the dimension name before the colon', () => {
    expect(parseArea("[{'Datenarten': 'PLAN', 'VORSCHAU'}]")?.terms).toEqual([
      { dimension: 'Datenarten', elements: ['PLAN', 'VORSCHAU'] },
    ]);
  });

  it('matches every element of the set', () => {
    const a = parseFeederStatements(
      "FEEDERS;\n[{'Datenarten': 'PLAN', 'VORSCHAU'},'Menge'] => ['Wert'];")[0];
    expect(hitsCell(a, DIMS, ['VORSCHAU', '5204', 'Wert'], WISSEN).hits).toBe(true);
    expect(hitsCell(a, DIMS, ['IST', '5204', 'Wert'], WISSEN).hits).toBe(false);
  });

  it('a set without a dimension name stays unqualified', () => {
    expect(parseArea("[{'PLAN','VORSCHAU'}]")?.terms).toEqual([
      { dimension: undefined, elements: ['PLAN', 'VORSCHAU'] },
    ]);
  });

  it('an expression in the set makes it undecidable, not narrower', () => {
    expect(parseArea("[{'Datenarten': 'PLAN', DIMNM('D',1)}]")?.terms[0].elements).toEqual([]);
  });
});
