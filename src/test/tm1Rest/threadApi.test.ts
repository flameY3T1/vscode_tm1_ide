import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { listThreads, listThreadsWithWaitChain, cancelThread, findExecutionThreadId, findExecutionJobId, disposeThreadPollAgent, _clearExpandSupportCache, flattenSession, contextToDisplay } from '../../tm1Rest/threadApi';
import { _clearAllSessionsForTest } from '../../tm1Client';
import { startFakeTm1, fakeConfig, jsonResponse, type FakeHandler, type FakeTm1 } from '../__mocks__/fakeTm1Server';

/**
 * Fake TM1 for the cancel-lookup path: serves `/Threads` (optionally with the
 * `$expand=Session` join) plus the `/ActiveSession` probe the transient matcher
 * uses to learn its OWN session id.
 * `ownSession === undefined` → the probe answers 404 (no scoping signal).
 * `expandFails` → `$expand=Session` answers 400 (server without the nav join),
 * and the plain list then carries no `Session` at all.
 */
function threadFake(
  threads: Array<Record<string, unknown>>,
  ownSession?: number | string,
  opts?: { expandFails?: boolean; collection?: 'Threads' | 'Jobs' },
): FakeHandler {
  return (req, res) => {
    const url = req.url ?? '';
    if (url.includes('ActiveSession')) {
      if (ownSession === undefined) { res.statusCode = 404; res.end('no session'); return; }
      jsonResponse(res, 200, { ID: ownSession });
      return;
    }
    if (url.includes('$expand=Session')) {
      if (opts?.expandFails) { res.statusCode = 400; res.end('no Session nav'); return; }
      jsonResponse(res, 200, { value: threads });
      return;
    }
    // Plain collection: a server without the nav join never reports Session.
    jsonResponse(res, 200, { value: threads.map(({ Session: _s, ...rest }) => rest) });
  };
}

describe('threadApi', () => {
  let fake: FakeTm1;

  beforeEach(() => _clearAllSessionsForTest());
  afterEach(async () => {
    _clearAllSessionsForTest();
    await fake?.close();
  });

  describe('contextToDisplay', () => {
    it('unwraps the legacy CAM JSON context to the client id', () => {
      const legacy = JSON.stringify({ CAMNamespace: 'LDAP', Client: 'vscode-tm1-ti/1.0.17' });
      expect(contextToDisplay(legacy)).toBe('vscode-tm1-ti/1.0.17');
    });

    it('passes a plain context through and still strips CAMID wrappers', () => {
      expect(contextToDisplay('vscode-tm1-ti/1.0.18')).toBe('vscode-tm1-ti/1.0.18');
      expect(contextToDisplay('CAMID("LDAP:u:1234")')).toBe('1234');
    });

    it('leaves foreign JSON and empty values untouched', () => {
      expect(contextToDisplay('{"Other":1}')).toBe('{"Other":1}');
      expect(contextToDisplay('{"Client":')).toBe('{"Client":');   // unparseable
      expect(contextToDisplay(undefined)).toBeUndefined();
    });
  });

  describe('listThreads', () => {
    it('returns parsed value array', async () => {
      fake = await startFakeTm1((req, res) => {
        expect(req.method).toBe('GET');
        expect(req.url).toContain('Threads');
        jsonResponse(res, 200, { value: [{ ID: 1, Name: 'A' }, { ID: 2, Name: 'B' }] });
      });
      const threads = await listThreads(fakeConfig(fake.url));
      expect(threads).toHaveLength(2);
      expect(threads[0].Name).toBe('A');
    });

    it('returns [] when value is absent', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, {});
      });
      const threads = await listThreads(fakeConfig(fake.url));
      expect(threads).toEqual([]);
    });

    it('throws on non-2xx (via assertOk)', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 500;
        res.end('server error');
      });
      await expect(listThreads(fakeConfig(fake.url))).rejects.toThrow();
    });
  });

  describe('cancelThread', () => {
    it('POSTs to Threads(<id>)/tm1.CancelOperation with empty body', async () => {
      let observedUrl = '';
      let observedMethod = '';
      fake = await startFakeTm1((req, res) => {
        observedUrl = req.url ?? '';
        observedMethod = req.method ?? '';
        res.statusCode = 204;
        res.end();
      });
      await cancelThread(fakeConfig(fake.url), 42);
      expect(observedMethod).toBe('POST');
      expect(observedUrl).toContain('Threads(42)/tm1.CancelOperation');
    });

    it('throws on non-2xx', async () => {
      fake = await startFakeTm1((req, res) => {
        res.statusCode = 404;
        res.end('not found');
      });
      await expect(cancelThread(fakeConfig(fake.url), 99)).rejects.toThrow();
    });
  });

  describe('findProcessThreadId', () => {

    it('matches a running chore by Function (Chores kind)', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, {
          value: [
            { ID: 3, ObjectName: '', State: 'Run', Function: "POST /api/v1/Chores('MyChore')/tm1.Execute" },
          ],
        });
      });
      const id = await findExecutionThreadId('Chores', 'MyChore', fakeConfig(fake.url));
      expect(id).toBe(3);
    });

    it('does NOT fall back to ObjectName for chores', async () => {
      fake = await startFakeTm1((req, res) => {
        jsonResponse(res, 200, { value: [{ ID: 4, ObjectName: 'MyChore', State: 'Run', Function: '' }] });
      });
      const id = await findExecutionThreadId('Chores', 'MyChore', fakeConfig(fake.url));
      expect(id).toBeUndefined();
    });

    it('finds a v12 Job by its Description (no /api/v1 prefix there)', async () => {
      fake = await startFakeTm1((_req, res) => {
        jsonResponse(res, 200, {
          value: [
            { ID: 'f7308ee4-0', Description: "POST /Processes('MyProc')/tm1.ExecuteWithReturn", State: 'Running' },
            { ID: 'other-0', Description: 'ProcessDebug X', State: 'Waiting' },
          ],
        });
      });
      const id = await findExecutionJobId('Processes', 'MyProc', fakeConfig(fake.url));
      expect(id).toBe('f7308ee4-0');
    });

    it('matches a v12 inline Job only when includeTransient is set, and only while Running', async () => {
      fake = await startFakeTm1(threadFake([
        { ID: 'queued-0', Description: 'POST /ExecuteProcessWithReturn', State: 'Waiting', Session: { ID: '1755000000000000001' } },
        { ID: 'live-0', Description: 'POST /ExecuteProcessWithReturn', State: 'Running', Session: { ID: '1755000000000000001' } },
      ], '1755000000000000001'));
      const cfg = fakeConfig(fake.url);
      expect(await findExecutionJobId('Processes', '}VSCode_SaveDataAll', cfg)).toBeUndefined();
      expect(await findExecutionJobId('Processes', '}VSCode_SaveDataAll', cfg, { includeTransient: true })).toBe('live-0');
    });

    it('returns undefined on a non-200 Jobs response', async () => {
      fake = await startFakeTm1((_req, res) => { res.statusCode = 500; res.end('boom'); });
      expect(await findExecutionJobId('Processes', 'MyProc', fakeConfig(fake.url))).toBeUndefined();
    });

    it('ignores a nameless inline execution unless includeTransient is set', async () => {
      // `POST ExecuteProcessWithReturn` runs the TI inline — its Function has no
      // object name, so only an opt-in caller may claim that thread. And even
      // then only OUR OWN session's thread counts (see the scoping block below).
      fake = await startFakeTm1(threadFake(
        [{ ID: 21, ObjectName: '', State: 'Run', Function: 'POST /api/v1/ExecuteProcessWithReturn', Session: { ID: 103 } }],
        103,
      ));
      const cfg = fakeConfig(fake.url);
      expect(await findExecutionThreadId('Processes', '}VSCode_SaveDataAll', cfg)).toBeUndefined();
      expect(await findExecutionThreadId('Processes', '}VSCode_SaveDataAll', cfg, { includeTransient: true })).toBe(21);
    });

    it('prefers the named match over the transient one', async () => {
      fake = await startFakeTm1((_req, res) => {
        jsonResponse(res, 200, {
          value: [
            { ID: 21, ObjectName: '', State: 'Run', Function: 'POST /api/v1/ExecuteProcessWithReturn' },
            { ID: 22, ObjectName: '', State: 'Run', Function: "POST /api/v1/Processes('MyProc')/tm1.Execute" },
          ],
        });
      });
      const id = await findExecutionThreadId('Processes', 'MyProc', fakeConfig(fake.url), { includeTransient: true });
      expect(id).toBe(22);
    });

    describe('transient match is scoped to our own session (never kills a foreign run)', () => {
      // The transient needle (`ExecuteProcessWithReturn`) carries NO object name,
      // so it matches EVERY inline helper on the server — Arc's, a second VS Code
      // window's, any client's. Cancel must therefore only ever claim the thread
      // that belongs to OUR OWN login session (`GET /ActiveSession`).
      const transient = (id: number, session?: number) => ({
        ID: id, ObjectName: '', State: 'Run',
        Function: 'POST /api/v1/ExecuteProcessWithReturn',
        ...(session === undefined ? {} : { Session: { ID: session } }),
      });

      it('does NOT claim an inline thread owned by another session', async () => {
        fake = await startFakeTm1(threadFake([transient(31, 55)], 103));
        const id = await findExecutionThreadId(
          'Processes', '}VSCode_SaveDataAll', fakeConfig(fake.url), { includeTransient: true },
        );
        expect(id).toBeUndefined();
      });

      it('picks OUR inline thread out of several concurrent ones', async () => {
        fake = await startFakeTm1(threadFake(
          [transient(31, 55), transient(32, 103), transient(33, 77)], 103,
        ));
        const id = await findExecutionThreadId(
          'Processes', '}VSCode_SaveDataAll', fakeConfig(fake.url), { includeTransient: true },
        );
        expect(id).toBe(32);
      });

      it('returns undefined when the own-session probe fails (no guessing)', async () => {
        fake = await startFakeTm1(threadFake([transient(31, 103)], undefined));
        const id = await findExecutionThreadId(
          'Processes', '}VSCode_SaveDataAll', fakeConfig(fake.url), { includeTransient: true },
        );
        expect(id).toBeUndefined();
      });

      it('returns undefined when the server has no Session nav, but still matches by name', async () => {
        fake = await startFakeTm1(threadFake([
          transient(31, 103),
          { ID: 32, ObjectName: '', State: 'Run', Function: "POST /api/v1/Processes('MyProc')/tm1.Execute", Session: { ID: 103 } },
        ], 103, { expandFails: true }));
        const cfg = fakeConfig(fake.url);
        expect(await findExecutionThreadId('Processes', '}VSCode_SaveDataAll', cfg, { includeTransient: true }))
          .toBeUndefined();
        // The named matcher must survive the narrowing to the plain collection.
        expect(await findExecutionThreadId('Processes', 'MyProc', cfg, { includeTransient: true })).toBe(32);
      });

      it('scopes the v12 Jobs path the same way', async () => {
        const job = (id: string, session: string) => ({
          ID: id, State: 'Running', Description: 'POST /ExecuteProcessWithReturn', Session: { ID: session },
        });
        fake = await startFakeTm1(threadFake([job('foreign-0', 'sess-a'), job('mine-0', 'sess-b')], 'sess-b'));
        const cfg = fakeConfig(fake.url);
        expect(await findExecutionJobId('Processes', '}VSCode_SaveDataAll', cfg, { includeTransient: true }))
          .toBe('mine-0');

        await fake.close();
        fake = await startFakeTm1(threadFake([job('foreign-0', 'sess-a')], 'sess-b'));
        expect(await findExecutionJobId('Processes', '}VSCode_SaveDataAll', fakeConfig(fake.url), { includeTransient: true }))
          .toBeUndefined();
      });

      it('matches an Int64 session id across BOTH wire representations', async () => {
        // `/Jobs` is read elsewhere through parseODataValueBodyBigIntIds, which
        // keeps a 16+ digit id as an EXACT string, while /ActiveSession goes
        // through plain JSON.parse, which rounds it. Aligning one side without
        // the other must not silently disable cancel, so the comparison has to
        // survive the mixed pair instead of relying on a comment.
        const exact = '1755123456789012345';          // lossless, as the BigInt parser yields
        fake = await startFakeTm1((req, res) => {
          const url = req.url ?? '';
          // Probe answers the ROUNDED number (plain JSON.parse of the same id).
          if (url.includes('ActiveSession')) { jsonResponse(res, 200, `{"ID":${exact}}`); return; }
          jsonResponse(res, 200,
            `{"value":[{"ID":"mine-0","State":"Running","Description":"POST /ExecuteProcessWithReturn","Session":{"ID":"${exact}"}}]}`);
        });
        const id = await findExecutionJobId(
          'Processes', '}VSCode_SaveDataAll', fakeConfig(fake.url), { includeTransient: true },
        );
        expect(id).toBe('mine-0');
      });

      it('compares Int64 session ids consistently on both sides (v12)', async () => {
        // v12 session ids are Int64 and exceed JS's safe-integer range. Both the
        // Job list and the /ActiveSession probe must be read the same way — a
        // rounded number on one side and an exact string on the other would
        // never match, silently disabling cancel.
        const big = '1755123456789012345';
        fake = await startFakeTm1((req, res) => {
          const url = req.url ?? '';
          if (url.includes('ActiveSession')) { jsonResponse(res, 200, `{"ID":${big}}`); return; }
          jsonResponse(res, 200,
            `{"value":[{"ID":"mine-0","State":"Running","Description":"POST /ExecuteProcessWithReturn","Session":{"ID":${big}}}]}`);
        });
        const id = await findExecutionJobId(
          'Processes', '}VSCode_SaveDataAll', fakeConfig(fake.url), { includeTransient: true },
        );
        expect(id).toBe('mine-0');
      });
    });

    describe('the NAMED match is scoped to our own session too', () => {
      // Same defect class as the transient needle: `Processes('P')/tm1.Execute`
      // identifies the OBJECT, not the run — another user executing the same
      // process matches just as well, and this lookup only ever serves to cancel
      // a run WE started (which always sits on our own session).
      const named = (id: number, session?: number) => ({
        ID: id, ObjectName: '', State: 'Run',
        Function: "POST /api/v1/Processes('MyProc')/tm1.ExecuteWithReturn",
        ...(session === undefined ? {} : { Session: { ID: session } }),
      });

      it('picks OUR run out of several concurrent runs of the same process', async () => {
        fake = await startFakeTm1(threadFake([named(41, 55), named(42, 103)], 103));
        expect(await findExecutionThreadId('Processes', 'MyProc', fakeConfig(fake.url))).toBe(42);
      });

      it('does NOT claim a foreign session\'s run of the same process', async () => {
        fake = await startFakeTm1(threadFake([named(41, 55)], 103));
        expect(await findExecutionThreadId('Processes', 'MyProc', fakeConfig(fake.url))).toBeUndefined();
      });

      it('scopes the ObjectName fallback as well', async () => {
        fake = await startFakeTm1(threadFake([
          { ID: 61, ObjectName: 'MyProc', State: 'Run', Function: '', Session: { ID: 55 } },
        ], 103));
        expect(await findExecutionThreadId('Processes', 'MyProc', fakeConfig(fake.url))).toBeUndefined();
      });

      it('scopes a chore run the same way', async () => {
        const chore = (id: number, session: number) => ({
          ID: id, ObjectName: '', State: 'Run',
          Function: "POST /api/v1/Chores('MyChore')/tm1.Execute", Session: { ID: session },
        });
        fake = await startFakeTm1(threadFake([chore(71, 55), chore(72, 103)], 103));
        expect(await findExecutionThreadId('Chores', 'MyChore', fakeConfig(fake.url))).toBe(72);
      });

      it('scopes the named v12 Job match as well', async () => {
        const job = (id: string, session: string) => ({
          ID: id, State: 'Running', Session: { ID: session },
          Description: "POST /Processes('MyProc')/tm1.ExecuteWithReturn",
        });
        fake = await startFakeTm1(threadFake([job('foreign-0', 'sess-a'), job('mine-0', 'sess-b')], 'sess-b'));
        expect(await findExecutionJobId('Processes', 'MyProc', fakeConfig(fake.url))).toBe('mine-0');
      });

      it('DELIBERATE fallback: matches unscoped when the server exposes no Session', async () => {
        // No `$expand=Session` → no scoping signal at all. Refusing here would
        // disable cancel outright on such servers; the named needle is at least
        // object-specific, so the unscoped first match stays the lesser evil.
        // (The nameless transient needle keeps refusing — asserted above.)
        fake = await startFakeTm1(threadFake([named(41, 55)], 103, { expandFails: true }));
        expect(await findExecutionThreadId('Processes', 'MyProc', fakeConfig(fake.url))).toBe(41);
      });

      it('DELIBERATE fallback: matches unscoped when the own-session probe fails', async () => {
        fake = await startFakeTm1(threadFake([named(41, 55)], undefined));
        expect(await findExecutionThreadId('Processes', 'MyProc', fakeConfig(fake.url))).toBe(41);
      });
    });
  });

  describe('poll socket pinning (stable thread id)', () => {
    it('reuses ONE dedicated socket for polls after the initial session mint', async () => {
      const ports: number[] = [];
      fake = await startFakeTm1((req, res) => {
        ports.push(req.socket.remotePort ?? 0);
        // Issue a session cookie so the client enters the cookie-reuse path
        // (where the dedicated poll agent applies) — as real TM1 does.
        res.setHeader('Set-Cookie', 'TM1SessionId=fake-sess; Path=/');
        jsonResponse(res, 200, { value: [{ ID: 1, Name: 'poll' }] });
      });
      const cfg = fakeConfig(fake.url);
      for (let i = 0; i < 5; i++) { await listThreadsWithWaitChain(cfg); }
      // Two requests per poll (`/Threads?$expand=…` + the `/Sessions` idle-session
      // merge), BOTH pinned to the single dedicated keep-alive socket → TM1 keeps
      // handing back the same worker thread (constant real ID).
      expect(ports.length).toBe(10);
      expect(new Set(ports).size).toBe(1);
      disposeThreadPollAgent(cfg);
    });

    it('pins ONE socket even when the server never caches a session (re-mints every poll)', async () => {
      // The failure mode behind the churn: a server that returns NO session
      // cookie makes every poll re-mint. The dedicated poll agent must be used
      // on the MINT path too, so all polls still ride a single socket → one
      // worker thread → constant thread ID.
      const ports: number[] = [];
      fake = await startFakeTm1((req, res) => {
        ports.push(req.socket.remotePort ?? 0);
        // NO Set-Cookie → transport can't cache a session → mint path every call.
        jsonResponse(res, 200, { value: [{ ID: 1, Name: 'poll' }] });
      });
      const cfg = fakeConfig(fake.url);
      for (let i = 0; i < 5; i++) { await listThreadsWithWaitChain(cfg); }
      // Two requests per poll, all on one socket, even when re-minting every time.
      expect(ports.length).toBe(10);
      expect(new Set(ports).size).toBe(1);
      disposeThreadPollAgent(cfg);
    });

    it('disposeThreadPollAgent is a no-op when no agent exists and is idempotent', () => {
      const cfg = fakeConfig('http://never-opened:9999');
      expect(() => { disposeThreadPollAgent(cfg); disposeThreadPollAgent(cfg); }).not.toThrow();
    });
  });

  describe('session id join via Thread.Session nav (v11)', () => {
    afterEach(() => { _clearExpandSupportCache(); });

    it('reads each thread\'s owning session from the expanded Session entity', async () => {
      // TM1's Thread has a `Session` navigation property → $expand=Session gives
      // each thread its real session directly (all users, incl. transient polls).
      fake = await startFakeTm1((req, res) => {
        res.setHeader('Set-Cookie', 'TM1SessionId=s; Path=/');
        if ((req.url ?? '').includes('Sessions')) { jsonResponse(res, 200, { value: [] }); return; }
        jsonResponse(res, 200, { value: [
          { ID: 7, Name: 'a', Type: 'User', Session: { ID: 103 } },
          { ID: 8, Name: 'b', Type: 'User', Session: { ID: 104 } },
          { ID: 999, Type: 'System', Session: null },
        ] });
      });
      const cfg = fakeConfig(fake.url);
      const rows = await listThreadsWithWaitChain(cfg);
      // Two same-user windows resolve to DISTINCT sessions (the bug the user hit).
      expect(rows.find(r => r.ID === 7)?.Session).toBe(103);
      expect(rows.find(r => r.ID === 8)?.Session).toBe(104);
      // System thread has no owning session.
      expect(rows.find(r => r.ID === 999)?.Session).toBeUndefined();
      disposeThreadPollAgent(cfg);
    });

    it('appends idle logins (no active thread) as Idle session rows, skipping active ones', async () => {
      fake = await startFakeTm1((req, res) => {
        res.setHeader('Set-Cookie', 'TM1SessionId=s; Path=/');
        if ((req.url ?? '').includes('Sessions')) {
          jsonResponse(res, 200, { value: [
            { ID: 50, Context: 'busy', Active: true, User: { Name: 'achim' } },   // has active thread → skip
            { ID: 103, Context: 'vscode', Active: true, User: { Name: 'user1' } },
            { ID: 104, Context: 'vscode', Active: true, User: { Name: 'user1' } },
            { ID: 105, Context: 'internal', Active: true },                       // no User → timed out, hidden
          ] });
          return;
        }
        jsonResponse(res, 200, { value: [{ ID: 900, Name: 'achim', Type: 'User', Session: { ID: 50 } }] });
      });
      const cfg = fakeConfig(fake.url);
      const rows = await listThreadsWithWaitChain(cfg);
      // Active thread of session 50 stays; 50 is NOT duplicated as an idle row.
      expect(rows.filter(r => r.Session === 50)).toHaveLength(1);
      expect(rows.find(r => r.ID === 900)?.State).not.toBe('Idle');
      // The two idle vscode logins appear as blank-ID Idle rows, Type = User
      // (thread CATEGORY, not the login's security level).
      const idle103 = rows.find(r => r.Session === 103);
      const idle104 = rows.find(r => r.Session === 104);
      expect(idle103).toMatchObject({ State: 'Idle', Name: 'user1', Type: 'User' });
      expect(idle103?.ID).toBeUndefined();
      expect(idle104).toMatchObject({ State: 'Idle', Name: 'user1', Type: 'User' });
      // A session whose User is gone is a timed-out login — TM1 keeps the entry
      // (Active stays true), but there is no connection left to show.
      expect(rows.find(r => r.Session === 105)).toBeUndefined();
      disposeThreadPollAgent(cfg);
    });

    it('hides ended/stale sessions (Active=false), keeps alive ones', async () => {
      fake = await startFakeTm1((req, res) => {
        res.setHeader('Set-Cookie', 'TM1SessionId=s; Path=/');
        if ((req.url ?? '').includes('Sessions')) {
          jsonResponse(res, 200, { value: [
            { ID: 201, Context: 'vscode', Active: true, User: { Name: 'alive' } },
            { ID: 202, Context: 'old', Active: false, User: { Name: 'dead' } },  // ended → hide
          ] });
          return;
        }
        jsonResponse(res, 200, { value: [] });
      });
      const cfg = fakeConfig(fake.url);
      const rows = await listThreadsWithWaitChain(cfg);
      expect(rows.find(r => r.Session === 201)).toMatchObject({ State: 'Idle', Name: 'alive' });
      expect(rows.find(r => r.Session === 202)).toBeUndefined();
      disposeThreadPollAgent(cfg);
    });

    it('narrows the expand when WaitingOn is missing (TM1 11.8 error 278), still gets Session', async () => {
      let sawSessionWait = 0, sawSessionOnly = 0;
      fake = await startFakeTm1((req, res) => {
        const url = req.url ?? '';
        res.setHeader('Set-Cookie', 'TM1SessionId=s; Path=/');
        if (url.includes('Sessions')) { jsonResponse(res, 200, { value: [] }); return; }
        if (url.includes('WaitingOn')) {
          sawSessionWait++;
          res.statusCode = 400;
          res.end(JSON.stringify({ error: { code: '278', message: '"WaitingOn" is not a property of "Thread".' } }));
          return;
        }
        sawSessionOnly++;   // Threads?$expand=Session
        jsonResponse(res, 200, { value: [{ ID: 7, Name: 'a', Type: 'User', Session: { ID: 55 } }] });
      });
      const cfg = fakeConfig(fake.url);
      const rows = await listThreadsWithWaitChain(cfg);
      expect(rows.find(r => r.ID === 7)?.Session).toBe(55);
      // First poll probed WaitingOn once, then narrowed; the cache pins the
      // narrower variant so the next poll goes straight to $expand=Session.
      await listThreadsWithWaitChain(cfg);
      expect(sawSessionWait).toBe(1);
      expect(sawSessionOnly).toBe(2);
      disposeThreadPollAgent(cfg);
    });
  });

  describe('flattenSession (pure)', () => {
    it('flattens the nested Session entity to its numeric ID', () => {
      expect(flattenSession({ ID: 1, Name: 'x', Session: { ID: 42 } } as any).Session).toBe(42);
    });
    it('maps null / missing / non-numeric Session to undefined', () => {
      expect(flattenSession({ ID: 1, Name: 'x', Session: null } as any).Session).toBeUndefined();
      expect(flattenSession({ ID: 1, Name: 'x' } as any).Session).toBeUndefined();
      expect(flattenSession({ ID: 1, Name: 'x', Session: {} } as any).Session).toBeUndefined();
    });
  });
});
