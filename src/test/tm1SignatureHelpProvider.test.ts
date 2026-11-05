import { describe, it, expect } from 'vitest';
import { Tm1SignatureHelpProvider } from '../providers/tm1SignatureHelpProvider';

function makeDoc(text: string) {
  const lines = text.split('\n');
  return {
    lineCount: lines.length,
    lineAt: (idx: number) => ({ text: lines[idx] ?? '' }),
    getText: () => text,
    uri: { toString: () => 'file:///t.pro', fsPath: '/t.pro' },
  } as any;
}

const provider = new Tm1SignatureHelpProvider();
const help = (line: string, character: number) =>
  provider.provideSignatureHelp(
    makeDoc(line),
    { line: 0, character } as any,
  );

describe('Tm1SignatureHelpProvider', () => {
  it('returns help for known function with cursor inside parens', () => {
    const text = "CellGetN('Sales', '";
    const sig = help(text, text.length);
    expect(sig).toBeDefined();
    expect(sig!.signatures).toHaveLength(1);
    expect(sig!.signatures[0].label).toContain('CellGetN');
    expect(sig!.signatures[0].label).toContain('CubeName');
    expect(sig!.activeSignature).toBe(0);
  });

  it('tracks activeParameter via comma count up to last param', () => {
    const text = "CellGetN('Sales', '";
    const sig = help(text, text.length);
    expect(sig!.activeParameter).toBe(1);

    // CellGetN has finite param list in KNOWN_SIGNATURES; commaCount is clamped to last index.
    const text2 = "CellGetN('A', 'B', 'C',";
    const sig2 = help(text2, text2.length);
    const lastIdx2 = sig2!.signatures[0].parameters.length - 1;
    expect(sig2!.activeParameter).toBe(Math.min(3, lastIdx2));
  });

  it('caps activeParameter at last param index', () => {
    const text = "ExecuteProcess('P',,,,,,,,";
    const sig = help(text, text.length);
    expect(sig).toBeDefined();
    const lastIdx = sig!.signatures[0].parameters.length - 1;
    expect(sig!.activeParameter).toBe(lastIdx);
  });

  it('returns undefined when cursor is outside any function call', () => {
    expect(help('plain text', 5)).toBeUndefined();
  });

  it('returns undefined for unknown function name', () => {
    expect(help("UnknownFunc('", 13)).toBeUndefined();
  });

  it('returns undefined when no opening paren before cursor', () => {
    expect(help("'a string'", 5)).toBeUndefined();
  });

  it('skips balanced inner parens when finding the outer call', () => {
    const text = "CellGetN('Sales', NumberToString(1+2), '";
    const sig = help(text, text.length);
    expect(sig).toBeDefined();
    expect(sig!.signatures[0].label).toContain('CellGetN');
    expect(sig!.activeParameter).toBe(2);
  });

  it('handles case-insensitive function names', () => {
    const sig = help("cellgetn('", 10);
    expect(sig).toBeDefined();
    expect(sig!.signatures[0].label).toContain('CellGetN');
  });

  it('exposes parameter info per param', () => {
    const sig = help("CellGetN('", 10);
    expect(sig!.signatures[0].parameters.length).toBeGreaterThan(0);
    expect(sig!.signatures[0].parameters[0].label).toContain('CubeName');
  });
});
