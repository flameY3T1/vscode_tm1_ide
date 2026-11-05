import { describe, expect, it } from 'vitest';
import { parseRow, parseState } from '../tm1top/tm1TopPure';

describe('native Top display rows', () => {
  it('preserves system threads, string IDs and the empty trailing row', () => {
    const rows = parseState(['0016024\tTh:Pseudo\t-\tIdle...', '28840\tTh:DynamicConfig\t-\tIdle...', '']);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ threadId: '0016024', principal: 'Th:Pseudo', context: '-', state: 'Idle...', elapsed: '', stateClass: 's-idle' });
  });
  it('preserves intermediate fields and native elapsed text without guessing a schema', () => {
    expect(parseRow('42\tadmin\tclient:538\tWait:Lock\tcube\tprocess\t1:03:00\t')).toMatchObject({ context: 'client', session: '538', details: ['cube', 'process'], elapsed: '1:03:00', stateClass: 's-wait' });
  });
  it('splits only a numeric session suffix, leaving a colon in the client name intact', () => {
    expect(parseRow('42\tadmin\tvscode-tm1-ide/1.0.38:538\tIdle')).toMatchObject({ context: 'vscode-tm1-ide/1.0.38', session: '538' });
    expect(parseRow('42\tadmin\tMyApp:Region\tIdle')).toMatchObject({ context: 'MyApp:Region', session: '' });
    expect(parseRow('42\tadmin\t-\tIdle')).toMatchObject({ context: '-', session: '' });
  });
  it('accepts sparse rows and reuses the REST state classifier', () => {
    expect(parseRow('42')).toMatchObject({ principal: '', state: '', elapsed: '' });
    expect(parseRow('42\ta\t-\tRun').stateClass).toBe('s-run');
    expect(parseState([])).toEqual([]);
    expect(parseState(['   '])).toEqual([]);
  });
});
