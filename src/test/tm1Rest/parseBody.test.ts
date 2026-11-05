import { describe, it, expect } from 'vitest';
import { parseODataValueBodyBigIntIds } from '../../tm1Rest/parseRest';
import { parseBody, parseBodySafe, parseEnvelopeBody, parseODataValueBody, odataErrorMessage, errorBodyDetail } from '../../tm1Rest/parseRest';
import type { ODataCellset, ODataAxis, ODataCell, ODataError } from '../../tm1Rest/odataTypes';

describe('parseBody', () => {
  it('returns an object deep-equal to JSON.parse(input.body)', () => {
    const input = { body: '{"Name":"Foo","Cardinality":3}' };
    const expected = JSON.parse(input.body);
    const result = parseBody<{ Name: string; Cardinality: number }>(input);
    expect(result).toEqual(expected);
  });

  it('releases res.body (sets to "") after a successful parse', () => {
    const res = { body: '{"a":1}' };
    parseBody<{ a: number }>(res);
    expect(res.body).toBe('');
  });

  it('throws SyntaxError on invalid JSON', () => {
    const res = { body: '{bad' };
    expect(() => parseBody(res)).toThrow(SyntaxError);
  });

  it('does NOT release res.body when parse throws (release-on-success only)', () => {
    const res = { body: '{bad' };
    try {
      parseBody(res);
    } catch {
      // expected
    }
    expect(res.body).toBe('{bad');
  });

  it('works against a structural ApiResponse-like object (statusCode + body)', () => {
    const res = { statusCode: 200, body: '{"value":[1,2,3]}' };
    const result = parseBody<{ value: number[] }>(res);
    expect(result.value).toEqual([1, 2, 3]);
    expect(res.body).toBe('');
  });

  it('ODataCellset/ODataAxis accept a realistic cellset fixture without any', () => {
    const fixture: ODataCellset = {
      Axes: [
        {
          Ordinal: 0,
          Cardinality: 2,
          Hierarchies: [{ Name: 'Version' }],
          Tuples: [
            { Members: [{ Name: 'Actual' }] },
            { Members: [{ Name: 'Budget' }] },
          ],
        },
        {
          Ordinal: 1,
          Cardinality: 1,
          Hierarchies: [{ Name: 'Account' }],
          Tuples: [{ Members: [{ Name: 'Revenue' }] }],
        },
      ],
      Cells: [
        { Ordinal: 0, Value: 100, FormattedValue: '100.00', Consolidated: false, RuleDerived: true, Updateable: true },
        { Ordinal: 1, Value: null, FormattedValue: '', Consolidated: true, RuleDerived: false, Updateable: false },
      ],
    };

    const colsAxis: ODataAxis | undefined = fixture.Axes?.[0];
    expect(colsAxis?.Tuples?.length).toBe(2);
    expect(colsAxis?.Tuples?.[0]?.Members?.[0]?.Name).toBe('Actual');
    expect(fixture.Axes?.[1]?.Hierarchies?.[0]?.Name).toBe('Account');

    const firstCell: ODataCell | undefined = fixture.Cells?.[0];
    expect(firstCell?.Value).toBe(100);
    expect(firstCell?.FormattedValue).toBe('100.00');
    expect(firstCell?.RuleDerived).toBe(true);

    // Round-trip through parseBody to prove ODataCellset is a valid JSON.parse target.
    const res = { body: JSON.stringify(fixture) };
    const parsed = parseBody<ODataCellset>(res);
    expect(parsed.Cells?.length).toBe(2);
    expect(parsed.Axes?.[0]?.Tuples?.[1]?.Members?.[0]?.Name).toBe('Budget');
    expect(res.body).toBe('');
  });
});

describe('parseBodySafe', () => {
  it('returns the parsed value and releases the body on valid JSON', () => {
    const res = { body: '{"a":1}' };
    const result = parseBodySafe<{ a: number }>(res, { a: -1 });
    expect(result).toEqual({ a: 1 });
    expect(res.body).toBe('');
  });

  it('returns the fallback (does NOT throw) on invalid JSON', () => {
    const res = { body: '{bad' };
    const fallback = { value: [] as number[] };
    const result = parseBodySafe(res, fallback);
    expect(result).toBe(fallback);
  });

  it('releases the body even when falling back on invalid JSON', () => {
    const res = { body: '{bad' };
    parseBodySafe(res, { value: [] as number[] });
    expect(res.body).toBe('');
  });
});

describe('parseEnvelopeBody', () => {
  it('returns the unwrapped value array and releases the body on valid JSON', () => {
    const res = { body: '{"value":[{"Name":"A"},{"Name":"B"}]}' };
    const result = parseEnvelopeBody<{ Name: string }>(res);
    expect(result).toEqual([{ Name: 'A' }, { Name: 'B' }]);
    expect(res.body).toBe('');
  });

  it('returns [] (tolerant fallback) on invalid JSON — does NOT throw', () => {
    const res = { body: '{bad' };
    const result = parseEnvelopeBody<{ Name: string }>(res);
    expect(result).toEqual([]);
  });

  it('releases the body even when falling back on invalid JSON', () => {
    const res = { body: '{bad' };
    parseEnvelopeBody<{ Name: string }>(res);
    expect(res.body).toBe('');
  });

  it('returns [] when the envelope has no `value` key, and still releases', () => {
    const res = { body: '{"@odata.context":"foo"}' };
    const result = parseEnvelopeBody<{ Name: string }>(res);
    expect(result).toEqual([]);
    expect(res.body).toBe('');
  });
});

describe('parseODataValueBody', () => {
  it('returns the unwrapped value array and releases the body on valid JSON', () => {
    const res = { body: '{"value":[{"Name":"X"}]}' };
    const result = parseODataValueBody<{ Name: string }>(res);
    expect(result).toEqual([{ Name: 'X' }]);
    expect(res.body).toBe('');
  });

  it('returns [] (tolerant fallback) on invalid JSON — does NOT throw', () => {
    const res = { body: '{bad' };
    const result = parseODataValueBody<{ Name: string }>(res);
    expect(result).toEqual([]);
  });

  it('releases the body even when falling back on invalid JSON', () => {
    const res = { body: '{bad' };
    parseODataValueBody<{ Name: string }>(res);
    expect(res.body).toBe('');
  });
});

describe('parseODataValueBodyBigIntIds', () => {
  it('preserves an Int64 ID exactly by quoting it before parse (v12 session id)', () => {
    const res = { body: '{"value":[{"ID":"job-guid","Session":{"ID":7652941458679222256}}]}' };
    const r = parseODataValueBodyBigIntIds<{ ID: string; Session: { ID: unknown } }>(res);
    // Plain JSON.parse would round this to 7652941458679222000 — must stay exact.
    expect(r[0].Session.ID).toBe('7652941458679222256');
    expect(r[0].ID).toBe('job-guid');   // already-quoted GUID id untouched
    expect(res.body).toBe('');
  });

  it('leaves safe (<16 digit) numeric IDs as numbers', () => {
    const res = { body: '{"value":[{"ID":115}]}' };
    const r = parseODataValueBodyBigIntIds<{ ID: unknown }>(res);
    expect(r[0].ID).toBe(115);
  });

  it('returns [] on invalid JSON and releases the body', () => {
    const res = { body: '{bad' };
    expect(parseODataValueBodyBigIntIds(res)).toEqual([]);
    expect(res.body).toBe('');
  });
});

describe('odataErrorMessage', () => {
  it('extracts the string-shape message (security-api style)', () => {
    const e: ODataError = { error: { code: '123', message: 'bad mdx' } };
    expect(odataErrorMessage(e)).toBe('bad mdx');
  });

  it('extracts the nested {value} shape message (cubeApi.extractODataError style)', () => {
    const e: ODataError = { error: { message: { value: 'Storage order change rejected' } } };
    expect(odataErrorMessage(e)).toBe('Storage order change rejected');
  });

  it('returns undefined when error/message is absent', () => {
    expect(odataErrorMessage({})).toBeUndefined();
    expect(odataErrorMessage({ error: {} })).toBeUndefined();
  });

  it('returns undefined when message is an object without a string value', () => {
    const e: ODataError = { error: { message: { value: undefined } } };
    expect(odataErrorMessage(e)).toBeUndefined();
  });
});

describe('errorBodyDetail (review 2026-10-03, A9)', () => {
  it('reads the string and the { value } shape of error.message', () => {
    expect(errorBodyDetail('{"error":{"message":"boom"}}')).toBe('boom');
    expect(errorBodyDetail('{"error":{"message":{"value":"deep"}}}')).toBe('deep');
  });
  it('falls back to Message, then to the raw body', () => {
    expect(errorBodyDetail('{"Message":"m"}')).toBe('m');
    expect(errorBodyDetail('<html>503</html>')).toBe('<html>503</html>');
    expect(errorBodyDetail('{"x":1}')).toBe('{"x":1}');
  });
});
