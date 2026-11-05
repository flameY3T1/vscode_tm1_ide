import { describe, it, expect } from 'vitest';
import {
  parsePreviewParams,
  buildContentsUrl,
  buildServerPreviewProcess,
  parsePreviewRows,
  splitPreviewRecords,
  newRecordScan,
  scanRecords,
  countPhysicalLines,
  utf8SafeEnd,
  PREVIEW_MAX_RECORD_CHARS,
  PREVIEW_MAX_SCAN_CHARS,
} from '../../commands/processEditor/asciiPreviewPure';
import { parseAsciiLine } from '../../commands/processEditor/processEditorUtils';

describe('buildServerPreviewProcess', () => {
  const BEL = String.fromCharCode(7);

  it('reads whole lines via BEL delimiter + empty quote into V1', () => {
    const ds = buildServerPreviewProcess('C:\\data\\x.csv', 10, 'TM1ProcessError_p_output.log').Process.DataSource;
    expect(ds.Type).toBe('ASCII');
    expect(ds.dataSourceNameForServer).toBe('C:\\data\\x.csv');
    expect(ds.asciiDelimiterType).toBe('Character');
    expect(ds.asciiDelimiterChar).toBe(BEL);
    expect(ds.asciiQuoteCharacter).toBe('');
    expect(ds.asciiHeaderRecords).toBe(0);
  });

  it('declares a single V1 String variable', () => {
    const p = buildServerPreviewProcess('f.txt', 10, 'TM1ProcessError_p_output.log').Process;
    expect(p.Variables).toEqual([{ Name: 'V1', Type: 'String', Position: 1 }]);
  });

  it('caps output to maxLines and ProcessBreaks past it', () => {
    const md = buildServerPreviewProcess('f.txt', 25, 'TM1ProcessError_p_output.log').Process.MetadataProcedure;
    expect(md).toContain('IF( nR <= 25 );');
    expect(md).toContain('ASCIIOutput( sO, V1 );');
    expect(md).toContain('IF( nR >= 25 );');
    expect(md).toContain('ProcessBreak;');
    expect(md).toContain("GetProcessErrorFileDirectory() | 'TM1ProcessError_p_output.log'");
  });

  it('floors + clamps maxLines to a positive integer', () => {
    expect(buildServerPreviewProcess('f', 0, 'TM1ProcessError_l_output.log').Process.MetadataProcedure).toContain('IF( nR <= 1 );');
    expect(buildServerPreviewProcess('f', 10.9, 'TM1ProcessError_l_output.log').Process.MetadataProcedure).toContain('IF( nR <= 10 );');
  });

  it('is transient — a control-object process name, nothing persisted', () => {
    expect(buildServerPreviewProcess('f', 10, 'TM1ProcessError_l_output.log').Process.Name).toMatch(/^\}/);
  });

  it('rejects a log name that could break out of the TI string literal', () => {
    expect(() => buildServerPreviewProcess('f', 10, "TM1ProcessError_x'; ExecuteProcess('evil'); #.log"))
      .toThrow(/log name/i);
  });

  it('rejects log names outside the TM1ProcessError_*.log shape', () => {
    expect(() => buildServerPreviewProcess('f', 10, 'l')).toThrow(/log name/i);
    expect(() => buildServerPreviewProcess('f', 10, 'other_output.log')).toThrow(/log name/i);
    expect(() => buildServerPreviewProcess('f', 10, 'TM1ProcessError_a.txt')).toThrow(/log name/i);
  });
});

describe('parsePreviewParams', () => {
  it('returns defaults for empty input', () => {
    expect(parsePreviewParams({})).toEqual({
      filePath: '',
      delimiter: ',',
      quoteChar: '"',
      headerRecords: 0,
      maxLines: 50,
    });
  });

  it('coerces non-string inputs', () => {
    const p = parsePreviewParams({ filePath: 42, delimiter: ';', quoteChar: "'", headerRecords: '3', maxLines: '100' });
    expect(p).toEqual({
      filePath: '42',
      delimiter: ';',
      quoteChar: "'",
      headerRecords: 3,
      maxLines: 100,
    });
  });

  it('clamps maxLines to lower bound 10', () => {
    expect(parsePreviewParams({ maxLines: 5 }).maxLines).toBe(10);
    expect(parsePreviewParams({ maxLines: 0 }).maxLines).toBe(50); // 0 → falsy → default 50
    expect(parsePreviewParams({ maxLines: -5 }).maxLines).toBe(10);
  });

  it('clamps maxLines to upper bound 500', () => {
    expect(parsePreviewParams({ maxLines: 999 }).maxLines).toBe(500);
    expect(parsePreviewParams({ maxLines: 500 }).maxLines).toBe(500);
  });

  it('defaults headerRecords to 0 for invalid', () => {
    expect(parsePreviewParams({ headerRecords: 'abc' }).headerRecords).toBe(0);
    expect(parsePreviewParams({ headerRecords: undefined }).headerRecords).toBe(0);
  });
});

describe('buildContentsUrl', () => {
  it('builds path for Files root', () => {
    expect(buildContentsUrl('Files', 'data/test.csv'))
      .toBe("Contents('Files')/Contents('data')/Contents('test.csv')/Content");
  });

  it('builds path for Blobs root', () => {
    expect(buildContentsUrl('Blobs', 'a/b/c.txt'))
      .toBe("Contents('Blobs')/Contents('a')/Contents('b')/Contents('c.txt')/Content");
  });

  it('handles Windows-style backslashes', () => {
    expect(buildContentsUrl('Files', 'foo\\bar\\baz.csv'))
      .toBe("Contents('Files')/Contents('foo')/Contents('bar')/Contents('baz.csv')/Content");
  });

  it('strips Windows drive segments', () => {
    expect(buildContentsUrl('Files', 'C:/data/x.csv'))
      .toBe("Contents('Files')/Contents('data')/Contents('x.csv')/Content");
  });

  it('strips drive segments in backslash paths', () => {
    expect(buildContentsUrl('Files', 'D:\\folder\\file.txt'))
      .toBe("Contents('Files')/Contents('folder')/Contents('file.txt')/Content");
  });

  it('URL-encodes special chars in segments', () => {
    expect(buildContentsUrl('Files', 'has space/with#hash.csv'))
      .toBe("Contents('Files')/Contents('has%20space')/Contents('with%23hash.csv')/Content");
  });

  it('drops empty segments from leading/trailing slashes', () => {
    expect(buildContentsUrl('Files', '/abs/path/'))
      .toBe("Contents('Files')/Contents('abs')/Contents('path')/Content");
  });

  it('handles single-segment file path', () => {
    expect(buildContentsUrl('Files', 'one.csv'))
      .toBe("Contents('Files')/Contents('one.csv')/Content");
  });
});

describe('parsePreviewRows', () => {
  it('splits CSV text into rows', () => {
    const r = parsePreviewRows('a,b,c\n1,2,3', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']]);
    expect(r.truncated).toBe(false);
  });

  it('handles CRLF line endings', () => {
    const r = parsePreviewRows('a,b\r\nc,d', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b'], ['c', 'd']]);
  });

  it('respects maxLines clamp', () => {
    const text = 'a\nb\nc\nd\ne';
    const r = parsePreviewRows(text, 3, ',', '"');
    expect(r.rows.length).toBe(3);
    expect(r.truncated).toBe(true);
  });

  it('never claims a total the bounded read cannot know', () => {
    // Both read paths stop after maxLines+1 records — the text is NOT the file.
    const r = parsePreviewRows('a\nb\nc\nd', 3, ',', '"');
    expect(r.truncated).toBe(true);
    expect(r).not.toHaveProperty('totalLines');
  });

  it('drops the phantom record after a trailing newline', () => {
    const r = parsePreviewRows('a,b\nc,d\n', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b'], ['c', 'd']]);
    expect(r.truncated).toBe(false);
  });

  it('keeps a last record of empty fields (",,") — only blank lines are trimmed', () => {
    const r = parsePreviewRows('a,b\n,\n', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b'], ['', '']]);
  });

  it('trims trailing blank lines', () => {
    const r = parsePreviewRows('a,b\n\n\n', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b']]);
  });

  it('respects custom delimiter', () => {
    const r = parsePreviewRows('a;b;c', 50, ';', '"');
    expect(r.rows).toEqual([['a', 'b', 'c']]);
  });

  it('marks truncated when content exceeds maxLines', () => {
    const text = Array.from({ length: 20 }, (_, i) => String(i)).join('\n');
    const r = parsePreviewRows(text, 5, ',', '"');
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBe(5);
  });

  // --- quote handling (M9) ---

  it('keeps a newline inside a quoted field in the same row', () => {
    const r = parsePreviewRows('a,"b\nc",d\ne,f,g', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b\nc', 'd'], ['e', 'f', 'g']]);
  });

  it('keeps a CRLF inside a quoted field in the same row', () => {
    const r = parsePreviewRows('a,"b\r\nc",d', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b\r\nc', 'd']]);
  });

  it('keeps a quoted delimiter inside the field', () => {
    const r = parsePreviewRows('a,"b,c",d', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b,c', 'd']]);
  });

  it('unescapes doubled quotes', () => {
    const r = parsePreviewRows('"a""b",c', 50, ',', '"');
    expect(r.rows).toEqual([['a"b', 'c']]);
  });

  it('does not split on a newline after a doubled quote inside a field', () => {
    const r = parsePreviewRows('"a""b\nc",d', 50, ',', '"');
    expect(r.rows).toEqual([['a"b\nc', 'd']]);
  });

  it('does not lose data on an unterminated quote', () => {
    const r = parsePreviewRows('a,"b\nc', 50, ',', '"');
    expect(r.rows).toEqual([['a', 'b\nc']]);
  });

  it('counts a multi-line quoted record as ONE row for the maxLines cap', () => {
    const r = parsePreviewRows('h1,h2\n"x\ny\nz",v\nlast,row', 2, ',', '"');
    expect(r.rows).toEqual([['h1', 'h2'], ['x\ny\nz', 'v']]);
    expect(r.truncated).toBe(true);
  });

  it('strips a leading UTF-8 BOM from the first column header', () => {
    const r = parsePreviewRows('﻿id,name\n1,x', 50, ',', '"');
    expect(r.rows[0][0]).toBe('id');
  });

  it('treats every char literally when the quote char is empty', () => {
    const r = parsePreviewRows('a,"b\nc",d', 50, ',', '');
    expect(r.rows).toEqual([['a', '"b'], ['c"', 'd']]);
  });
});

describe('splitPreviewRecords', () => {
  it('stops at the limit and reports there is more', () => {
    expect(splitPreviewRecords('a\nb\nc\nd', '"', 2)).toEqual(['a', 'b']);
  });

  it('does not emit a phantom record for a trailing terminator', () => {
    expect(splitPreviewRecords('a\nb\n', '"', 10)).toEqual(['a', 'b']);
  });

  it('keeps blank lines as records', () => {
    expect(splitPreviewRecords('a\n\nb', '"', 10)).toEqual(['a', '', 'b']);
  });

  it('does not end a record inside an open quote', () => {
    expect(splitPreviewRecords('a,"x\ny",b\nnext', '"', 10)).toEqual(['a,"x\ny",b', 'next']);
  });
});

describe('parseAsciiLine', () => {
  it('splits on the delimiter', () => {
    expect(parseAsciiLine('a,b,c', ',', '"')).toEqual(['a', 'b', 'c']);
  });

  it('ignores a delimiter inside quotes', () => {
    expect(parseAsciiLine('a,"b,c",d', ',', '"')).toEqual(['a', 'b,c', 'd']);
  });

  it('unescapes doubled quotes', () => {
    expect(parseAsciiLine('"a""b",c', ',', '"')).toEqual(['a"b', 'c']);
  });

  it('keeps an embedded newline as a normal char', () => {
    expect(parseAsciiLine('a,"b\nc",d', ',', '"')).toEqual(['a', 'b\nc', 'd']);
  });

  it('tolerates an unterminated quote', () => {
    expect(parseAsciiLine('a,"bc', ',', '"')).toEqual(['a', 'bc']);
  });

  it('returns the whole line when the delimiter is empty', () => {
    expect(parseAsciiLine('a,b', '', '"')).toEqual(['a,b']);
  });

  it('supports multi-char delimiters', () => {
    expect(parseAsciiLine('a||b||c', '||', '"')).toEqual(['a', 'b', 'c']);
  });

  it('yields empty fields for ",,"', () => {
    expect(parseAsciiLine(',,', ',', '"')).toEqual(['', '', '']);
  });
});

describe('scanRecords (byte-level bound for the local streaming read)', () => {
  const buf = (s: string) => Buffer.from(s, 'utf8');

  it('counts LF-terminated records', () => {
    const st = newRecordScan();
    scanRecords(buf('a\nb\nc\n'), 0x22, st);
    expect(st.records).toBe(3);
  });

  it('counts CRLF once', () => {
    const st = newRecordScan();
    scanRecords(buf('a\r\nb\r\n'), 0x22, st);
    expect(st.records).toBe(2);
  });

  it('counts a CRLF split across two chunks once', () => {
    const st = newRecordScan();
    scanRecords(buf('a\r'), 0x22, st);
    scanRecords(buf('\nb\n'), 0x22, st);
    expect(st.records).toBe(2);
  });

  it('does not count a newline inside an open quote', () => {
    const st = newRecordScan();
    scanRecords(buf('a,"x\ny",b\n'), 0x22, st);
    expect(st.records).toBe(1);
  });

  it('carries the quote state across chunks', () => {
    const st = newRecordScan();
    scanRecords(buf('a,"x\n'), 0x22, st);
    expect(st.inQuote).toBe(true);
    expect(st.records).toBe(0);
    scanRecords(buf('y",b\n'), 0x22, st);
    expect(st.inQuote).toBe(false);
    expect(st.records).toBe(1);
  });

  it('treats a doubled quote as staying inside the field', () => {
    const st = newRecordScan();
    scanRecords(buf('"a""b\nc"\n'), 0x22, st);
    expect(st.records).toBe(1);
  });

  it('ignores quotes when no quote byte is given', () => {
    const st = newRecordScan();
    scanRecords(buf('a,"x\ny",b\n'), undefined, st);
    expect(st.records).toBe(2);
  });

  it('is safe on a multi-byte char split across chunks', () => {
    const bytes = buf('Mü\nller\n');
    const st = newRecordScan();
    scanRecords(bytes.subarray(0, 2), 0x22, st); // splits the 2-byte ü
    scanRecords(bytes.subarray(2), 0x22, st);
    expect(st.records).toBe(2);
  });
});

/**
 * MED-1: a bounded read stops on a chunk boundary, which can fall INSIDE a
 * multi-byte UTF-8 sequence. Decoding that buffer strictly throws and drops the
 * WHOLE preview to the Windows-1252 fallback (mojibake everywhere), so the tail
 * has to be trimmed back to the last complete sequence first.
 */
describe('utf8SafeEnd', () => {
  const b = (...v: number[]) => Uint8Array.from(v);

  it('keeps a buffer that ends on ASCII', () => {
    const u = b(0x61, 0x62, 0x0a);
    expect(utf8SafeEnd(u)).toBe(u.length);
  });

  it('keeps a complete 2-byte sequence', () => {
    const u = Uint8Array.from(Buffer.from('aä', 'utf8'));
    expect(utf8SafeEnd(u)).toBe(u.length);
  });

  it('trims a dangling 2-byte lead', () => {
    const u = b(0x61, 0xc3); // 'a' + first byte of 'ä'
    expect(utf8SafeEnd(u)).toBe(1);
  });

  it('trims a half-written 3-byte sequence', () => {
    const u = b(0x61, 0xe2, 0x82); // '€' minus its last byte
    expect(utf8SafeEnd(u)).toBe(1);
  });

  it('keeps complete 3- and 4-byte sequences', () => {
    expect(utf8SafeEnd(Uint8Array.from(Buffer.from('€', 'utf8')))).toBe(3);
    expect(utf8SafeEnd(Uint8Array.from(Buffer.from('𝄞', 'utf8')))).toBe(4);
  });

  it('trims a half-written 4-byte sequence', () => {
    const u = Uint8Array.from(Buffer.from('𝄞', 'utf8')).subarray(0, 3);
    expect(utf8SafeEnd(u)).toBe(0);
  });

  it('leaves non-UTF-8 (Windows-1252) tails alone so the 1252 fallback still sees them', () => {
    const u = b(0x4d, 0xfc); // 'M' + CP1252 'ü' — 0xFC is no valid UTF-8 lead
    expect(utf8SafeEnd(u)).toBe(2);
    const conts = b(0x80, 0x80, 0x80, 0x80); // 4 continuation bytes, no lead
    expect(utf8SafeEnd(conts)).toBe(4);
  });

  it('handles an empty buffer', () => {
    expect(utf8SafeEnd(b())).toBe(0);
  });
});

/**
 * LOW-1: the 32 MiB read cap bounds the READ, not the PARSE. An unterminated
 * quote used to hand one 32 M-char record to two char-by-char loops on the
 * extension-host thread.
 */
describe('parse bounds', () => {
  const runaway = 'a,"' + 'y\n'.repeat(1_000_000); // ~2 M chars, quote never closes

  it('caps a single runaway record instead of building it in full', () => {
    const recs = splitPreviewRecords(runaway, '"', 5);
    expect(recs.length).toBe(1);
    expect(recs[0].length).toBeLessThanOrEqual(PREVIEW_MAX_RECORD_CHARS);
  });

  it('reports truncated when the parse bound cut the input', () => {
    const r = parsePreviewRows(runaway, 50, ',', '"');
    expect(r.truncated).toBe(true);
    expect(r.rows[0].join('').length).toBeLessThanOrEqual(PREVIEW_MAX_RECORD_CHARS);
  });

  it('stops scanning past the overall scan cap', () => {
    const text = 'a\n'.repeat(PREVIEW_MAX_SCAN_CHARS); // 2x the cap in chars
    const r = parsePreviewRows(text, 50, ',', '"');
    expect(r.rows.length).toBe(50);
    expect(r.truncated).toBe(true);
  });

  it('leaves normal records untouched', () => {
    expect(splitPreviewRecords('a,b\nc,d\n', '"', 10)).toEqual(['a,b', 'c,d']);
  });
});

/**
 * LOW-3: the server TI counts PHYSICAL LINES (it reads with an empty quote
 * char), while parsePreviewRows merges quoted multi-line records — the caller
 * needs the physical count to tell whether the TI stopped at its cap.
 */
describe('countPhysicalLines', () => {
  it('counts LF, CRLF and CR alike', () => {
    expect(countPhysicalLines('a\nb\nc\n')).toBe(3);
    expect(countPhysicalLines('a\r\nb\r\n')).toBe(2);
    expect(countPhysicalLines('a\rb\r')).toBe(2);
  });

  it('counts a trailing line without terminator', () => {
    expect(countPhysicalLines('a\nb')).toBe(2);
  });

  it('is 0 for empty text', () => {
    expect(countPhysicalLines('')).toBe(0);
  });

  it('does NOT merge quoted multi-line records — that is the whole point', () => {
    expect(countPhysicalLines('"a\nb",v\nx,y\n')).toBe(3);
    expect(parsePreviewRows('"a\nb",v\nx,y\n', 50, ',', '"').rows.length).toBe(2);
  });
});
