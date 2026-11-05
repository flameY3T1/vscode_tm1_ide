import { describe, it, expect } from 'vitest';
import { parseSetAnswer, SET_EXPR_QUERY, PARENT_NEST_DEPTH } from '../tm1Rest/dimensionSetQueryPure';
import { rowsFromAnswer } from '../webviewClient/dimensionBrowser/rowsFromAnswer';
import { initialView, pushIntent } from '../webviewClient/dimensionBrowser/intents';

/**
 * Raw answer from the live measurements of 2026-08-21 (dimension `aa`):
 * `DisplayInfo` and `Parent` from setExprDisplayInfoProbe.js,
 * `Element(Type,Level)` from setExprMemberShapeProbe.js (run B).
 * Every value is measured; they are assembled into ONE answer here.
 * NOT invented — the design requires fixtures from real probes.
 */
const ANTWORT = {
  // 4, not 10 — the fixture carries exactly four tuples. The value is not
  // asserted here, but it was a misleading leftover from a larger
  // live answer.
  Cardinality: 4,
  Tuples: [
    { Members: [{ Name: 'sum', UniqueName: '[aa].[aa].[sum]', DisplayInfo: 65536, Parent: null, Element: { Type: 'Consolidated', Level: 1 } }] },
    { Members: [{ Name: 'a', UniqueName: '[aa].[aa].[sum^a]', DisplayInfo: 257, Parent: { Name: 'sum' }, Element: { Type: 'Numeric', Level: 0 } }] },
    { Members: [{ Name: 'd', UniqueName: '[aa].[aa].[d]', DisplayInfo: 65536, Parent: null, Element: { Type: 'Consolidated', Level: 1 } }] },
    { Members: [{ Name: 'c', UniqueName: '[aa].[aa].[c]', DisplayInfo: 262401, Parent: { Name: 'd' }, Element: { Type: 'Numeric', Level: 0 } }] },
  ],
};

describe('parseSetAnswer', () => {
  it('reads name, type, level, parent and expand state', () => {
    expect(parseSetAnswer(ANTWORT)).toEqual([
      { name: 'sum', type: 'C', level: 1, parent: null, drilled: true, caption: 'sum', ancestors: [] },
      {
        name: 'a', type: 'N', level: 0, parent: 'sum', drilled: false, caption: 'a',
        // `Parent` carries no `Element` here (the fixture is the 'name' request) —
        // that is why type/level fall back to 'N'/0, not to those of `sum`.
        ancestors: [{ name: 'sum', type: 'N', level: 0 }],
      },
      { name: 'd', type: 'C', level: 1, parent: null, drilled: true, caption: 'd', ancestors: [] },
      {
        name: 'c', type: 'N', level: 0, parent: 'd', drilled: false, caption: 'c',
        ancestors: [{ name: 'd', type: 'N', level: 0 }],
      },
    ]);
  });

  // Shape UNVERIFIED, see design (task-5-brief.md, point "whether Attributes.Caption
  // holds against a dimension with real alias attributes") — this test
  // only proves the MAPPING `Attributes.Caption → caption`, not that the
  // server actually fills this field that way under real alias attributes.
  it('maps a set `Attributes.Caption` to `caption` when it differs from the name', () => {
    const mitAlias = { Cardinality: 1, Tuples: [{ Members: [{
      Name: 'a', UniqueName: '[aa].[aa].[a]', DisplayInfo: 0, Parent: null,
      Element: { Type: 'Numeric', Level: 0 }, Attributes: { Caption: 'Alpha' },
    }] }] };
    expect(parseSetAnswer(mitAlias)[0].caption).toBe('Alpha');
  });

  it('survives an answer without Tuples', () => {
    expect(parseSetAnswer({})).toEqual([]);
  });

  it('queries parent, expand state, type, level, caption and cardinality', () => {
    expect(SET_EXPR_QUERY).toContain('DisplayInfo');
    expect(SET_EXPR_QUERY).toContain('Parent($select=Name)');
    expect(SET_EXPR_QUERY).toContain('Element($select=Type,Level)');
    // `Attributes` carries `Caption` — without the `$select`, `parseSetAnswer` would
    // never read anything other than the name there.
    expect(SET_EXPR_QUERY).toContain('Attributes');
    // `$select=Cardinality` is the basis for `fetchViewRows#cardinality` —
    // without the select, the field is missing from the answer entirely.
    expect(SET_EXPR_QUERY).toContain('$select=Cardinality');
  });
});

/**
 * Fixture values from setExprDepthSourceProbe.js. `d`/`a` come
 * from dimension `aa` (`{[aa].[aa].Members}`); the `S00101` row, by contrast, comes from
 * a window in the middle of `AllocStations` (review finding M3 — the
 * header comment previously wrongly attributed EVERYTHING to dimension `aa`). Its
 * `UniqueName` is invented, without consequence: `parseSetAnswer` does not read it.
 */
const MIT_KETTE = {
  Cardinality: 3,
  Tuples: [
    { Members: [{
      Name: 'd', UniqueName: '[aa].[aa].[d]', DisplayInfo: 65536,
      Parent: null, Element: { Type: 'Consolidated', Level: 1 },
    }] },
    { Members: [{
      Name: 'a', UniqueName: '[aa].[aa].[d^a]', DisplayInfo: 393473,
      Parent: { Name: 'd', Parent: null }, Element: { Type: 'Numeric', Level: 0 },
    }] },
    { Members: [{
      // From the deep window (`SUBSET(.Members, 500, 12)`, row 0):
      // S00101 < SITE2022_S00101_C < SITE2022_extern_C < SITE2022_SuAlloc_Group_C
      Name: 'S00101', UniqueName: '[aa].[aa].[S00101]', DisplayInfo: 257,
      Parent: { Name: 'SITE2022_S00101_C', Parent: { Name: 'SITE2022_extern_C', Parent: { Name: 'SITE2022_SuAlloc_Group_C', Parent: null } } },
      Element: { Type: 'Numeric', Level: 0 },
    }] },
  ],
};

describe('parseSetAnswer: ancestor chain', () => {
  it('reads the chain from the root downwards, without the row itself', () => {
    const rows = parseSetAnswer(MIT_KETTE);
    expect(rows[0].ancestors).toEqual([]);
    // No `Element` on the ancestors in this fixture ('name' request) —
    // type/level therefore fall back to 'N'/0.
    expect(rows[1].ancestors).toEqual([{ name: 'd', type: 'N', level: 0 }]);
    expect(rows[2].ancestors).toEqual([
      { name: 'SITE2022_SuAlloc_Group_C', type: 'N', level: 0 },
      { name: 'SITE2022_extern_C', type: 'N', level: 0 },
      { name: 'SITE2022_S00101_C', type: 'N', level: 0 },
    ]);
  });

  it('`parent` stays the DIRECT parent and matches the end of the chain', () => {
    const rows = parseSetAnswer(MIT_KETTE);
    expect(rows[2].parent).toBe('SITE2022_S00101_C');
    expect(rows[2].ancestors[rows[2].ancestors.length - 1].name).toBe(rows[2].parent);
  });

  it('cuts off a cyclic chain instead of hanging', () => {
    // A broken hierarchy can carry a cycle. The chain is capped at
    // PARENT_NEST_DEPTH — the server does not deliver more anyway.
    const zyklus: { Name: string; Parent?: unknown } = { Name: 'p' };
    zyklus.Parent = zyklus;
    const rows = parseSetAnswer({ Tuples: [{ Members: [{ Name: 'x', DisplayInfo: 0, Parent: zyklus }] }] } as never);
    // Exact, not `<=` (review finding M2): the old form would also let 0 through
    // and would thus prove nothing at all about the cap — the cycle MUST
    // exhaust the full depth, because every level is a hit.
    expect(rows[0].ancestors.length).toBe(PARENT_NEST_DEPTH);
  });

  it('queries the chain deep enough', () => {
    // Nesting deeply costs nothing (measured live: 81 ms at 20 levels,
    // exactly as with one). So be generous, so that no real hierarchy
    // gets cut off.
    expect(PARENT_NEST_DEPTH).toBeGreaterThanOrEqual(20);
    const tiefen = SET_EXPR_QUERY.split('Parent(').length - 1;
    expect(tiefen).toBe(PARENT_NEST_DEPTH);
  });

  it('warns when the parent chain is truncated', () => {
    // Measured live (2026-08-21, parentNestTruncationProbe.js):
    // when nesting is exhausted, TM1 OMITS the `Parent` field; at a
    // real root it says `Parent: null`. The distinction hinges on exactly that.
    // A real hierarchy is not needed for this — `parseSetAnswer` receives
    // an already parsed object.
    //
    // Chain length = PARENT_NEST_DEPTH, NOT PARENT_NEST_DEPTH+1: the deepest
    // link (`l1`, by construction the first one here) carries no `Parent`
    // field at all — this reproduces that the server did not expand any further there.
    // An additional link below it would make `up` end after the loop on an
    // (parentless, but present) object instead of on `undefined`,
    // and would thus miss the warning — re-measured with `node` against the real
    // function before the test was written here.
    let tief: Record<string, unknown> = { Name: 'l1' }; // deepest link WITHOUT `Parent`
    for (let i = 2; i <= PARENT_NEST_DEPTH; i++) { tief = { Name: `l${i}`, Parent: tief }; }
    const warns: unknown[][] = [];
    const alt = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a); };
    try {
      parseSetAnswer({ Tuples: [{ Members: [{ Name: 'x', DisplayInfo: 0, Parent: tief }] }] } as never);
    } finally { console.warn = alt; }
    expect(warns).toHaveLength(1);
    expect(String(warns[0].join(' '))).toContain('x');
  });

  it('does NOT warn when the chain ends at a real root', () => {
    const wurzel = { Name: 'r', Parent: null };
    const warns: unknown[][] = [];
    const alt = console.warn;
    console.warn = (...a: unknown[]) => { warns.push(a); };
    try {
      parseSetAnswer({ Tuples: [{ Members: [{ Name: 'x', DisplayInfo: 0, Parent: wurzel }] }] } as never);
    } finally { console.warn = alt; }
    expect(warns).toEqual([]);
  });
});

/**
 * The set can represent parent-child — `DRILLDOWNMEMBER` pushes the children
 * behind the parent. But because `TM1SUBSETALL` already carries every element,
 * the child then appears TWICE: once at its index position, once
 * under the parent (measured live 2026-08-22,
 * dimSubsetallDrillDownProbe.js — 8 rows become 9).
 * Both copies name the same parent chain; only the one that actually
 * stands BEHIND its parent should be indented.
 */
describe('indentation on the set follows the position, not the chain', () => {
  const z = (name: string, parent: string | null, drilled = false) => ({
    name, caption: name, type: (drilled ? 'C' : 'N') as 'N' | 'C' | 'S',
    level: drilled ? 1 : 0, parent, drilled,
    ancestors: parent ? [{ name: parent, type: 'C' as const, level: 1 }] : [],
  });

  it('leaves the index copy flat and indents only the expanded one', () => {
    // Exactly the measured answer of
    // {DRILLDOWNMEMBER({TM1SUBSETALL([aa].[aa])}, {[aa].[aa].[sum]})}
    const antwort = [
      z('a', 'sum'), z('b', 'd'), z('sum', null, true), z('a', 'sum'),
      z('c', 'd'), z('d', null), z('xxx', null, true), z('xx', 'xxx'), z('x', 'xxx'),
    ];
    const v = pushIntent(initialView('set'), { kind: 'expand', member: 'sum' });
    const tiefen = rowsFromAnswer(antwort, v).map((r) => r.depth);
    //             a  b  sum  a  c  d  xxx  xx  x
    expect(tiefen).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 1]);
  });

  it('without expanding, the set stays flat', () => {
    const antwort = [z('a', 'sum'), z('b', 'd'), z('sum', null), z('d', null)];
    const tiefen = rowsFromAnswer(antwort, initialView('set')).map((r) => r.depth);
    expect(tiefen).toEqual([0, 0, 0, 0]);
  });
});
