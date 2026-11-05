import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

vi.mock('../../tm1Rest/client', () => ({
  apiRequest: vi.fn(),
  apiRequestBinary: vi.fn(),
}));

import * as vscode from 'vscode';
import { apiRequest, apiRequestBinary } from '../../tm1Rest/client';
import { handleAsciiPreview, readLocalBounded } from '../../commands/processEditor/asciiPreview';
import { parsePreviewRows } from '../../commands/processEditor/asciiPreviewPure';

/**
 * M10: the local preview read must be BOUNDED — it may not pull a whole
 * multi-hundred-MB CSV into memory to show 50 rows — and must decode like the
 * server path (UTF-8 strict, Windows-1252 fallback, BOM stripped).
 */
describe('readLocalBounded', () => {
  let dir: string;
  const p = (name: string) => path.join(dir, name);

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-ascii-preview-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('stops after maxRecords records instead of reading the whole file', async () => {
    const file = p('big.csv');
    // ~5 MB — a full read would return every line.
    const filler = 'x'.repeat(100);
    fs.writeFileSync(file, Array.from({ length: 50_000 }, (_, i) => `${i},${filler}`).join('\n') + '\n');

    const text = await readLocalBounded(file, 11, '"');
    // Stream granularity is one chunk (64 KB), so a few hundred extra lines can
    // ride along — but nothing near the 5 MB the old readFile() pulled in.
    expect(text.length).toBeLessThanOrEqual(128 * 1024);
    expect(text.startsWith('0,')).toBe(true);
  });

  it('feeds parsePreviewRows enough to mark truncated', async () => {
    const file = p('trunc.csv');
    fs.writeFileSync(file, Array.from({ length: 100 }, (_, i) => `${i},v`).join('\n') + '\n');

    const text = await readLocalBounded(file, 11, '"');
    const r = parsePreviewRows(text, 10, ',', '"');
    expect(r.rows.length).toBe(10);
    expect(r.truncated).toBe(true);
  });

  it('does not report truncation when the file has exactly maxLines records', async () => {
    const file = p('exact.csv');
    fs.writeFileSync(file, Array.from({ length: 10 }, (_, i) => `${i},v`).join('\n') + '\n');

    const text = await readLocalBounded(file, 11, '"');
    const r = parsePreviewRows(text, 10, ',', '"');
    expect(r.rows.length).toBe(10);
    expect(r.truncated).toBe(false);
  });

  it('does not cut a record whose quoted field spans several lines', async () => {
    const file = p('multiline.csv');
    fs.writeFileSync(file, 'h1,h2\n"a\nb\nc",v\nlast,row\n');

    const text = await readLocalBounded(file, 3, '"');
    const r = parsePreviewRows(text, 2, ',', '"');
    expect(r.rows).toEqual([['h1', 'h2'], ['a\nb\nc', 'v']]);
    expect(r.truncated).toBe(true);
  });

  it('decodes Windows-1252 umlauts instead of emitting replacement chars', async () => {
    const file = p('cp1252.csv');
    fs.writeFileSync(file, Buffer.from([0x4d, 0xfc, 0x6c, 0x6c, 0x65, 0x72, 0x2c, 0x31, 0x0a])); // "Müller,1\n"

    const text = await readLocalBounded(file, 5, '"');
    expect(text).toContain('Müller');
    expect(text).not.toContain('�');
  });

  it('strips a UTF-8 BOM so it cannot hide in the first column header', async () => {
    const file = p('bom.csv');
    fs.writeFileSync(file, '﻿id,name\n1,x\n', 'utf8');

    const text = await readLocalBounded(file, 5, '"');
    const r = parsePreviewRows(text, 50, ',', '"');
    expect(r.rows[0][0]).toBe('id');
  });

  it('stops on the byte cap when a quote is never closed', async () => {
    const file = p('unterminated.csv');
    fs.writeFileSync(file, 'a,"' + 'y\n'.repeat(200_000));

    const text = await readLocalBounded(file, 5, '"');
    expect(text.length).toBeLessThanOrEqual(32 * 1024 * 1024);
    expect(text.startsWith('a,"')).toBe(true);
  });

  it('rejects for a missing file so the caller falls through to the error message', async () => {
    await expect(readLocalBounded(p('nope.csv'), 5, '"')).rejects.toBeTruthy();
  });
});

/**
 * MED-1: the bounded read keeps whole 64 KiB chunks, so the last kept chunk can
 * end INSIDE a 2/3/4-byte UTF-8 sequence. `decodeServerText` decodes strictly,
 * so that single dangling byte used to drop the ENTIRE preview to the
 * Windows-1252 fallback — every umlaut in the file turned into mojibake.
 */
describe('readLocalBounded — chunk-boundary UTF-8', () => {
  let dir: string;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm1-ascii-boundary-'));
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  });

  it('does not mojibake the whole preview when a char straddles the 64 KiB boundary', async () => {
    const file = path.join(dir, 'boundary.csv');
    // 'a\nx' = 3 bytes, then 2-byte 'ä's → one starts at byte 65535, so its
    // second byte lands in the NEXT chunk. The read stops after record 1.
    fs.writeFileSync(file, Buffer.from('a\nx' + 'ä'.repeat(40_000) + '\ntail\n', 'utf8'));

    const text = await readLocalBounded(file, 1, '"');

    expect(text.startsWith('a\nx')).toBe(true);
    expect(text).toContain('ä');
    expect(text).not.toContain('Ã');       // CP1252 fallback artefact
    expect(text).not.toContain('�');  // replacement char
  });

  it('keeps a file that ends mid-sequence only at the read boundary, not at EOF', async () => {
    const file = path.join(dir, 'small.csv');
    fs.writeFileSync(file, Buffer.from('ä,ö\nü,ß\n', 'utf8'));

    const text = await readLocalBounded(file, 50, '"');
    expect(text).toBe('ä,ö\nü,ß\n');
  });
});

/** Minimal panel stub — records what the webview would receive. */
function fakePanel(): { panel: any; posted: any[] } {
  const posted: any[] = [];
  return { panel: { webview: { postMessage: (m: any) => { posted.push(m); return Promise.resolve(true); } } }, posted };
}

const CFG: any = { serverUrl: 'http://x', username: 'u', password: 'p', authType: 'basic' };

describe('handleAsciiPreview', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
    vi.mocked(apiRequestBinary).mockReset();
    vi.mocked(vscode.window.showWarningMessage).mockReset().mockResolvedValue(undefined as never);
  });

  /**
   * LOW-2: `buildServerPreviewProcess` throws on a bad log name OUTSIDE any try,
   * and the local-read confirm prompt is unguarded too — an unexpected throw used
   * to escape handleAsciiPreview and leave the webview spinner running forever
   * with no message at all.
   */
  it('posts an error instead of leaving the spinner hanging when a step throws', async () => {
    vi.mocked(apiRequest).mockRejectedValue(new Error('no server'));
    vi.mocked(vscode.window.showWarningMessage).mockRejectedValue(new Error('prompt exploded') as never);
    const { panel, posted } = fakePanel();

    await expect(handleAsciiPreview(panel, { filePath: path.resolve('/tmp/does-not-exist.csv'), maxLines: 10 }, CFG))
      .resolves.toBeUndefined();

    expect(posted.length).toBe(1);
    expect(posted[0].type).toBe('asciiPreview');
    expect(String(posted[0].error)).toContain('prompt exploded');
  });

  /**
   * LOW-3: the server TI reads with an EMPTY quote char, so it ProcessBreaks after
   * maxLines+1 PHYSICAL LINES, while parsePreviewRows merges quoted multi-line
   * records. A file with embedded newlines therefore yields fewer rows than asked
   * for and used to report `truncated:false` even though the TI stopped at its cap.
   */
  function mockServerLog(text: string): void {
    vi.mocked(apiRequest).mockImplementation(((method: string) =>
      Promise.resolve(method === 'DELETE' ? { statusCode: 204, body: '' } : { statusCode: 200, body: '{}' })) as never);
    vi.mocked(apiRequestBinary).mockResolvedValue({ statusCode: 200, body: Buffer.from(text, 'utf8') } as never);
  }

  it('reports truncated when the server TI stopped at its physical-line cap', async () => {
    // maxLines 10 → the TI is asked for 11 lines. Five 2-line records + 1 = 11
    // lines, but only 6 RECORDS — fewer than the 10 rows requested.
    mockServerLog('"a\nb",v\n'.repeat(5) + 'x,y\n');
    const { panel, posted } = fakePanel();

    await handleAsciiPreview(panel, { filePath: 'C:\\data\\x.csv', maxLines: 10 }, CFG);

    expect(posted[0].source).toBe('server');
    expect(posted[0].rows.length).toBe(6);
    expect(posted[0].truncated).toBe(true);
  });

  it('does not claim truncation when the server returned fewer lines than asked for', async () => {
    mockServerLog('"a\nb",v\nx,y\n');
    const { panel, posted } = fakePanel();

    await handleAsciiPreview(panel, { filePath: 'C:\\data\\x.csv', maxLines: 10 }, CFG);

    expect(posted[0].rows.length).toBe(2);
    expect(posted[0].truncated).toBe(false);
  });

  /**
   * A failed inline run answers HTTP 201 with `ProcessExecuteStatusCode:
   * "Aborted"` and leaves the reason in the error log it wrote alongside.
   * Swallowing that is what turned "the datasource path does not exist on this
   * server" into a bare "preview does not work" (reported 2026-07-26 for a v12
   * process pointing at a v11 Windows path).
   */
  it('surfaces the server error when the preview process aborts', async () => {
    vi.mocked(apiRequest).mockImplementation(((method: string, url: string) => {
      if (method === 'POST') { return Promise.resolve({ statusCode: 201, body: '{"ProcessExecuteStatusCode":"Aborted"}' }); }
      if (url === 'ErrorLogFiles') {
        return Promise.resolve({ statusCode: 200, body: JSON.stringify({ value: [{ Filename: 'TM1ProcessError_20260726074849_41623148_}tm1ide_dspreview.log' }] }) });
      }
      if (url.startsWith('ErrorLogFiles(')) {
        return Promise.resolve({ statusCode: 200, body: 'Error: Prolog procedure line (0): Unable to open data source "C:\\nope.txt".' });
      }
      return Promise.resolve({ statusCode: 204, body: '' });
    }) as never);
    const { panel, posted } = fakePanel();

    await handleAsciiPreview(panel, { filePath: 'C:\\nope.txt', maxLines: 10 }, CFG);

    expect(posted).toHaveLength(1);
    expect(String(posted[0].error)).toContain('Aborted');
    expect(String(posted[0].error)).toContain('Unable to open data source');
  });

  /**
   * v12 serves the data directory as the `Files` content space, so the preview
   * reads the datasource straight out of it — no transient process, nothing to
   * clean up. Live-verified 2026-07-26.
   */
  it('v12 reads the file directly via Contents(Files) and runs no process at all', async () => {
    const V12: any = { ...CFG, version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s' } };
    vi.mocked(apiRequestBinary).mockResolvedValue({ statusCode: 200, body: Buffer.from('a;b\r\n1;2\r\n', 'utf8') } as never);
    const { panel, posted } = fakePanel();

    await handleAsciiPreview(panel, { filePath: 'lala.txt', maxLines: 10, delimiter: ';' }, V12);

    expect(vi.mocked(apiRequestBinary).mock.calls[0][1]).toBe("Contents('Files')/Contents('lala.txt')/Content");
    expect(vi.mocked(apiRequest)).not.toHaveBeenCalled();   // no ExecuteProcessWithReturn
    expect(posted[0].source).toBe('server');
    expect(posted[0].rows).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('v12 falls back to the TI read and captures into the Files space', async () => {
    const V12: any = { ...CFG, version: 'v12', v12: { instance: 'tm1', database: 'db', authMode: 'basic-s2s' } };
    let call = 0;
    vi.mocked(apiRequestBinary).mockImplementation((() => {
      call++;
      // 1st = direct read (miss), 2nd = capture-file read (hit)
      return Promise.resolve(call === 1
        ? { statusCode: 404, body: Buffer.alloc(0) }
        : { statusCode: 200, body: Buffer.from('a;b\r\n', 'utf8') });
    }) as never);
    vi.mocked(apiRequest).mockImplementation(((method: string) =>
      Promise.resolve(method === 'DELETE' ? { statusCode: 204, body: '' } : { statusCode: 201, body: '{"ProcessExecuteStatusCode":"CompletedSuccessfully"}' })) as never);
    const { panel, posted } = fakePanel();

    await handleAsciiPreview(panel, { filePath: 'lala.txt', maxLines: 10, delimiter: ';' }, V12);

    // The transient process must write a BARE name — a file under
    // GetProcessErrorFileDirectory() cannot be read back on v12.
    const sent = JSON.parse(String(vi.mocked(apiRequest).mock.calls[0][2]));
    expect(sent.Process.MetadataProcedure).toContain("sO = 'tm1ide_dspreview_");
    expect(sent.Process.MetadataProcedure).not.toContain('GetProcessErrorFileDirectory');
    // …and both the read-back and the cleanup address it in the Files space.
    expect(String(vi.mocked(apiRequestBinary).mock.calls[1][1])).toMatch(/^Contents\('Files'\)\/Contents\('tm1ide_dspreview_.*'\)\/Content$/);
    const del = vi.mocked(apiRequest).mock.calls.find(c => c[0] === 'DELETE');
    expect(String(del?.[1])).toMatch(/^Contents\('Files'\)\/Contents\('tm1ide_dspreview_.*'\)$/);
    expect(posted[0].source).toBe('server');
  });
});
