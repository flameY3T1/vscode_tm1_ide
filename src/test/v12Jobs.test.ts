import { describe, it, expect } from 'vitest';
import { _mapJobToRow } from '../tm1Rest/threadApi';

describe('_mapJobToRow (v12)', () => {
  it('maps a running job: real user in Name, context + session + JobId separate', () => {
    const row = _mapJobToRow({
      ID: '665e3081-b31a-4758-9206-f7c7a0a3ee32-00',
      Description: "POST /Processes('##sleep1')/tm1.Execute",
      State: 'Running',
      ElapsedTime: 'P0DT00H00M06S',
      Session: {
        ID: 7652941458679,
        Context: 'vscode-tm1-ti/1.0.11',
        Active: true,
        User: { Name: 'Admin', Type: 'Admin' },
      },
    });
    expect(row).toMatchObject({
      JobId: '665e3081-b31a-4758-9206-f7c7a0a3ee32-00',
      State: 'Run',                 // JobState 'Running' → v11 'Run' vocabulary
      Function: "POST /Processes('##sleep1')/tm1.Execute",
      ElapsedTime: 'P0DT00H00M06S',
      Session: 7652941458679,
      Name: 'Admin',                // the actual TM1 user, NOT the context
      Type: 'User',                 // thread category (User/System), not security level
      Context: 'vscode-tm1-ti/1.0.11',
    });
    // v12 has no numeric worker-thread id — the JobId is shown instead.
    expect(row.ID).toBeUndefined();
  });

  it('normalises JobState Waiting → Wait so the kill-waiting filter matches', () => {
    expect(_mapJobToRow({ ID: 'j1', State: 'Waiting' }).State).toBe('Wait');
    expect(_mapJobToRow({ ID: 'j2', State: 'Canceling' }).State).toBe('Canceling');
  });

  it('falls back through context then a placeholder when no user name', () => {
    expect(_mapJobToRow({ ID: 'j3', Session: { ID: 5, Context: 'ctx' } }).Name).toBe('ctx');
    expect(_mapJobToRow({ ID: 'j4' }).Name).toBe('(job)');
  });
});
