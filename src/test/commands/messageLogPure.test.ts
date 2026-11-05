import { describe, it, expect } from 'vitest';
import {
  LEVEL_CLASS,
  levelClassFor,
  mapLogEntry,
  linkifyErrorLogFilenames,
  buildLevelFilter,
} from '../../messageLog/messageLogPure';
import { formatLogTimestamp } from '../../utils/logTimestamp';

describe('LEVEL_CLASS', () => {
  it('maps canonical levels', () => {
    expect(LEVEL_CLASS.INFO).toBe('l-info');
    expect(LEVEL_CLASS.WARN).toBe('l-warn');
    expect(LEVEL_CLASS.WARNING).toBe('l-warn');
    expect(LEVEL_CLASS.ERROR).toBe('l-err');
    expect(LEVEL_CLASS.FATAL).toBe('l-err');
    expect(LEVEL_CLASS.DEBUG).toBe('l-dbg');
  });

  it('is frozen against mutation', () => {
    expect(Object.isFrozen(LEVEL_CLASS)).toBe(true);
  });
});

describe('levelClassFor', () => {
  it('returns class for uppercase level', () => {
    expect(levelClassFor('INFO')).toBe('l-info');
  });

  it('case-insensitive matching', () => {
    expect(levelClassFor('warn')).toBe('l-warn');
    expect(levelClassFor('Warning')).toBe('l-warn');
    expect(levelClassFor('error')).toBe('l-err');
    expect(levelClassFor('FaTaL')).toBe('l-err');
    expect(levelClassFor('debug')).toBe('l-dbg');
  });

  it('falls back to l-info for unknown level', () => {
    expect(levelClassFor('PANIC')).toBe('l-info');
    expect(levelClassFor('')).toBe('l-info');
  });

  it('falls back to l-info for undefined', () => {
    expect(levelClassFor(undefined)).toBe('l-info');
  });
});

describe('mapLogEntry', () => {
  it('adds LevelClass to entry', () => {
    const e = { Level: 'ERROR', Message: 'boom', TimeStamp: '2026-01-01' };
    expect(mapLogEntry(e)).toEqual({
      Level: 'ERROR',
      Message: 'boom',
      TimeStamp: '2026-01-01',
      LevelClass: 'l-err',
    });
  });

  it('preserves all original fields', () => {
    const e = { Level: 'INFO', Message: 'hi', Foo: 'bar', Nested: { x: 1 } };
    const m = mapLogEntry(e);
    expect(m.Foo).toBe('bar');
    expect(m.Nested).toEqual({ x: 1 });
    expect(m.LevelClass).toBe('l-info');
  });

  it('defaults to l-info when Level missing', () => {
    expect(mapLogEntry({ Message: 'x' } as { Level?: string; Message: string }).LevelClass).toBe('l-info');
  });

  it('does not mutate input', () => {
    const e = { Level: 'WARN' };
    mapLogEntry(e);
    expect(e).toEqual({ Level: 'WARN' });
  });
});

describe('linkifyErrorLogFilenames', () => {
  it('wraps a .log filename in a clickable span', () => {
    const msg = 'Process aborted, see TM1ProcessError_20260630193918_42_LoadActuals.log';
    expect(linkifyErrorLogFilenames(msg)).toBe(
      'Process aborted, see <span class="errlink" data-file="TM1ProcessError_20260630193918_42_LoadActuals.log">TM1ProcessError_20260630193918_42_LoadActuals.log</span>',
    );
  });

  it('wraps a .txt filename', () => {
    const out = linkifyErrorLogFilenames('TM1ProcessError_1_X.txt created');
    expect(out).toBe('<span class="errlink" data-file="TM1ProcessError_1_X.txt">TM1ProcessError_1_X.txt</span> created');
  });

  it('wraps multiple filenames in one message', () => {
    const out = linkifyErrorLogFilenames('a TM1ProcessError_1_A.log b TM1ProcessError_2_B.log');
    expect((out.match(/errlink/g) ?? []).length).toBe(2);
  });

  it('leaves messages without an error-log filename untouched', () => {
    expect(linkifyErrorLogFilenames('Plain info message, no file here')).toBe('Plain info message, no file here');
  });

  it('does not match unrelated .log filenames', () => {
    expect(linkifyErrorLogFilenames('see tm1server.log')).toBe('see tm1server.log');
  });

  it('wraps a filename whose process name has spaces and #', () => {
    const fn = 'TM1ProcessError_20260707184948_85123248_## test1.log';
    // esc() already ran: the surrounding <> arrive as &lt; / &gt;.
    const out = linkifyErrorLogFilenames('Fehlerdatei: &lt;' + fn + '&gt;');
    expect(out).toBe(
      'Fehlerdatei: &lt;<span class="errlink" data-file="' + fn + '">' + fn + '</span>&gt;',
    );
  });

  it('stops the filename at the escaped closing angle bracket', () => {
    const fn = 'TM1ProcessError_1_My Process.log';
    const out = linkifyErrorLogFilenames('&lt;' + fn + '&gt; done');
    expect((out.match(/errlink/g) ?? []).length).toBe(1);
    expect(out).toContain('data-file="' + fn + '"');
    expect(out.endsWith('&gt; done')).toBe(true);
  });
});

describe('buildLevelFilter', () => {
  it('returns undefined when every level is wanted — cheapest query, no $filter', () => {
    expect(buildLevelFilter({ info: true, warn: true, error: true, debug: true })).toBeUndefined();
  });

  it('returns null when no level is wanted — caller must skip the request', () => {
    expect(buildLevelFilter({ info: false, warn: false, error: false, debug: false })).toBeNull();
  });

  it('uses the enum-qualified literal, not the bare string', () => {
    // Live 11.8: `Level eq 'Error'` answers HTTP 200 with ZERO rows. Only the
    // namespace-qualified enum literal actually selects.
    expect(buildLevelFilter({ info: false, warn: false, error: true, debug: false }))
      .toBe("(Level eq ibm.tm1.api.v1.LogLevel'Error' or Level eq ibm.tm1.api.v1.LogLevel'Fatal')");
  });

  it('folds Fatal into error and Unknown into info, matching levelClassFor', () => {
    const info = buildLevelFilter({ info: true, warn: false, error: false, debug: false });
    expect(info).toContain("LogLevel'Info'");
    expect(info).toContain("LogLevel'Unknown'");
    const err = buildLevelFilter({ info: false, warn: false, error: true, debug: false });
    expect(err).toContain("LogLevel'Fatal'");
  });

  it('ORs several levels together', () => {
    expect(buildLevelFilter({ info: false, warn: true, error: false, debug: true }))
      .toBe("(Level eq ibm.tm1.api.v1.LogLevel'Warning' or Level eq ibm.tm1.api.v1.LogLevel'Debug')");
  });

  it('treats an unknown key as not wanted rather than emitting a bogus literal', () => {
    expect(buildLevelFilter({ info: false, warn: false, error: false, debug: false, bogus: true } as never))
      .toBeNull();
  });
});

describe('formatLogTimestamp', () => {
  it('pads day and month to dd.mm.yyyy', () => {
    expect(formatLogTimestamp('2026-08-05T07:04:03.120Z')).toMatch(/^05\.08\.2026 /);
  });

  it('keeps a two-digit day unchanged', () => {
    expect(formatLogTimestamp('2026-12-25T18:30:00.000Z')).toMatch(/^25\.12\.2026 /);
  });

  it('renders the time zero-padded as hh:mm:ss', () => {
    const out = formatLogTimestamp('2026-08-05T07:04:03.120Z');
    expect(out.split(' ')[1]).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it('returns empty string for a missing timestamp', () => {
    expect(formatLogTimestamp('')).toBe('');
    expect(formatLogTimestamp(undefined)).toBe('');
  });

  it('returns empty string for TM1 zero timestamps instead of "Invalid Date"', () => {
    // Live 11.8: the very first log line carries TimeStamp "0000-00-00T00:00Z".
    expect(formatLogTimestamp('0000-00-00T00:00Z')).toBe('');
  });

  it('stays self-contained so it survives .toString() injection into the webview', () => {
    const src = formatLogTimestamp.toString();
    expect(src).not.toMatch(/\b(LEVEL_CLASS|levelClassFor|require|import)\b/);
  });
});
