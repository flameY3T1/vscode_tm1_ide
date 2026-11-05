import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listPublicSubsetNames, listPrivateSubsetNames,
  listPublicSubsetInfos, listPrivateSubsetInfos, listSubsetInfos, getSubset,
  subsetExists, deleteSubset, createSubset, updateSubset, clearSubsetElements, subsetElementCount,
  listSubsetsWithElements, listSubsetElementNames,
} from '../../tm1Rest/subsetApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, readBody, type FakeTm1 } from '../__mocks__/fakeTm1Server';

describe('subsetApi', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('listPublicSubsetNames', () => {
    it('GETs Dimensions/Hierarchies/Subsets$select=Name and maps to names', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'S1' }, { Name: 'S2' }] });
      });
      const out = await listPublicSubsetNames(fakeConfig(fake.url), 'Dim', 'Hier');
      expect(observedUrl).toContain("Dimensions('Dim')/Hierarchies('Hier')/Subsets");
      expect(observedUrl).toContain('$select=Name');
      expect(out).toEqual(['S1', 'S2']);
    });

    it('defaults hier to dim', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listPublicSubsetNames(fakeConfig(fake.url), 'Dim');
      expect(observedUrl).toContain("Dimensions('Dim')/Hierarchies('Dim')");
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('err');
      });
      const out = await listPublicSubsetNames(fakeConfig(fake.url), 'Dim');
      expect(out).toEqual([]);
    });
  });

  describe('listPrivateSubsetNames', () => {
    it('GETs PrivateSubsets and maps to names', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'P1' }] });
      });
      const out = await listPrivateSubsetNames(fakeConfig(fake.url), 'D', 'H');
      expect(observedUrl).toContain('/PrivateSubsets');
      expect(out).toEqual(['P1']);
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 403;
        res.end('forbidden');
      });
      expect(await listPrivateSubsetNames(fakeConfig(fake.url), 'D')).toEqual([]);
    });
  });

  // ── Dynamic (MDX-driven) subsets ────────────────────────────────────────
  // A subset is DYNAMIC when TM1 resolves its members from `Expression`
  // instead of a stored `Elements` collection. `Expression` is a plain string
  // property, so it must be $select'ed — a Complex Type would need $expand,
  // which TM1 rejects here.
  describe('subset listings — dynamic flag', () => {
    it('listPublicSubsetInfos $selects Name,Expression and flags non-empty ones', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, {
          value: [
            { Name: 'Dyn', Expression: '{TM1SUBSETALL([Dim])}' },
            { Name: 'Static', Expression: null },
          ],
        });
      });
      const out = await listPublicSubsetInfos(fakeConfig(fake.url), 'Dim', 'Hier');
      expect(observedUrl).toContain("Dimensions('Dim')/Hierarchies('Hier')/Subsets");
      expect(observedUrl).toContain('$select=Name,Expression');
      expect(observedUrl).not.toContain('$expand');
      expect(out).toEqual([
        { name: 'Dyn', isDynamic: true },
        { name: 'Static', isDynamic: false },
      ]);
    });

    it('treats a whitespace-only Expression as static', async () => {
      fake = await startFakeTm1((_req, res) =>
        jsonResponse(res, 200, { value: [{ Name: 'Blank', Expression: '   ' }] }));
      expect(await listPublicSubsetInfos(fakeConfig(fake.url), 'D'))
        .toEqual([{ name: 'Blank', isDynamic: false }]);
    });

    it('listPrivateSubsetInfos queries the PrivateSubsets collection', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'Mine', Expression: '{[D].Members}' }] });
      });
      const out = await listPrivateSubsetInfos(fakeConfig(fake.url), 'D', 'H');
      expect(observedUrl).toContain('/PrivateSubsets');
      expect(observedUrl).toContain('$select=Name,Expression');
      expect(out).toEqual([{ name: 'Mine', isDynamic: true }]);
    });

    it('listSubsetInfos combines both collections with their flags', async () => {
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        if (url.includes('PrivateSubsets')) {
          jsonResponse(res, 200, { value: [{ Name: 'P1', Expression: '{X}' }] });
        } else {
          jsonResponse(res, 200, { value: [{ Name: 'S1', Expression: null }] });
        }
      });
      expect(await listSubsetInfos(fakeConfig(fake.url), 'D', 'H')).toEqual({
        pub: [{ name: 'S1', isDynamic: false }],
        priv: [{ name: 'P1', isDynamic: true }],
      });
    });

    // A server that rejects the `Expression` projection used to make every
    // subset disappear from the tree — no error node, no log line — although the
    // name-only query listed them fine. `PrivateSubsets?$select=Name,Expression`
    // answered 200 on all 340 hierarchies probed on 11.8, but the tree issues it
    // for both collections on every dimension, so the rejection path has to
    // degrade rather than blank out.
    it('listPrivateSubsetInfos falls back to the names-only listing when the projection is rejected', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        urls.push(url);
        if (url.includes('Expression')) {
          res.statusCode = 400;
          res.end('{"error":{"message":"projection not supported"}}');
          return;
        }
        jsonResponse(res, 200, { value: [{ Name: 'P1' }, { Name: 'P2' }] });
      });
      const out = await listPrivateSubsetInfos(fakeConfig(fake.url), 'D', 'H');
      expect(out).toEqual([
        { name: 'P1', isDynamic: false },
        { name: 'P2', isDynamic: false },
      ]);
      expect(urls).toHaveLength(2);
      expect(urls[0]).toContain('$select=Name,Expression');
      expect(urls[1]).not.toContain('Expression');
    });

    it('listPublicSubsetInfos falls back the same way', async () => {
      fake = await startFakeTm1((req, res) => {
        if ((req.url ?? '').includes('Expression')) {
          res.statusCode = 501;
          res.end();
          return;
        }
        jsonResponse(res, 200, { value: [{ Name: 'S1' }] });
      });
      expect(await listPublicSubsetInfos(fakeConfig(fake.url), 'D'))
        .toEqual([{ name: 'S1', isDynamic: false }]);
    });

    it('listSubsetInfos keeps the tree populated when only PrivateSubsets rejects the projection', async () => {
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        if (url.includes('PrivateSubsets')) {
          if (url.includes('Expression')) { res.statusCode = 400; res.end(); return; }
          jsonResponse(res, 200, { value: [{ Name: 'P1' }] });
          return;
        }
        jsonResponse(res, 200, { value: [{ Name: 'S1', Expression: '{X}' }] });
      });
      expect(await listSubsetInfos(fakeConfig(fake.url), 'D', 'H')).toEqual({
        pub: [{ name: 'S1', isDynamic: true }],
        priv: [{ name: 'P1', isDynamic: false }],
      });
    });

    it('still returns [] when BOTH the projection and the names-only listing fail', async () => {
      fake = await startFakeTm1((_req, res) => { res.statusCode = 500; res.end(); });
      expect(await listPrivateSubsetInfos(fakeConfig(fake.url), 'D')).toEqual([]);
    });

    it('an empty collection is not mistaken for a rejection (no second request)', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        jsonResponse(res, 200, { value: [] });
      });
      expect(await listPrivateSubsetInfos(fakeConfig(fake.url), 'D')).toEqual([]);
      expect(urls).toHaveLength(1);
    });

    it('listPublicSubsetNames stays on $select=Name — name-only callers do not pay for MDX', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'S1' }, { Name: 'S2' }] });
      });
      expect(await listPublicSubsetNames(fakeConfig(fake.url), 'D')).toEqual(['S1', 'S2']);
      expect(observedUrl).toContain('$select=Name&');
      expect(observedUrl).not.toContain('Expression');
    });

    it('escapes a single quote in the dimension/hierarchy key (OData: \' → \'\')', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listPublicSubsetInfos(fakeConfig(fake.url), "Bob's Dim", "Bob's Hier");
      // `encodeURIComponent` leaves `'` alone, so the doubled quote stays literal.
      expect(observedUrl).toContain("Dimensions('Bob''s%20Dim')");
      expect(observedUrl).toContain("Hierarchies('Bob''s%20Hier')");
    });
  });

  describe('getSubset', () => {
    it('$selects Name,Expression,Alias on the public collection', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: 'Dyn', Expression: '{TM1SUBSETALL([D])}', Alias: 'German' });
      });
      const out = await getSubset(fakeConfig(fake.url), 'D', 'H', 'Dyn', false);
      expect(observedUrl).toContain("/Subsets('Dyn')?$select=Name,Expression,Alias");
      expect(out).toEqual({ ok: true, Name: 'Dyn', Expression: '{TM1SUBSETALL([D])}', Alias: 'German' });
    });

    it('reports a subset without a display alias as Alias null', async () => {
      fake = await startFakeTm1((_req, res) => jsonResponse(res, 200, { Name: 'S', Expression: null, Alias: '' }));
      expect(await getSubset(fakeConfig(fake.url), 'D', 'H', 'S', false))
        .toEqual({ ok: true, Name: 'S', Expression: null, Alias: null });
    });

    // `Alias` is absent from the Subset EntityType in 11.8's $metadata — it only
    // answers to an explicit $select. A server that rejects the projection must
    // not take the Expression down with it, or every subset would look static.
    it('falls back to Name,Expression when the server rejects the Alias projection', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        if ((req.url ?? '').includes('Alias')) { return jsonResponse(res, 400, { error: 'bad property' }); }
        jsonResponse(res, 200, { Name: 'Dyn', Expression: '{TM1SUBSETALL([D])}' });
      });
      const out = await getSubset(fakeConfig(fake.url), 'D', 'H', 'Dyn', false);
      expect(urls[0]).toContain('$select=Name,Expression,Alias');
      expect(urls[1]).toContain('$select=Name,Expression');
      expect(urls[1]).not.toContain('Alias');
      expect(out).toEqual({ ok: true, Name: 'Dyn', Expression: '{TM1SUBSETALL([D])}', Alias: null });
    });

    // Not every server turns an unknown property into a 400: gateways and older
    // builds answer 501 (not implemented) or a plain 500 to the same projection.
    // Without the retry those subsets read back as "static" — and the save path
    // flattens them without asking.
    it('retries the plain projection on 501 as well', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        if ((req.url ?? '').includes('Alias')) { res.statusCode = 501; res.end(); return; }
        jsonResponse(res, 200, { Name: 'Dyn', Expression: '{TM1SUBSETALL([D])}' });
      });
      const out = await getSubset(fakeConfig(fake.url), 'D', 'H', 'Dyn', false);
      expect(urls).toHaveLength(2);
      expect(urls[1]).not.toContain('Alias');
      expect(out).toEqual({ ok: true, Name: 'Dyn', Expression: '{TM1SUBSETALL([D])}', Alias: null });
    });

    it('retries the plain projection on 500 as well', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        if ((req.url ?? '').includes('Alias')) { res.statusCode = 500; res.end(); return; }
        jsonResponse(res, 200, { Name: 'Dyn', Expression: '{X}' });
      });
      expect(await getSubset(fakeConfig(fake.url), 'D', 'H', 'Dyn', false))
        .toEqual({ ok: true, Name: 'Dyn', Expression: '{X}', Alias: null });
      expect(urls).toHaveLength(2);
    });

    // ok:false is the whole point: a failed read must not be indistinguishable
    // from "the subset carries no MDX", or the overwrite path silently flattens
    // a dynamic subset whenever the server hiccups.
    it('reports ok:false when both attempts fail (500)', async () => {
      let calls = 0;
      fake = await startFakeTm1((_req, res) => { calls++; res.statusCode = 500; res.end(); });
      expect(await getSubset(fakeConfig(fake.url), 'D', 'H', 'S', false))
        .toEqual({ ok: false, Name: 'S', Expression: null, Alias: null });
      expect(calls).toBe(2);
    });

    it('reports ok:false on 401 without retrying', async () => {
      let calls = 0;
      fake = await startFakeTm1((_req, res) => { calls++; res.statusCode = 401; res.end(); });
      expect(await getSubset(fakeConfig(fake.url), 'D', 'H', 'S', false))
        .toEqual({ ok: false, Name: 'S', Expression: null, Alias: null });
      expect(calls).toBe(1);
    });

    it('uses PrivateSubsets when isPrivate', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: 'Mine', Expression: null });
      });
      const out = await getSubset(fakeConfig(fake.url), 'D', 'H', 'Mine', true);
      expect(observedUrl).toContain("/PrivateSubsets('Mine')");
      expect(out).toEqual({ ok: true, Name: 'Mine', Expression: null, Alias: null });
    });

    it("escapes a single quote in the subset name (' → '')", async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: "Bob's", Expression: null });
      });
      await getSubset(fakeConfig(fake.url), 'D', 'H', "Bob's", false);
      expect(observedUrl).toContain("/Subsets('Bob''s')");
    });

    // 404 means the subset is gone, not that the projection was refused — a
    // retry would just cost a second round trip for the same answer.
    it('reports ok:false on a 404 without retrying', async () => {
      let calls = 0;
      fake = await startFakeTm1((_req, res) => { calls++; jsonResponse(res, 404, { error: 'nope' }); });
      expect(await getSubset(fakeConfig(fake.url), 'D', 'H', 'Gone', false))
        .toEqual({ ok: false, Name: 'Gone', Expression: null, Alias: null });
      expect(calls).toBe(1);
    });
  });

  describe('subsetExists', () => {
    it('returns true on HTTP 200', async () => {
      fake = await startFakeTm1((req, res) => jsonResponse(res, 200, { Name: 'X' }));
      expect(await subsetExists(fakeConfig(fake.url), 'D', 'H', 'X', false)).toBe(true);
    });

    it('returns false on HTTP 404', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await subsetExists(fakeConfig(fake.url), 'D', 'H', 'X', false)).toBe(false);
    });

    it('uses PrivateSubsets when isPrivate=true', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: 'X' });
      });
      await subsetExists(fakeConfig(fake.url), 'D', 'H', 'X', true);
      expect(observedUrl).toContain('/PrivateSubsets');
    });
  });

  describe('deleteSubset', () => {
    it('returns true on 2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.method).toBe('DELETE');
        res.statusCode = 204;
        res.end();
      });
      expect(await deleteSubset(fakeConfig(fake.url), 'D', 'H', 'X', false)).toBe(true);
    });

    it('returns false on 404 (idempotent delete)', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await deleteSubset(fakeConfig(fake.url), 'D', 'H', 'X', false)).toBe(false);
    });

    it('throws on non-2xx/non-404', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      await expect(deleteSubset(fakeConfig(fake.url), 'D', 'H', 'X', false, 'custom'))
        .rejects.toThrow(/custom/);
    });
  });

  // Live 2026-08-02: TM1 refuses to DELETE a subset a view refers to
  // (HTTP 400 "subset being used by view"). Overwriting one is allowed, so an
  // overwrite must PATCH the existing subset instead of recreating it.
  describe('updateSubset', () => {
    it('PATCHes the addressed subset with If-Match', async () => {
      let observed = { method: '', url: '', body: '', ifMatch: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = {
          method: req.method ?? '',
          url: req.url ?? '',
          body: await readBody(req),
          ifMatch: (req.headers['if-match'] ?? '') as string,
        };
        res.statusCode = 204;
        res.end();
      });
      await updateSubset(fakeConfig(fake.url), 'D', 'H', 'S', { Expression: '{}' }, false);
      expect(observed.method).toBe('PATCH');
      expect(observed.url).toContain("/Subsets('S')");
      expect(observed.ifMatch).toBe('*');
      expect(JSON.parse(observed.body)).toEqual({ Expression: '{}' });
    });

    it('uses PrivateSubsets when isPrivate=true', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 204;
        res.end();
      });
      await updateSubset(fakeConfig(fake.url), 'D', 'H', 'S', {}, true);
      expect(observedUrl).toContain("/PrivateSubsets('S')");
    });

    it('escapes a quote in the subset name', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 204;
        res.end();
      });
      await updateSubset(fakeConfig(fake.url), 'D', 'H', "O'Brien", {}, false);
      expect(decodeURIComponent(observedUrl)).toContain("Subsets('O''Brien')");
    });

    it('throws on a non-2xx answer', async () => {
      fake = await startFakeTm1((_req, res) => {
        res.statusCode = 400;
        res.end('subset being used by view');
      });
      await expect(updateSubset(fakeConfig(fake.url), 'D', 'H', 'S', {}, false)).rejects.toThrow();
    });
  });

  // Live 11.8, 2026-08-02: a PATCH on `Elements` APPENDS. Neither
  // `Elements@odata.bind: []` nor `Elements: []` empties anything, PUT is
  // rejected. What empties it is the collection DELETE with `$id`.
  describe('clearSubsetElements', () => {
    it('reads the first element and empties the collection via $id', async () => {
      const seen: string[] = [];
      fake = await startFakeTm1((req, res) => {
        seen.push(`${req.method} ${decodeURIComponent(req.url ?? '')}`);
        if ((req.url ?? '').includes('$select=Name')) {
          jsonResponse(res, 200, { value: [{ Name: 'A' }] });
          return;
        }
        res.statusCode = 204;
        res.end();
      });
      await clearSubsetElements(fakeConfig(fake.url), 'D', 'H', 'S', false);
      expect(seen[0]).toContain("Subsets('S')/Elements?$select=Name&$top=1");
      expect(seen[1]).toContain('DELETE');
      expect(seen[1]).toContain('/Elements/$ref?$id=');
      // The `$id` carries the service root path, not just the relative part.
      expect(seen[1]).toContain("/api/v1/Dimensions('D')/Hierarchies('H')/Subsets('S')/Elements('A')");
    });

    it('leaves an empty subset alone — there is no element URL to name', async () => {
      const seen: string[] = [];
      fake = await startFakeTm1((req, res) => {
        seen.push(req.method ?? '');
        jsonResponse(res, 200, { value: [] });
      });
      await clearSubsetElements(fakeConfig(fake.url), 'D', 'H', 'S', false);
      expect(seen).toEqual(['GET']);
    });

    it('uses PrivateSubsets when isPrivate=true', async () => {
      let deleteUrl = '';
      fake = await startFakeTm1((req, res) => {
        if ((req.url ?? '').includes('$select=Name')) { jsonResponse(res, 200, { value: [{ Name: 'A' }] }); return; }
        deleteUrl = decodeURIComponent(req.url ?? '');
        res.statusCode = 204;
        res.end();
      });
      await clearSubsetElements(fakeConfig(fake.url), 'D', 'H', 'S', true);
      expect(deleteUrl).toContain("PrivateSubsets('S')/Elements/$ref");
    });

    it('throws when the DELETE is rejected', async () => {
      fake = await startFakeTm1((req, res) => {
        if ((req.url ?? '').includes('$select=Name')) { jsonResponse(res, 200, { value: [{ Name: 'A' }] }); return; }
        res.statusCode = 400;
        res.end('subset being used by view');
      });
      await expect(clearSubsetElements(fakeConfig(fake.url), 'D', 'H', 'S', false)).rejects.toThrow();
    });
  });

  // The count proves an overwrite REPLACED the member list. TM1's PATCH is not
  // uniformly replace-semantics (on chores it appends), so this is read back.
  describe('subsetElementCount', () => {
    it('reads the plain-text /$count body', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 200;
        res.end('42');
      });
      const n = await subsetElementCount(fakeConfig(fake.url), 'D', 'H', 'S', false);
      expect(observedUrl).toContain('/Elements/$count');
      expect(n).toBe(42);
    });

    it('falls back to the inline count when /$count is rejected', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        if ((req.url ?? '').includes('/$count')) { res.statusCode = 400; res.end(); return; }
        jsonResponse(res, 200, { '@odata.count': 7, value: [] });
      });
      const n = await subsetElementCount(fakeConfig(fake.url), 'D', 'H', 'S', false);
      expect(urls.length).toBe(2);
      expect(n).toBe(7);
    });

    it('returns -1 when neither route answers — advisory, never a gate', async () => {
      fake = await startFakeTm1((_req, res) => { res.statusCode = 500; res.end(); });
      const n = await subsetElementCount(fakeConfig(fake.url), 'D', 'H', 'S', false);
      expect(n).toBe(-1);
    });
  });

  describe('createSubset', () => {
    it('POSTs JSON object body', async () => {
      let observed = { url: '', body: '', ct: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = {
          url: req.url ?? '',
          body: await readBody(req),
          ct: (req.headers['content-type'] ?? '') as string,
        };
        res.statusCode = 201;
        res.end();
      });
      await createSubset(fakeConfig(fake.url), 'D', 'H', { Name: 'New', Expression: '{}' }, false);
      expect(observed.url).toContain('/Subsets');
      expect(observed.ct).toContain('application/json');
      expect(JSON.parse(observed.body)).toEqual({ Name: 'New', Expression: '{}' });
    });

    it('accepts pre-stringified body', async () => {
      let observedBody = '';
      fake = await startFakeTm1(async (req, res) => {
        observedBody = await readBody(req);
        res.statusCode = 201;
        res.end();
      });
      await createSubset(fakeConfig(fake.url), 'D', 'H', '{"Name":"S"}', false);
      expect(observedBody).toBe('{"Name":"S"}');
    });

    it('uses PrivateSubsets when isPrivate=true', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        res.statusCode = 201;
        res.end();
      });
      await createSubset(fakeConfig(fake.url), 'D', 'H', { Name: 'P' }, true);
      expect(observedUrl).toContain('/PrivateSubsets');
    });

    it('throws on non-2xx with custom message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 400;
        res.end('rej');
      });
      await expect(createSubset(fakeConfig(fake.url), 'D', 'H', {}, false, 'create failed'))
        .rejects.toThrow(/create failed/);
    });
  });

  describe('listSubsetsWithElements', () => {
    it('GETs with $expand=Elements and returns raw value array', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, {
          value: [
            { Name: 'S1', Elements: [{ Name: 'A' }, { Name: 'B' }] },
          ],
        });
      });
      const out = await listSubsetsWithElements(fakeConfig(fake.url), 'D');
      expect(observedUrl).toContain('$expand=Elements');
      expect(out).toEqual([{ Name: 'S1', Elements: [{ Name: 'A' }, { Name: 'B' }] }]);
    });

    it('returns [] on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end();
      });
      expect(await listSubsetsWithElements(fakeConfig(fake.url), 'D')).toEqual([]);
    });
  });

  describe('listSubsetElementNames', () => {
    it('GETs subset Elements and maps to names', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'A' }, { Name: 'B' }] });
      });
      const out = await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'X', false);
      expect(observedUrl).toContain("Subsets('X')/Elements");
      expect(observedUrl).toContain('$select=Name');
      expect(out).toEqual({ elements: ['A', 'B'], complete: true });
    });

    // Fail-closed contract: a non-2xx yields an EMPTY list that is explicitly
    // marked incomplete, so a caller cannot mistake it for "the subset is empty"
    // and write that back over a populated subset.
    it('reports an incomplete read on non-2xx instead of an empty subset', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end();
      });
      expect(await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'X', false))
        .toEqual({ elements: [], complete: false, statusCode: 404 });
    });

    // Ignoring @odata.nextLink mirrored only page 1 of a dynamic subset: the
    // caller's preload cap never tripped and the flatten warning quoted a
    // truncated count. The dimension-browser MDX evaluator already pages this
    // exact collection for the same reason.
    it('follows @odata.nextLink across every page', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        urls.push(url);
        if (url.includes('page=2')) {
          jsonResponse(res, 200, { value: [{ Name: 'C' }, { Name: 'D' }], '@odata.nextLink': 'Nx?page=3' });
          return;
        }
        if (url.includes('page=3')) {
          jsonResponse(res, 200, { value: [{ Name: 'E' }] });
          return;
        }
        jsonResponse(res, 200, { value: [{ Name: 'A' }, { Name: 'B' }], '@odata.nextLink': 'Nx?page=2' });
      });
      const out = await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'X', false);
      expect(out).toEqual({ elements: ['A', 'B', 'C', 'D', 'E'], complete: true });
      expect(urls).toHaveLength(3);
      expect(urls[0]).toContain("Subsets('X')/Elements");
    });

    it('keeps the pages it already has when a LATER page fails', async () => {
      let n = 0;
      fake = await startFakeTm1((_req, res) => {
        n++;
        if (n === 1) {
          jsonResponse(res, 200, { value: [{ Name: 'A' }], '@odata.nextLink': 'Nx?page=2' });
          return;
        }
        res.statusCode = 500;
        res.end();
      });
      expect(await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'X', false))
        .toEqual({ elements: ['A'], complete: false, statusCode: 500 });
    });

    it('does not spin when the server echoes the same nextLink', async () => {
      let n = 0;
      fake = await startFakeTm1((req, res) => {
        n++;
        jsonResponse(res, 200, { value: [{ Name: 'A' }], '@odata.nextLink': (req.url ?? '').replace(/^\/api\/v1\//, '') });
      });
      const out = await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'X', false);
      expect(out).toEqual({ elements: ['A'], complete: true });
      expect(n).toBe(1);
    });

    it('issues exactly one request when the server does not page', async () => {
      let n = 0;
      fake = await startFakeTm1((_req, res) => {
        n++;
        jsonResponse(res, 200, { value: [{ Name: 'A' }, { Name: 'B' }] });
      });
      expect(await listSubsetElementNames(fakeConfig(fake.url), 'D', 'H', 'X', false))
        .toEqual({ elements: ['A', 'B'], complete: true });
      expect(n).toBe(1);
    });
  });
});
