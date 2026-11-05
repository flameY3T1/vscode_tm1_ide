/**
 * The WIRE FORM of view copying — what exactly goes out, and where to.
 *
 * Why this is worth a file of its own: `viewCopyApi.ts` is the layer in
 * which the live-measured TM1 quirks live, and every single one of them
 * fails SILENTLY when it is violated (docs/architecture/tm1-rest-quirks.md, "Overwriting a view",
 * "Complex-type expand"):
 *
 *  • Complex-type `$expand` works ONLY as a path (`Rows/Subset(...)`). The
 *    options form is HTTP 400 — and two read paths were already permanently
 *    wrong because of this once and silently fell back to empty values.
 *  • PATCH REPLACES the axes (unlike `Subsets/Elements` and
 *    `Chores/Tasks`, which append), but it CANNOT change the view TYPE:
 *    a wrong body answers HTTP 200 and changes nothing. Hence the
 *    type probe beforehand, and hence `@odata.type` is not sent along with the PATCH.
 *  • An axis is replaced as a WHOLE — a `Subset.Alias` that is not sent
 *    is dropped. So the complete axis has to go out.
 *  • A body without any axis is NEVER written: with PATCH that would be
 *    the silent emptying of the target view, with HTTP 200 and no way back.
 *
 * A test that only counts `apiRequest` sees none of this. That is why the
 * body itself is pinned down here.
 *
 * Both mock paths: `viewCopyApi` AND the real `cubeApi` underneath import
 * the transport directly from `tm1Rest/client` (`no-tm1client-in-deep-layers`
 * forbids them the facade). `cubeApi` is DELIBERATELY not mocked — it
 * builds the URL and the call, which is exactly what is to be proven here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../tm1Client', async () => ({
  apiRequest: vi.fn(),
  // The REAL `assertOk`: it decides whether an error status arrives as a message with
  // a name. A `vi.fn()` in this place would turn every 400 into a
  // silent success — the error path would then only appear to be tested.
  assertOk: (await vi.importActual<typeof import('../../tm1Rest/transport/http')>(
    '../../tm1Rest/transport/http',
  )).assertOk,
}));
vi.mock('../../tm1Rest/client', async () => await import('../../tm1Client'));

import { apiRequest } from '../../tm1Client';
import { readViewForCopy, writeViewCopy, type ViewCopySource } from '../../tm1Rest/viewCopyApi';
import type { Tm1Config } from '../../tm1Rest/transport/types';

const CFG = { serverUrl: 'https://x', username: 'u', password: 'p', authType: 'basic' } as unknown as Tm1Config;

const req = vi.mocked(apiRequest);

beforeEach(() => { req.mockReset(); });

/** A response with `@odata.type`, as the type probe reads it. */
function probe(type: string | null, statusCode = 200) {
  return { statusCode, body: type === null ? '{}' : JSON.stringify({ '@odata.type': type }) };
}

const NATIVE = '#ibm.tm1.api.v1.NativeView';
const MDXVIEW = '#ibm.tm1.api.v1.MDXView';

/** A read NativeView with all three axis forms. */
const ROH_VIEW = {
  Name: 'Alt',
  Rows: [{
    Subset: {
      Name: 'Top10',
      Hierarchy: { Name: 'Region', Dimension: { Name: 'Region' } },
    },
  }],
  Columns: [{
    Subset: {
      Expression: '{[Monat].[Monat].Members}',
      Alias: 'Kurz',
      Hierarchy: { Name: 'Monat', Dimension: { Name: 'Monat' } },
    },
  }],
  Titles: [{
    Subset: {
      Hierarchy: { Name: 'Version', Dimension: { Name: 'Version' } },
      Elements: [{ Name: 'Ist' }, { Name: 'Plan' }],
    },
    Selected: { Name: 'Plan' },
  }],
  SuppressEmptyRows: true,
  SuppressEmptyColumns: false,
};

/** The arguments of the n-th `apiRequest` call, named. */
function aufruf(n: number) {
  const [method, url, body] = req.mock.calls[n];
  return { method, url, body: body === undefined ? undefined : JSON.parse(body) as Record<string, unknown> };
}

// ── Lesen ──────────────────────────────────────────────────────────────────

describe('readViewForCopy — read path and path form of the $expand', () => {
  it('probes the type first and reads the axes ONLY in the path form', async () => {
    req.mockResolvedValueOnce(probe(NATIVE))
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(ROH_VIEW) });

    const src = await readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu');

    expect(src?.kind).toBe('native');
    expect(req).toHaveBeenCalledTimes(2);

    // 1. The type probe — cheap, only `$select=Name`.
    expect(aufruf(0).method).toBe('GET');
    expect(aufruf(0).url).toBe("Cubes('Umsatz')/Views('Alt')?$select=Name");

    // 2. The axis read path. `Rows/Subset(...)` — the PATH FORM. The
    //    options form `Rows($expand=Subset(...))` is HTTP 400 live
    //    ("Expecting '/' after property of complex type in expand path").
    const lese = aufruf(1).url;
    for (const achse of ['Rows', 'Columns', 'Titles']) {
      expect(lese).toContain(
        `${achse}/Subset($select=Name,Expression,Alias;`
        + '$expand=Hierarchy($select=Name;$expand=Dimension($select=Name)),Elements($select=Name))',
      );
      // The counter-proof: the rejected options form must NOT appear.
      expect(lese).not.toContain(`${achse}($expand=`);
    }
    // Alias and elements have to be read along — otherwise exactly what the PATCH
    // replaces as a whole is dropped when writing.
    expect(lese).toContain('$select=Name,Expression,Alias');
    expect(lese).toContain('Elements($select=Name)');
  });

  it('reads a private view from PrivateViews, including the type probe', async () => {
    req.mockResolvedValueOnce(probe(NATIVE))
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(ROH_VIEW) });

    await readViewForCopy(CFG, 'Umsatz', 'Alt', true, 'Neu');

    expect(aufruf(0).url).toContain("/PrivateViews('Alt')");
    expect(aufruf(1).url).toContain("/PrivateViews('Alt')");
  });

  it('doubles the apostrophe in the OData key', async () => {
    req.mockResolvedValueOnce(probe(NATIVE))
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(ROH_VIEW) });

    await readViewForCopy(CFG, "O'Brien", "Q1'25", false, 'Neu');

    // `'` → `''`. `encodeURIComponent` leaves the apostrophe in place afterwards (it
    // is one of the unencoded characters) — so the doubling is the
    // entire measure, and it has to arrive visibly in the path.
    expect(aufruf(0).url).toBe("Cubes('O''Brien')/Views('Q1''25')?$select=Name");
  });

  it('fetches only the expression for an MDX view, not the axes', async () => {
    req.mockResolvedValueOnce(probe(MDXVIEW))
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify({ MDX: 'SELECT {} ON 0 FROM [Umsatz]' }) });

    const src = await readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu');

    expect(src).toEqual({ kind: 'mdx', mdx: 'SELECT {} ON 0 FROM [Umsatz]' });
    expect(aufruf(1).url).toBe("Cubes('Umsatz')/Views('Alt')?$select=MDX");
  });

  it('reports an unknown type instead of reading something wrong', async () => {
    // `other` is passed through so that the caller can NAME it. A
    // second call here would be a guess.
    req.mockResolvedValueOnce(probe('#ibm.tm1.api.v1.SomethingElse'));

    expect(await readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu')).toEqual({ kind: 'other' });
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('returns null when the view does not exist', async () => {
    req.mockResolvedValueOnce({ statusCode: 404, body: '' });
    expect(await readViewForCopy(CFG, 'Umsatz', 'Weg', false, 'Neu')).toBeNull();
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('returns null when fetching the axes fails', async () => {
    req.mockResolvedValueOnce(probe(NATIVE)).mockResolvedValueOnce({ statusCode: 500, body: '' });
    expect(await readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu')).toBeNull();
  });

  it('returns null for an MDX view without an expression — an empty MDX is not a view', async () => {
    req.mockResolvedValueOnce(probe(MDXVIEW)).mockResolvedValueOnce({ statusCode: 200, body: '{}' });
    expect(await readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu')).toBeNull();
  });

  it('THROWS on broken JSON in the axes body instead of returning an empty plan', async () => {
    // STRICT (`parseBody`), not tolerant: a fallback to `{}` would yield three
    // EMPTY axes — and the PATCH replaces the axes. The target view would be
    // empty with HTTP 200, and TM1 knows no way back.
    req.mockResolvedValueOnce(probe(NATIVE)).mockResolvedValueOnce({ statusCode: 200, body: '{kaputt' });
    await expect(readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu')).rejects.toThrow();
  });
});

// ── Schreiben: anlegen ─────────────────────────────────────────────────────

describe('writeViewCopy — POST onto an empty slot', () => {
  async function leseQuelle(): Promise<ViewCopySource> {
    req.mockResolvedValueOnce(probe(NATIVE))
      .mockResolvedValueOnce({ statusCode: 200, body: JSON.stringify(ROH_VIEW) });
    const src = await readViewForCopy(CFG, 'Umsatz', 'Alt', false, 'Neu');
    req.mockReset();
    return src!;
  }

  it('posts the complete NativeView body into the Views collection', async () => {
    const src = await leseQuelle();
    req.mockResolvedValue({ statusCode: 201, body: '' });

    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, src, null);

    expect(req).toHaveBeenCalledTimes(1);
    const { method, url, body } = aufruf(0);
    expect(method).toBe('POST');
    expect(url).toBe("Cubes('Umsatz')/Views");
    expect(body).toEqual({
      // Without this marker the POST is 400 "Object in payload is not a
      // derived type of tm1.View" — even with an otherwise identical body.
      '@odata.type': NATIVE,
      Name: 'Neu',
      // Named subset = REFERENCE, not a copy. It survives the transport
      // unchanged (proven live) and has to exist on the other side.
      Rows: [{ 'Subset@odata.bind': "Dimensions('Region')/Hierarchies('Region')/Subsets('Top10')" }],
      // Anonymous subset with an expression: `Expression` + Alias. The alias is sent
      // along because the PATCH replaces the axis as a WHOLE.
      Columns: [{
        Subset: {
          'Hierarchy@odata.bind': "Dimensions('Monat')/Hierarchies('Monat')",
          Expression: '{[Monat].[Monat].Members}',
          Alias: 'Kurz',
        },
      }],
      // Title axis: element list + the explicit selection.
      Titles: [{
        Subset: {
          'Hierarchy@odata.bind': "Dimensions('Version')/Hierarchies('Version')",
          'Elements@odata.bind': [
            "Dimensions('Version')/Hierarchies('Version')/Elements('Ist')",
            "Dimensions('Version')/Hierarchies('Version')/Elements('Plan')",
          ],
          Alias: '',
        },
        'Selected@odata.bind': "Dimensions('Version')/Hierarchies('Version')/Elements('Plan')",
      }],
      SuppressEmptyRows: true,
      SuppressEmptyColumns: false,
    });
  });

  it('posts into PrivateViews when the copy is meant to be private', async () => {
    const src = await leseQuelle();
    req.mockResolvedValue({ statusCode: 201, body: '' });
    await writeViewCopy(CFG, 'Umsatz', 'Neu', true, src, null);
    expect(aufruf(0).url).toBe("Cubes('Umsatz')/PrivateViews");
  });

  it('posts an MDX view with its own type marker', async () => {
    req.mockResolvedValue({ statusCode: 201, body: '' });
    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, { kind: 'mdx', mdx: 'SELECT 1' }, null);
    expect(aufruf(0)).toMatchObject({
      method: 'POST',
      url: "Cubes('Umsatz')/Views",
      body: { '@odata.type': MDXVIEW, Name: 'Neu', MDX: 'SELECT 1' },
    });
  });

  it('passes the caller\'s message through to the error status', async () => {
    // The module is vscode-free — the localised text (including the view name)
    // comes from the caller, otherwise the most common case of all would lose it.
    req.mockResolvedValue({ statusCode: 400, body: JSON.stringify({ error: { message: 'no such cube' } }) });
    await expect(
      writeViewCopy(CFG, 'Umsatz', 'Neu', false, { kind: 'mdx', mdx: 'SELECT 1' }, null, 'Ansicht "Neu" ging nicht'),
    ).rejects.toThrow('Ansicht "Neu" ging nicht: HTTP 400: no such cube');
  });
});

// ── Schreiben: ueberschreiben ──────────────────────────────────────────────

describe('writeViewCopy — PATCH onto an existing view of the same type', () => {
  const PLAN_SRC: ViewCopySource = {
    kind: 'native',
    plan: {
      body: {
        '@odata.type': NATIVE,
        Name: 'Neu',
        Rows: [{ 'Subset@odata.bind': "Dimensions('Region')/Hierarchies('Region')/Subsets('Top10')" }],
        Columns: [],
        Titles: [],
        SuppressEmptyRows: false,
        SuppressEmptyColumns: false,
      },
      namedSubsets: [],
      oversized: [],
      unreadable: 0,
    },
  };

  it('patches the view itself and leaves @odata.type OUT', async () => {
    req.mockResolvedValue({ statusCode: 200, body: '' });

    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, PLAN_SRC, 'native');

    expect(req).toHaveBeenCalledTimes(1);
    const { method, url, body } = aufruf(0);
    expect(method).toBe('PATCH');
    expect(url).toBe("Cubes('Umsatz')/Views('Neu')");
    // The type marker is NOT sent along with the PATCH: a type change fails
    // silently with HTTP 200, and the marker belongs to the POST contract.
    expect(body).not.toHaveProperty('@odata.type');
    // `Name`, on the other hand, may stay in — TM1 ignores it here (no
    // rename trap as with `Processes`).
    expect(body).toMatchObject({
      Name: 'Neu',
      Rows: [{ 'Subset@odata.bind': "Dimensions('Region')/Hierarchies('Region')/Subsets('Top10')" }],
      SuppressEmptyRows: false,
    });
  });

  it('sends the axis as a WHOLE — the empty ones too, because PATCH replaces', async () => {
    req.mockResolvedValue({ statusCode: 200, body: '' });
    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, PLAN_SRC, 'native');
    // An omitted axis would stay as it is, a half-sent one would lose its
    // `Alias`. So both names have to be in the body.
    expect(Object.keys(aufruf(0).body!)).toEqual(
      expect.arrayContaining(['Rows', 'Columns', 'Titles']),
    );
  });

  it('patches PrivateViews for a private view', async () => {
    req.mockResolvedValue({ statusCode: 200, body: '' });
    await writeViewCopy(CFG, 'Umsatz', 'Neu', true, PLAN_SRC, 'native');
    expect(aufruf(0).url).toBe("Cubes('Umsatz')/PrivateViews('Neu')");
  });

  it('patches an MDX view without the type marker', async () => {
    req.mockResolvedValue({ statusCode: 200, body: '' });
    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, { kind: 'mdx', mdx: 'SELECT 1' }, 'mdx');
    const { method, body } = aufruf(0);
    expect(method).toBe('PATCH');
    expect(body).toEqual({ Name: 'Neu', MDX: 'SELECT 1' });
  });

  it('REFUSES the type change instead of attempting it', async () => {
    // Live: a NativeView body against an MDX view answers HTTP 200 and
    // changes NOTHING; the other way round creates a hybrid. An attempt would therefore be
    // a silent failure — hence no call at all.
    await expect(
      writeViewCopy(CFG, 'Umsatz', 'Neu', false, PLAN_SRC, 'mdx', 'Ansicht "Neu" hat drueben einen anderen Typ'),
    ).rejects.toThrow('Ansicht "Neu" hat drueben einen anderen Typ');
    expect(req).not.toHaveBeenCalled();
  });
});

// ── The bolt against the empty body ─────────────────────────────────────

describe('writeViewCopy — a body without an axis is NEVER written', () => {
  const LEER: ViewCopySource = {
    kind: 'native',
    plan: {
      body: { '@odata.type': NATIVE, Name: 'Neu', Rows: [], Columns: [], Titles: [] },
      namedSubsets: [], oversized: [], unreadable: 3,
    },
  };

  it('throws when all three axes are empty — and calls nothing', async () => {
    // With PATCH, TM1 replaces the axes. Three empty axes are therefore not
    // "change nothing", but the emptying of the target view — with HTTP 200 and
    // no way back. Better to fail with a name.
    await expect(writeViewCopy(CFG, 'Umsatz', 'Neu', false, LEER, 'native'))
      .rejects.toThrow(/no readable axes/);
    expect(req).not.toHaveBeenCalled();
  });

  it('throws on CREATE too, not only on overwrite', async () => {
    // A NativeView without any axis does not exist in TM1 — the POST even
    // requires EVERY cube dimension on an axis. Such a body is always
    // a read error, never an intention.
    await expect(writeViewCopy(CFG, 'Umsatz', 'Neu', false, LEER, null)).rejects.toThrow();
    expect(req).not.toHaveBeenCalled();
  });

  it('throws when there is no plan at all', async () => {
    await expect(writeViewCopy(CFG, 'Umsatz', 'Neu', false, { kind: 'native' }, null)).rejects.toThrow();
    expect(req).not.toHaveBeenCalled();
  });

  it('takes the caller\'s message when it supplies one', async () => {
    await expect(
      writeViewCopy(CFG, 'Umsatz', 'Neu', false, LEER, null, 'anderer Fehler', 'Ansicht "Neu" hatte keine Achsen'),
    ).rejects.toThrow('Ansicht "Neu" hatte keine Achsen');
  });

  it('a SINGLE filled axis is enough — the bolt is not a completeness test', async () => {
    req.mockResolvedValue({ statusCode: 200, body: '' });
    const nurTitel: ViewCopySource = {
      kind: 'native',
      plan: {
        body: { '@odata.type': NATIVE, Name: 'Neu', Rows: [], Columns: [], Titles: [{ x: 1 }] },
        namedSubsets: [], oversized: [], unreadable: 0,
      },
    };
    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, nurTitel, null);
    expect(req).toHaveBeenCalledTimes(1);
  });

  it('an MDX view does NOT fall under the axis bolt', async () => {
    req.mockResolvedValue({ statusCode: 200, body: '' });
    await writeViewCopy(CFG, 'Umsatz', 'Neu', false, { kind: 'mdx', mdx: 'SELECT 1' }, null);
    expect(req).toHaveBeenCalledTimes(1);
  });
});
