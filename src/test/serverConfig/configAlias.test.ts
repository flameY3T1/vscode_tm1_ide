import { describe, it, expect } from 'vitest';
import { isoDurationToSeconds, secondsToIsoDuration, resolveReadAlias, resolveWriteAlias, aliasNames, legacyEchoNames, legacyEchoOf } from '../../serverConfig/configAlias';
import { renderHtml } from '../../commands/serverConfig/serverConfigEditorWebview';
import type { ConfigSnapshot } from '../../serverConfig/configApi';

/**
 * Four tm1s.cfg names are named differently in the REST tree AND carry a different
 * value form there. Until 2026-08-31 their row showed "—", although the value was
 * visible one row further down under the leaf name.
 *
 * The numeric values below were read on the 11.8 test server (11.8.02900.8) on 2026-08-31:
 * `Access.HTTP.SessionTimeout` = "P0DT02H00M00S" with 120 minutes in
 * the tm1s.cfg, `Access.Network.IdleConnectionTimeOut` = "P0DT00H00M00S",
 * `Performance.MTQ.UseAllThreads` = true next to `NumberOfThreadsToUse` = 11.
 */
function snapshot(paths: string[], values: Array<[string, unknown]> = []): ConfigSnapshot {
  return {
    values: new Map(values),
    staticKeys: new Set(paths),
    activeKeys: new Set(),
    paths: new Set(paths),
  };
}

function rowsOf(html: string): Array<{ name: string; value: unknown; unavailable: boolean; readonly: boolean; requiresRestart: boolean; type: string; description: string }> {
  const m = /window\.__serverConfig = (.*);\n/.exec(html);
  if (!m) { throw new Error('no __serverConfig payload in the rendered html'); }
  return JSON.parse(m[1]).rows;
}
function row(html: string, name: string) {
  const r = rowsOf(html).find(x => x.name === name);
  if (!r) { throw new Error(`no row for ${name}`); }
  return r;
}

describe('isoDurationToSeconds', () => {
  it('reads the form TM1 sends', () => {
    expect(isoDurationToSeconds('P0DT02H00M00S')).toBe(7200);
    expect(isoDurationToSeconds('P0DT00H00M00S')).toBe(0);
    expect(isoDurationToSeconds('P0DT00H15M00S')).toBe(900);
    expect(isoDurationToSeconds('P1DT00H00M30S')).toBe(86430);
  });

  // Better an empty cell than a guessed number: a value that we cannot
  // interpret with certainty must not appear in the form as a number of minutes.
  it('gives up on anything that is not that form', () => {
    for (const bad of ['', '120', 'PT', 'P0D', 'zwei Stunden', 42, null, undefined]) {
      expect(isoDurationToSeconds(bad), String(bad)).toBeUndefined();
    }
  });
});

describe('resolveReadAlias', () => {
  it('turns the session timeout into minutes', () => {
    const r = resolveReadAlias(
      'HTTPSessionTimeoutMinutes',
      new Map([['Access.HTTP.SessionTimeout', 'P0DT02H00M00S']]),
      new Set(['Access.HTTP.SessionTimeout']),
    );
    expect(r).toEqual({ leaf: 'Access.HTTP.SessionTimeout', value: 120 });
  });

  it('turns the idle connection timeout into seconds', () => {
    const r = resolveReadAlias(
      'IdleConnectionTimeOutSeconds',
      new Map([['Access.Network.IdleConnectionTimeOut', 'P0DT00H01M30S']]),
      new Set(['Access.Network.IdleConnectionTimeOut']),
    );
    expect(r).toEqual({ leaf: 'Access.Network.IdleConnectionTimeOut', value: 90 });
  });

  it('reports MTQ as ALL while the thread flag is set', () => {
    const paths = new Set(['Performance.MTQ.UseAllThreads', 'Performance.MTQ.NumberOfThreadsToUse']);
    expect(resolveReadAlias('MTQ', new Map<string, unknown>([
      ['Performance.MTQ.UseAllThreads', true],
      ['Performance.MTQ.NumberOfThreadsToUse', 11],
    ]), paths)?.value).toBe('ALL');
    expect(resolveReadAlias('MTQ', new Map<string, unknown>([
      ['Performance.MTQ.UseAllThreads', false],
      ['Performance.MTQ.NumberOfThreadsToUse', 4],
    ]), paths)?.value).toBe(4);
  });

  it('joins the CAM gateway list', () => {
    expect(resolveReadAlias(
      'ServerCAMURI',
      new Map<string, unknown>([['Access.CAM.ServerURIs', ['http://a/cam', 'http://b/cam']]]),
      new Set(['Access.CAM.ServerURIs']),
    )?.value).toBe('http://a/cam, http://b/cam');
  });

  // v12 no longer has the whole `Access` group. Then there is no value to
  // show, and the row must keep saying "does not exist here".
  it('stays out of the way when the server has no such leaf', () => {
    for (const name of aliasNames()) {
      expect(resolveReadAlias(name, new Map(), new Set(['Administration.Language'])), name).toBeUndefined();
    }
  });
});

describe('server config editor — value under a differently named leaf', () => {
  const v11 = () => snapshot(
    ['Access.HTTP.SessionTimeout', 'Access.Network.IdleConnectionTimeOut', 'Administration.Language'],
    [['Access.HTTP.SessionTimeout', 'P0DT02H00M00S'], ['Access.Network.IdleConnectionTimeOut', 'P0DT00H00M00S']],
  );

  it('shows the value instead of a dash, and says where it came from', () => {
    const r = row(renderHtml(v11(), 'srv'), 'HTTPSessionTimeoutMinutes');
    expect(r.value).toBe(120);
    expect(r.unavailable).toBe(false);
    expect(r.description).toContain('Access.HTTP.SessionTimeout');
  });

  // In TM1, "static" means "takes effect only after a restart", not
  // "unchangeable" — the row must be editable.
  it('stays editable, with the restart flag taken from the leaf', () => {
    const editable = row(renderHtml(v11(), 'srv'), 'HTTPSessionTimeoutMinutes');
    expect(editable.readonly).toBe(false);
    // Leaf only in Static, not in Active => restart required.
    const staticOnly = snapshot(['Access.HTTP.SessionTimeout'], [['Access.HTTP.SessionTimeout', 'P0DT02H00M00S']]);
    expect(row(renderHtml(staticOnly, 'srv'), 'HTTPSessionTimeoutMinutes').requiresRestart).toBe(true);
    // Blatt in beiden => wirkt sofort.
    const both = snapshot(['Access.HTTP.SessionTimeout'], [['Access.HTTP.SessionTimeout', 'P0DT02H00M00S']]);
    both.activeKeys = new Set(['Access.HTTP.SessionTimeout']);
    expect(row(renderHtml(both, 'srv'), 'HTTPSessionTimeoutMinutes').requiresRestart).toBe(false);
  });

  // Otherwise two editable fields would point at the same target — one in
  // minutes, one in seconds —, and on save the last one would win.
  it('drops the leaf row that the alias already covers', () => {
    const names = rowsOf(renderHtml(v11(), 'srv')).map(r => r.name);
    expect(names).not.toContain('Access.HTTP.SessionTimeout');
    expect(names).toContain('HTTPSessionTimeoutMinutes');
  });

  it('keeps saying "not on this server" where the leaf is missing', () => {
    const r = row(renderHtml(snapshot(['Administration.Language']), 'v12box'), 'HTTPSessionTimeoutMinutes');
    expect(r.value).toBeUndefined();
    expect(r.unavailable).toBe(true);
  });
});

describe('server config editor — descriptions for nested leaves', () => {
  it('describes a leaf that has no tm1s.cfg entry of its own', () => {
    const r = row(renderHtml(snapshot(['Modelling.TI.MaximumTILockObjects']), 'srv'), 'Modelling.TI.MaximumTILockObjects');
    expect(r.description).not.toContain('Nested config-leaf');
    expect(r.description.length).toBeGreaterThan(10);
  });

  // The restart marker stays on the snapshot: only in StaticConfiguration =>
  // restart required. A leaf description must not override that.
  it('does not let a leaf description invent a restart flag', () => {
    const snap = snapshot(['Modelling.TI.MaximumTILockObjects']);
    snap.activeKeys = new Set(['Modelling.TI.MaximumTILockObjects']);
    const rows = rowsOf(renderHtml(snap, 'srv'));
    expect(rows.find(r => r.name === 'Modelling.TI.MaximumTILockObjects')!.requiresRestart).toBe(false);
  });
});

describe('secondsToIsoDuration', () => {
  it('writes the form TM1 sends, two digits and all', () => {
    expect(secondsToIsoDuration(7200)).toBe('P0DT02H00M00S');
    expect(secondsToIsoDuration(0)).toBe('P0DT00H00M00S');
    expect(secondsToIsoDuration(90)).toBe('P0DT00H01M30S');
    expect(secondsToIsoDuration(86430)).toBe('P1DT00H00M30S');
  });

  it('round-trips every duration the 11.8 test server reported', () => {
    for (const iso of ['P0DT02H00M00S', 'P0DT00H15M00S', 'P0DT00H00M00S', 'P0DT01H00M00S']) {
      expect(secondsToIsoDuration(isoDurationToSeconds(iso)!)).toBe(iso);
    }
  });
});

describe('resolveWriteAlias', () => {
  it('turns minutes back into a duration', () => {
    expect(resolveWriteAlias('HTTPSessionTimeoutMinutes', 120))
      .toEqual({ kind: 'entries', entries: [['Access.HTTP.SessionTimeout', 'P0DT02H00M00S']] });
    // Depending on the field kind, the form sends text instead of a number.
    expect(resolveWriteAlias('HTTPSessionTimeoutMinutes', ' 30 '))
      .toEqual({ kind: 'entries', entries: [['Access.HTTP.SessionTimeout', 'P0DT00H30M00S']] });
  });

  it('turns seconds back into a duration', () => {
    expect(resolveWriteAlias('IdleConnectionTimeOutSeconds', 90))
      .toEqual({ kind: 'entries', entries: [['Access.Network.IdleConnectionTimeOut', 'P0DT00H01M30S']] });
  });

  // Measured live on 2026-08-31: {UseAllThreads:false, NumberOfThreadsToUse:-4}
  // responds with HTTP 200 and reads back as -4.
  it('writes MTQ as ALL, a count, or a negative count', () => {
    expect(resolveWriteAlias('MTQ', 'ALL'))
      .toEqual({ kind: 'entries', entries: [['Performance.MTQ.UseAllThreads', true]] });
    expect(resolveWriteAlias('MTQ', 'all'))
      .toEqual({ kind: 'entries', entries: [['Performance.MTQ.UseAllThreads', true]] });
    expect(resolveWriteAlias('MTQ', '4')).toEqual({ kind: 'entries', entries: [
      ['Performance.MTQ.UseAllThreads', false], ['Performance.MTQ.NumberOfThreadsToUse', 4]] });
    expect(resolveWriteAlias('MTQ', -4)).toEqual({ kind: 'entries', entries: [
      ['Performance.MTQ.UseAllThreads', false], ['Performance.MTQ.NumberOfThreadsToUse', -4]] });
  });

  // The ALL case sends ONLY the flag: an accompanying `NumberOfThreadsToUse:
  // null` deletes both fields (struck on 2026-08-31 during restoring).
  it('never sends an empty thread count next to the ALL flag', () => {
    const r = resolveWriteAlias('MTQ', 'ALL');
    expect(r).toEqual({ kind: 'entries', entries: [['Performance.MTQ.UseAllThreads', true]] });
    expect(r?.kind === 'entries' ? r.entries.length : -1).toBe(1);
  });

  it('rejects what TM1 would not take', () => {
    expect(resolveWriteAlias('MTQ', '')).toEqual({ kind: 'invalid', expected: 'mtq' });
    expect(resolveWriteAlias('MTQ', '0')).toEqual({ kind: 'invalid', expected: 'mtq' });
    expect(resolveWriteAlias('MTQ', '2.5')).toEqual({ kind: 'invalid', expected: 'mtq' });
    expect(resolveWriteAlias('MTQ', 'viele')).toEqual({ kind: 'invalid', expected: 'mtq' });
    expect(resolveWriteAlias('HTTPSessionTimeoutMinutes', -1)).toEqual({ kind: 'invalid', expected: 'nonNegativeNumber' });
    expect(resolveWriteAlias('HTTPSessionTimeoutMinutes', 'zwei')).toEqual({ kind: 'invalid', expected: 'nonNegativeNumber' });
  });

  it('splits the CAM gateway list back into an array', () => {
    expect(resolveWriteAlias('ServerCAMURI', 'http://a/cam, http://b/cam'))
      .toEqual({ kind: 'entries', entries: [['Access.CAM.ServerURIs', ['http://a/cam', 'http://b/cam']]] });
    expect(resolveWriteAlias('ServerCAMURI', '   '))
      .toEqual({ kind: 'entries', entries: [['Access.CAM.ServerURIs', []]] });
  });

  it('keeps its hands off a name without an alias', () => {
    expect(resolveWriteAlias('PortNumber', 12345)).toBeUndefined();
  });
});

describe('server config editor — every duration is entered in seconds', () => {
  // Detected by the VALUE, not by a list of names: on 11.8, besides the
  // four aliases, a dozen further leaves carry an ISO duration.
  it('shows a plain duration leaf as a number of seconds and says so', () => {
    const snap = snapshot(['Administration.TopLog.ScanFrequency'], [['Administration.TopLog.ScanFrequency', 'P0DT00H00M05S']]);
    const r = row(renderHtml(snap, 'srv'), 'Administration.TopLog.ScanFrequency');
    expect(r.value).toBe(5);
    expect(r.type).toBe('number');
    expect(r.description.toLowerCase()).toContain('seconds');
  });
});

/**
 * The old `/Configuration` view reports some items a second time,
 * only read-only. Read side by side on 11.8 on 2026-08-31:
 * `SecurityMode` = "Basic" versus `Access.Authentication.IntegratedSecurityMode`
 * = "Basic"; `PrincipalName` = "" versus
 * `Access.Authentication.ServicePrincipalName` = "SYSTEM" — the echo even carried
 * LESS.
 */
describe('server config editor — read-only echoes of an editable row', () => {
  const withCounterparts = () => snapshot(
    ['Access.Authentication.IntegratedSecurityMode', 'Access.Authentication.ServicePrincipalName', 'Access.CAM.ClientURI'],
    [['Access.Authentication.IntegratedSecurityMode', 'Basic'],
     ['Access.Authentication.ServicePrincipalName', 'SYSTEM'],
     ['SecurityMode', 'Basic'], ['PrincipalName', ''], ['ClientCAMURIs', []]],
  );

  it('drops the echo while the editable row is there', () => {
    const names = rowsOf(renderHtml(withCounterparts(), 'srv')).map(r => r.name);
    for (const echo of legacyEchoNames()) { expect(names, echo).not.toContain(echo); }
    expect(names).toContain('Access.Authentication.IntegratedSecurityMode');
  });

  // If the editable row is missing, the echo is the only information about the
  // value — then it must stay.
  it('keeps the echo when the editable row is missing', () => {
    const r = row(renderHtml(snapshot(['Administration.Language'], [['SecurityMode', 'Basic']]), 'srv'), 'SecurityMode');
    expect(r.value).toBe('Basic');
    expect(r.readonly).toBe(true);
  });

  it('names an editable counterpart for every echo', () => {
    for (const echo of legacyEchoNames()) {
      expect(legacyEchoOf(echo), echo).toBeTruthy();
    }
  });

  // These three have NO editable counterpart — they are pure information
  // and must not be hidden along with the others.
  it('leaves the pure-information rows alone', () => {
    for (const keep of ['WebCAMURI', 'DistributedOutputDir', 'ProductVersion']) {
      expect(legacyEchoNames(), keep).not.toContain(keep);
    }
    const snap = snapshot(
      ['Access.Authentication.IntegratedSecurityMode'],
      [['Access.Authentication.IntegratedSecurityMode', 'Basic'], ['SecurityMode', 'Basic'],
       ['WebCAMURI', ''], ['DistributedOutputDir', ''], ['ProductVersion', '11.8.02900.8']],
    );
    const names = rowsOf(renderHtml(snap, 'srv')).map(r => r.name);
    expect(names).not.toContain('SecurityMode');
    for (const keep of ['WebCAMURI', 'DistributedOutputDir', 'ProductVersion']) {
      expect(names, keep).toContain(keep);
    }
  });
});
