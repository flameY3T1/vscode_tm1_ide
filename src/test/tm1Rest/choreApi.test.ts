import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  listChores, getChoreDetail, executeChore, setChoreActive,
  createChore, updateChore, deleteChore, clearChoreTasks, choreExists,
  CHORE_DETAIL_VARIANTS,
} from '../../tm1Rest/choreApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import {
  startFakeTm1, fakeConfig, jsonResponse, readBody,
  type FakeTm1, type FakeHandler,
} from '../__mocks__/fakeTm1Server';

describe('choreApi', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('listChores', () => {
    it('GETs Chores with default $select and returns value array', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [{ Name: 'C1', Active: true }] });
      });
      const out = await listChores(fakeConfig(fake.url));
      expect(observedUrl).toContain('Chores?$select=Name,Active,StartTime,DST');
      expect(out).toEqual([{ Name: 'C1', Active: true }]);
    });

    it('honors custom $select', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { value: [] });
      });
      await listChores(fakeConfig(fake.url), 'Name');
      expect(observedUrl).toContain('Chores?$select=Name');
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('err');
      });
      await expect(listChores(fakeConfig(fake.url))).rejects.toThrow();
    });
  });

  describe('getChoreDetail', () => {
    // A 2xx that is not JSON must not read as a chore without tasks: the save
    // snapshot would "restore" nothing and a deploy would copy an empty chore.
    it('throws on a 2xx whose body is not JSON', async () => {
      fake = await startFakeTm1((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>sign in</html>'); });
      await expect(getChoreDetail(fakeConfig(fake.url), 'C')).rejects.toThrow();
    });

    it('GETs Chores(<encoded-name>) with the richest variant first', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        jsonResponse(res, 200, { Name: "My's Chore", Tasks: [] });
      });
      const out = await getChoreDetail(fakeConfig(fake.url), "My's Chore");
      expect(urls).toHaveLength(1);
      expect(urls[0]).toContain("Chores('My''s%20Chore')");
      // Parameters is an OData COMPLEX type → nested $select, never $expand.
      expect(urls[0]).toContain('$expand=Tasks($select=Step,Parameters;$expand=Process($select=Name))');
      expect(urls[0]).toContain('ExecutionMode');
      expect(urls[0]).not.toContain('$expand=Parameters');
      expect((out.data as { Tasks: unknown[] }).Tasks).toEqual([]);
      // `url` is the relative API path; `req.url` carries the /api/v1 prefix.
      expect(urls[0]).toContain(out.url);
    });

    it('falls back to a simpler variant when the server rejects the enriched one', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        // Reject anything with a nested $select on Tasks (a picky TM1).
        if ((req.url ?? '').includes('Tasks($select=')) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        jsonResponse(res, 200, { Name: 'C', Tasks: [{ Step: 0 }] });
      });
      const out = await getChoreDetail(fakeConfig(fake.url), 'C');
      expect(urls).toHaveLength(3);
      expect(out.url).toContain('$expand=Tasks($expand=Process($select=Name))');
      expect((out.data as { Tasks: unknown[] }).Tasks).toHaveLength(1);
    });

    it('drops ExecutionMode from $select as a last resort', async () => {
      const urls: string[] = [];
      fake = await startFakeTm1((req, res) => {
        urls.push(req.url ?? '');
        if ((req.url ?? '').includes('ExecutionMode')) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        jsonResponse(res, 200, { Name: 'C', Tasks: [] });
      });
      const out = await getChoreDetail(fakeConfig(fake.url), 'C');
      expect(urls).toHaveLength(4);
      expect(out.url).not.toContain('ExecutionMode');
    });

    it('returns the ExecutionMode-less body verbatim — the key stays ABSENT, it is not invented', async () => {
      // Live-verified on TM1 11.8: with
      // `$select=Name,Active,DSTSensitive,StartTime,Frequency` the answer has NO
      // ExecutionMode key at all, even for a chore whose real mode is
      // SingleCommit. Callers must read that absence as UNKNOWN
      // (`mapChoreDetailFromApi` → undefined → `buildChorePayload` omits it);
      // anything that fills in a default here downgrades the chore on save.
      fake = await startFakeTm1((req, res) => {
        if ((req.url ?? '').includes('ExecutionMode')) {
          res.statusCode = 400;
          res.end('Bad Request');
          return;
        }
        jsonResponse(res, 200, {
          Name: 'Nightly', Active: true, DSTSensitive: false,
          StartTime: '2025-01-01T00:00:00Z', Frequency: 'P1DT00H00M00S', Tasks: [],
        });
      });
      const out = await getChoreDetail(fakeConfig(fake.url), 'Nightly');
      expect(out.url).not.toContain('ExecutionMode');
      expect(Object.prototype.hasOwnProperty.call(out.data, 'ExecutionMode')).toBe(false);
    });

    it('throws the last server error when every variant is rejected', async () => {
      let calls = 0;
      fake = await startFakeTm1((req, res) => {
        calls++;
        res.statusCode = 404;
        res.end('not found');
      });
      await expect(getChoreDetail(fakeConfig(fake.url), 'Missing')).rejects.toThrow(/404/);
      expect(calls).toBe(CHORE_DETAIL_VARIANTS.length);
    });
  });

  describe('executeChore', () => {
    it('POSTs Chores(<name>)/tm1.Execute with empty JSON body', async () => {
      let observedUrl = '';
      let observedMethod = '';
      let observedBody = '';
      fake = await startFakeTm1(async (req, res) => {
        observedUrl = req.url ?? '';
        observedMethod = req.method ?? '';
        observedBody = await readBody(req);
        res.statusCode = 204;
        res.end();
      });
      await executeChore(fakeConfig(fake.url), 'Nightly');
      expect(observedMethod).toBe('POST');
      expect(observedUrl).toContain("Chores('Nightly')/tm1.Execute");
      expect(observedBody).toBe('{}');
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('exec failed');
      });
      await expect(executeChore(fakeConfig(fake.url), 'X')).rejects.toThrow();
    });
  });

  describe('setChoreActive', () => {
    it('PATCHes Active=true', async () => {
      let body = '';
      fake = await startFakeTm1(async (req, res) => {
        body = await readBody(req);
        expect(req.method).toBe('PATCH');
        res.statusCode = 204;
        res.end();
      });
      await setChoreActive(fakeConfig(fake.url), 'C', true);
      expect(JSON.parse(body)).toEqual({ Active: true });
    });

    it('PATCHes Active=false', async () => {
      let body = '';
      fake = await startFakeTm1(async (req, res) => {
        body = await readBody(req);
        res.statusCode = 204;
        res.end();
      });
      await setChoreActive(fakeConfig(fake.url), 'C', false);
      expect(JSON.parse(body)).toEqual({ Active: false });
    });
  });

  describe('choreExists', () => {
    it('GETs Chores(<name>)?$select=Name and returns true on 200', async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        jsonResponse(res, 200, { Name: 'Nightly' });
      });
      await expect(choreExists(fakeConfig(fake.url), 'Nightly')).resolves.toBe(true);
      expect(observed.method).toBe('GET');
      expect(observed.url).toContain("Chores('Nightly')?$select=Name");
    });

    it('doubles a single quote in the key and URL-encodes it', async () => {
      let observedUrl = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        jsonResponse(res, 200, { Name: "My's Chore" });
      });
      await choreExists(fakeConfig(fake.url), "My's Chore");
      expect(observedUrl).toContain("Chores('My''s%20Chore')");
    });

    it('returns false on 404 instead of throwing — a free name is not an error', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end('not found');
      });
      await expect(choreExists(fakeConfig(fake.url), 'Missing')).resolves.toBe(false);
    });
  });

  describe('createChore / updateChore / deleteChore', () => {
    it('createChore POSTs body to /Chores', async () => {
      let observed = { method: '', url: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '', body: await readBody(req) };
        res.statusCode = 201;
        res.end();
      });
      await createChore(fakeConfig(fake.url), { Name: 'New', Active: false });
      expect(observed.method).toBe('POST');
      expect(observed.url).toContain('Chores');
      expect(JSON.parse(observed.body)).toEqual({ Name: 'New', Active: false });
    });

    it('createChore throws with custom message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 400;
        res.end('rej');
      });
      await expect(createChore(fakeConfig(fake.url), {})).rejects.toThrow(/Chore could not be created/);
    });

    it('updateChore PATCHes body to /Chores(<name>)', async () => {
      let observed = { method: '', url: '', body: '' };
      fake = await startFakeTm1(async (req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '', body: await readBody(req) };
        res.statusCode = 204;
        res.end();
      });
      await updateChore(fakeConfig(fake.url), 'C', { Active: true });
      expect(observed.method).toBe('PATCH');
      expect(observed.url).toContain("Chores('C')");
      expect(JSON.parse(observed.body)).toEqual({ Active: true });
    });

    it('updateChore throws with custom errorMsg', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('boom');
      });
      await expect(updateChore(fakeConfig(fake.url), 'C', { Active: true }, 'custom msg'))
        .rejects.toThrow(/custom msg/);
    });

    it('deleteChore DELETEs /Chores(<name>)', async () => {
      let observed = { method: '', url: '' };
      fake = await startFakeTm1((req, res) => {
        observed = { method: req.method ?? '', url: req.url ?? '' };
        res.statusCode = 204;
        res.end();
      });
      await deleteChore(fakeConfig(fake.url), 'Gone');
      expect(observed.method).toBe('DELETE');
      expect(observed.url).toContain("Chores('Gone')");
    });

    it('deleteChore throws with default message', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 403;
        res.end('forbidden');
      });
      await expect(deleteChore(fakeConfig(fake.url), 'X')).rejects.toThrow(/Chore could not be deleted/);
    });
  });

  describe('clearChoreTasks', () => {
    /**
     * Scripts the two request kinds `clearChoreTasks` makes: N task DELETEs,
     * then one verification GET of the remaining task list.
     */
    function fakeChoreTasks(opts: { deleteOk: number; remainingAfter: number | 'error' }) {
      const counts = { deletes: 0, verifies: 0 };
      const handler: FakeHandler = (req, res) => {
        if (req.method === 'DELETE') {
          counts.deletes++;
          if (counts.deletes <= opts.deleteOk) {
            res.statusCode = 204;
            res.end();
          } else {
            // Verbatim from TM1 11.8: this is how "the list is empty now" looks —
            // indistinguishable from a refusal, hence the verification below.
            jsonResponse(res, 404, {
              error: { code: '278', message: "'0' can not be found in collection of type 'ChoreTask'." },
            });
          }
          return;
        }
        counts.verifies++;
        if (opts.remainingAfter === 'error') {
          res.statusCode = 500;
          res.end('verification blew up');
          return;
        }
        jsonResponse(res, 200, { value: Array.from({ length: opts.remainingAfter }, (_, i) => ({ Step: i })) });
      };
      return { counts, handler };
    }

    it('iteratively DELETEs Tasks(0) until a non-2xx, then verifies the list is empty', async () => {
      const { counts, handler } = fakeChoreTasks({ deleteOk: 3, remainingAfter: 0 });
      let verifyUrl = '';
      fake = await startFakeTm1((req, res) => {
        if (req.method !== 'DELETE') { verifyUrl = req.url ?? ''; }
        handler(req, res);
      });
      await expect(clearChoreTasks(fakeConfig(fake.url), 'C', 10)).resolves.toBeUndefined();
      expect(counts.deletes).toBe(4);
      expect(counts.verifies).toBe(1);
      expect(verifyUrl).toContain("Chores('C')/Tasks?$select=Step");
    });

    it('throws when the delete loop stopped early and tasks remain', async () => {
      // The real partial-clear scenario (live-verified on TM1 11.8): the chore
      // gets (re)activated mid-loop, DELETE Tasks(0) answers 400 "Can't
      // duplicate active chore." and the remaining tasks survive. The loop exits
      // on that non-2xx exactly like it does on the "list is empty" 404, so only
      // the read-back can tell them apart — and PATCH APPENDS, so without this
      // throw the save would leave the chore with duplicated tasks.
      const { counts, handler } = fakeChoreTasks({ deleteOk: 2, remainingAfter: 3 });
      fake = await startFakeTm1((req, res) => {
        if (req.method === 'DELETE' && counts.deletes >= 2) {
          counts.deletes++;
          jsonResponse(res, 400, { error: { code: '7', message: "Can't duplicate active chore." } });
          return;
        }
        handler(req, res);
      });
      await expect(clearChoreTasks(fakeConfig(fake.url), 'C', 10))
        .rejects.toThrow(/Chore "C": 3 task\(s\) remained after clearing.*HTTP 400.*duplicate active chore/s);
      expect(counts.verifies).toBe(1);
    });

    it('does NOT throw when the verification request itself fails', async () => {
      // A failing verification says nothing about the task list, so the save
      // proceeds and the caller's post-save read-back is the safety net.
      const { counts, handler } = fakeChoreTasks({ deleteOk: 1, remainingAfter: 'error' });
      fake = await startFakeTm1(handler);
      await expect(clearChoreTasks(fakeConfig(fake.url), 'C', 10)).resolves.toBeUndefined();
      expect(counts.verifies).toBe(1);
    });

    it('throws when maxIterations is exhausted (server always 2xx)', async () => {
      let deletes = 0;
      let verifies = 0;
      fake = await startFakeTm1((req, res) => {
        if (req.method === 'DELETE') { deletes++; } else { verifies++; }
        res.statusCode = 204;
        res.end();
      });
      await expect(clearChoreTasks(fakeConfig(fake.url), 'C', 5))
        .rejects.toThrow(/Chore "C": 5 task deletions did not empty the task list/);
      expect(deletes).toBe(5);
      // No point verifying after a loop that never terminated.
      expect(verifies).toBe(0);
    });
  });
});
