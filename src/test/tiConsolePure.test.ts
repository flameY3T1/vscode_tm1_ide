import { describe, it, expect } from 'vitest';
import { terminateTiSnippet, addTiHistory, type TiHistoryEntry } from '../webviews/tiConsolePure';

describe('terminateTiSnippet', () => {
  it('adds the missing semicolon — the reported case', () => {
    // `SaveDataAll()` does not compile, `SaveDataAll();` does.
    expect(terminateTiSnippet('SaveDataAll()')).toBe('SaveDataAll();');
  });

  it('leaves an already terminated statement alone', () => {
    expect(terminateTiSnippet('SaveDataAll();')).toBe('SaveDataAll();');
  });

  it('adds it only to the LAST line with code', () => {
    expect(terminateTiSnippet("nX = 1;\nCubeProcessFeeders('Sales')"))
      .toBe("nX = 1;\nCubeProcessFeeders('Sales');");
  });

  it('skips blank lines and pure comment lines at the end', () => {
    expect(terminateTiSnippet('SaveDataAll()\n# fertig\n\n'))
      .toBe('SaveDataAll();\n# fertig\n\n');
  });

  it('puts it BEFORE a trailing comment', () => {
    expect(terminateTiSnippet('SaveDataAll()  # alles sichern'))
      .toBe('SaveDataAll();  # alles sichern');
  });

  it('treats a hash sign INSIDE a string as text', () => {
    // The process name carries the `#` — no comment starts behind it, the
    // semicolon belongs at the end of the line.
    expect(terminateTiSnippet("ExecuteProcess('##sleep')"))
      .toBe("ExecuteProcess('##sleep');");
  });

  it('leaves a snippet without any code unchanged', () => {
    expect(terminateTiSnippet('# nur ein Kommentar')).toBe('# nur ein Kommentar');
    expect(terminateTiSnippet('')).toBe('');
  });
});

describe('addTiHistory', () => {
  const e = (code: string, ts = 1): TiHistoryEntry => ({ code, timestamp: ts, elapsedMs: 5, ok: true });

  it('puts the new entry at the front', () => {
    expect(addTiHistory([e('a')], e('b', 2)).map(x => x.code)).toEqual(['b', 'a']);
  });

  it('keeps the same snippet only once — with the LAST result', () => {
    const vorher = [e('SaveDataAll();', 1), e('b', 1)];
    const nachher = addTiHistory(vorher, { ...e(' SaveDataAll(); ', 9), ok: false });
    expect(nachher.map(x => x.code.trim())).toEqual(['SaveDataAll();', 'b']);
    expect(nachher[0].ok).toBe(false);
    expect(nachher[0].timestamp).toBe(9);
  });

  it('caps the list and drops the oldest', () => {
    const voll = Array.from({ length: 3 }, (_v, i) => e(`c${i}`));
    expect(addTiHistory(voll, e('neu'), 3).map(x => x.code)).toEqual(['neu', 'c0', 'c1']);
  });
});
