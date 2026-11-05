import { describe, it, expect } from 'vitest';
import { stringCollector } from '../../../tm1Rest/transport/http';

/**
 * Regression guard for the UTF-8 chunk-boundary corruption bug: `res.on('data')`
 * yields Buffer chunks at arbitrary byte offsets (no setEncoding). A per-chunk
 * `data += chunk` decode splits any multibyte UTF-8 sequence that straddles a
 * boundary into U+FFFD. stringCollector must buffer and decode once so German
 * TM1 names / rules / attributes survive intact.
 */
describe('stringCollector — UTF-8 chunk-boundary safety', () => {
  // German-heavy payload (ä ö ü ß = 2 bytes, € = 3 bytes) well over one chunk.
  const text = 'Bahnhöfe_Süßwaren_Größe_€uro '.repeat(2000);
  const full = Buffer.from(text, 'utf8');

  function collect(chunks: Buffer[]): string {
    const c = stringCollector();
    for (const ch of chunks) { c.push(ch); }
    return c.finish();
  }

  function splitEvery(buf: Buffer, size: number): Buffer[] {
    const out: Buffer[] = [];
    for (let i = 0; i < buf.length; i += size) { out.push(buf.subarray(i, i + size)); }
    return out;
  }

  it('single chunk round-trips exactly', () => {
    expect(collect([full])).toBe(text);
  });

  it('reassembles a multibyte char split across a chunk boundary (no U+FFFD)', () => {
    // 16383 is odd relative to the 2-byte repeat unit → boundaries land mid-char.
    const result = collect(splitEvery(full, 16383));
    expect(result).toBe(text);
    expect(result).not.toContain('�');
  });

  it('survives a boundary forced through the middle of a single ü', () => {
    const uml = Buffer.from('ü', 'utf8'); // [0xC3, 0xBC]
    const chunks = [
      Buffer.from('a', 'utf8'),
      uml.subarray(0, 1), // 0xC3 alone
      uml.subarray(1),    // 0xBC alone
      Buffer.from('b', 'utf8'),
    ];
    expect(collect(chunks)).toBe('aüb');
  });

  it('handles many tiny 1-byte chunks', () => {
    const chunks = splitEvery(full, 1);
    expect(collect(chunks)).toBe(text);
  });
});
