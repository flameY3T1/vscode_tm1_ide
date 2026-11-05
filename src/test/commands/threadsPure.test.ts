import { describe, it, expect } from 'vitest';
import {
  parseIsoDuration,
  formatElapsed,
  stateClassFor,
  mapThreadToRow,
} from '../../commands/threadsPure';

describe('parseIsoDuration', () => {
  it('returns 0 for empty string', () => {
    expect(parseIsoDuration('')).toBe(0);
  });

  it('returns 0 for unparsable input', () => {
    expect(parseIsoDuration('garbage')).toBe(0);
    expect(parseIsoDuration('PT5S')).toBe(0); // missing days segment per impl regex
  });

  it('parses zero-duration ISO string', () => {
    expect(parseIsoDuration('P0DT0H0M0S')).toBe(0);
  });

  it('parses seconds only', () => {
    expect(parseIsoDuration('P0DT0H0M45S')).toBe(45);
  });

  it('parses minutes and seconds', () => {
    expect(parseIsoDuration('P0DT0H5M30S')).toBe(330);
  });

  it('parses full d/h/m/s', () => {
    expect(parseIsoDuration('P2DT3H4M5S')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  });

  it('handles large numeric segments', () => {
    expect(parseIsoDuration('P0DT99H0M0S')).toBe(99 * 3600);
  });
});

describe('formatElapsed', () => {
  it('returns empty for empty input', () => {
    expect(formatElapsed('')).toBe('');
  });

  it('returns empty for zero ISO duration', () => {
    expect(formatElapsed('P0DT0H0M0S')).toBe('');
  });

  it('returns empty for unparsable', () => {
    expect(formatElapsed('garbage')).toBe('');
  });

  it('formats sub-hour as m:ss with zero-padded seconds', () => {
    expect(formatElapsed('P0DT0H2M5S')).toBe('2:05');
  });

  it('formats sub-hour as m:ss without padding minutes', () => {
    expect(formatElapsed('P0DT0H15M0S')).toBe('15:00');
  });

  it('formats >= 1h as h:mm:ss with zero-padded mm + ss', () => {
    expect(formatElapsed('P0DT1H2M3S')).toBe('1:02:03');
  });

  it('formats multi-hour correctly', () => {
    expect(formatElapsed('P0DT12H34M56S')).toBe('12:34:56');
  });
});

describe('stateClassFor', () => {
  it('maps Run to s-run', () => {
    expect(stateClassFor('Run')).toBe('s-run');
  });

  it('maps any Wait-* state to s-wait', () => {
    expect(stateClassFor('WaitOnLock')).toBe('s-wait');
    expect(stateClassFor('Wait')).toBe('s-wait');
    expect(stateClassFor('IdleWait')).toBe('s-wait');
  });

  it('maps Idle to s-idle', () => {
    expect(stateClassFor('Idle')).toBe('s-idle');
  });

  it('maps undefined/empty to s-idle', () => {
    expect(stateClassFor(undefined)).toBe('s-idle');
    expect(stateClassFor('')).toBe('s-idle');
  });

  it('maps unknown state to s-idle', () => {
    expect(stateClassFor('NewWeirdValue')).toBe('s-idle');
  });
});

describe('mapThreadToRow', () => {
  it('produces extras object with display fields', () => {
    const r = mapThreadToRow({ Type: 'User', State: 'Run', ElapsedTime: 'P0DT0H1M30S' });
    expect(r).toEqual({ TypeLabel: 'User', StateClass: 's-run', Elapsed: '1:30' });
  });

  it('defaults missing fields safely', () => {
    expect(mapThreadToRow({})).toEqual({ TypeLabel: '', StateClass: 's-idle', Elapsed: '' });
  });

  it('classifies WaitOnLock state', () => {
    expect(mapThreadToRow({ State: 'WaitOnLock' }).StateClass).toBe('s-wait');
  });

  it('returns empty Elapsed for zero duration', () => {
    expect(mapThreadToRow({ ElapsedTime: 'P0DT0H0M0S' }).Elapsed).toBe('');
  });

  it('uses Type as TypeLabel directly', () => {
    expect(mapThreadToRow({ Type: 'System' }).TypeLabel).toBe('System');
  });
});
