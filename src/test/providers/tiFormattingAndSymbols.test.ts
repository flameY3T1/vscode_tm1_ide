import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { tiOutline, rulesOutline } from '../../tiLogicVisualizer/documentOutline';
import { TiSymbolProvider, RulesSymbolProvider } from '../../providers/tiSymbolProvider';
import { DEFAULT_FORMAT_CONFIG } from '../../tiLogicVisualizer/formatRules';
import { DEFAULT_RULE_FORMAT_CONFIG } from '../../tiLogicVisualizer/formatRulesText';
import { TiFormattingProvider, RulesFormattingProvider } from '../../providers/tiFormattingProvider';

// The stores read globalState through getExtensionContext, which no unit test
// activates — the providers only need a config, so hand them the defaults.
vi.mock('../../providers/formatConfigStore', () => ({
  loadFormatConfig: () => DEFAULT_FORMAT_CONFIG,
}));
vi.mock('../../providers/ruleFormatConfigStore', () => ({
  loadRuleFormatConfig: () => DEFAULT_RULE_FORMAT_CONFIG,
}));


/** Minimal TextDocument: the providers use getText, lineCount and lineAt only. */
function doc(text: string): vscode.TextDocument {
  const lines = text.split('\n');
  return {
    getText: () => text,
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] }),
  } as unknown as vscode.TextDocument;
}

describe('tiOutline', () => {
  it('names the mirrored sections after their #Region marker', () => {
    const text = [
      '#region prolog',      // 1
      "sName = 'x';",        // 2
      '#endregion prolog',   // 3
      '#region epilog',      // 4
      'ProcessQuit;',        // 5
      '#endregion epilog',   // 6
    ].join('\n');
    expect(tiOutline(text).map(n => [n.name, n.startLine, n.endLine])).toEqual([
      ['prolog', 1, 3],
      ['epilog', 4, 6],
    ]);
  });

  it('nests an inner region under its parent instead of listing it flat', () => {
    const text = [
      '#Region data',   // 1
      '#Region loop',   // 2
      'x = 1;',         // 3
      '#EndRegion',     // 4
      'y = 2;',         // 5
      '#EndRegion',     // 6
    ].join('\n');
    const roots = tiOutline(text);
    expect(roots.map(n => n.name)).toEqual(['data']);
    expect(roots[0].children.map(n => [n.name, n.startLine, n.endLine])).toEqual([['loop', 2, 4]]);
  });

  it('falls back to a placeholder for a nameless marker', () => {
    const text = ['#Region', 'x = 1;', 'y = 2;', '#EndRegion'].join('\n');
    expect(tiOutline(text).map(n => n.name)).toEqual(['region']);
  });
});

describe('rulesOutline', () => {
  it('lists the SKIPCHECK and FEEDERS sections and drops the trailing semicolon', () => {
    const text = [
      'SKIPCHECK;',              // 1
      "['Sales'] = N: 1;",       // 2
      "['Cost'] = N: 2;",        // 3
      'FEEDERS;',                // 4
      "['Sales'] => ['Cost'];",  // 5
    ].join('\n');
    expect(rulesOutline(text).map(n => [n.name, n.startLine, n.endLine])).toEqual([
      ['SKIPCHECK', 1, 3],
      ['FEEDERS', 4, 5],
    ]);
  });

  it('leaves comment runs out of the outline', () => {
    const text = ['# note one', '# note two', '# note three'].join('\n');
    expect(rulesOutline(text)).toEqual([]);
  });
});

describe('symbol providers', () => {
  it('maps outline nodes to 0-based DocumentSymbols with children', () => {
    const text = ['#Region data', '#Region loop', 'x = 1;', '#EndRegion', 'y = 2;', '#EndRegion'].join('\n');
    const syms = new TiSymbolProvider().provideDocumentSymbols(doc(text));
    expect(syms).toHaveLength(1);
    expect(syms[0].name).toBe('data');
    expect(syms[0].range.start.line).toBe(0);
    expect(syms[0].range.end.line).toBe(5);
    expect(syms[0].children.map(c => c.name)).toEqual(['loop']);
  });

  it('returns an empty outline for a rules file without sections', () => {
    expect(new RulesSymbolProvider().provideDocumentSymbols(doc("['a'] = N: 1;"))).toEqual([]);
  });
});

describe('formatting providers', () => {
  it('returns no edit when the TI text is already formatted', () => {
    const text = 'IF ( 1 = 1 );\n';
    const once = new TiFormattingProvider().provideDocumentFormattingEdits(doc(text));
    const formatted = once.length === 1 ? once[0].newText : text;
    // Second pass over the formatted text must be a no-op — idempotent formatter.
    expect(new TiFormattingProvider().provideDocumentFormattingEdits(doc(formatted))).toEqual([]);
  });

  it('replaces the whole TI document in one edit', () => {
    const edits = new TiFormattingProvider().provideDocumentFormattingEdits(doc('if(1=1);\nx=1;\nendif;'));
    expect(edits).toHaveLength(1);
    expect(edits[0].range.start.line).toBe(0);
    expect(edits[0].range.end.line).toBe(2);
    expect(edits[0].newText).toContain('IF');
  });

  it('formats rules text and stays idempotent', () => {
    const p = new RulesFormattingProvider();
    const first = p.provideDocumentFormattingEdits(doc("['Sales']=N:1;"));
    const text = first.length === 1 ? first[0].newText : "['Sales']=N:1;";
    expect(p.provideDocumentFormattingEdits(doc(text))).toEqual([]);
  });
});
