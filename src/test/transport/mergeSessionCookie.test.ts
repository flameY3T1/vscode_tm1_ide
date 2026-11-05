import { describe, it, expect } from 'vitest';
import { mergeSessionCookie } from '../../tm1Rest/transport/http';

describe('mergeSessionCookie', () => {
  it('replaces only the renewed pair and keeps the PAW cookies', () => {
    expect(mergeSessionCookie('TM1SessionId_DUMY=t1; paSession=s1; TM1SessionId=a', 'TM1SessionId=b'))
      .toBe('TM1SessionId_DUMY=t1; paSession=s1; TM1SessionId=b');
  });

  it('appends a pair the set did not carry yet', () => {
    expect(mergeSessionCookie('TM1SessionId_DUMY=t1; paSession=s1', 'TM1SessionId=b'))
      .toBe('TM1SessionId_DUMY=t1; paSession=s1; TM1SessionId=b');
  });

  it('keeps the plain direct-TM1 case a straight swap', () => {
    expect(mergeSessionCookie('TM1SessionId=a', 'TM1SessionId=b')).toBe('TM1SessionId=b');
  });
});
