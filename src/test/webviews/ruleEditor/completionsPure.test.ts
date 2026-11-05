import { describe, it, expect } from 'vitest';
import {
  buildSignatureLabel,
  buildSnippetInsertText,
  buildMarkdownDoc,
  getFuncArgContext,
  buildCubeInsertText,
} from '../../../webviewClient/ruleEditorMonaco/completionsPure';
import type { FunctionSignature } from '../../../webviewClient/_shared/tiSignatureRender';

const sig = (overrides: Partial<FunctionSignature> = {}): FunctionSignature => ({
  name: 'DimNm',
  params: [{ name: 'dim', type: 'string' }, { name: 'idx', type: 'numeric' }],
  minParams: 2,
  maxParams: 2,
  returnType: 'string',
  ...overrides,
});

describe('buildSignatureLabel', () => {
  it('renders Name(p1, p2)', () => {
    expect(buildSignatureLabel(sig())).toBe('DimNm(dim, idx)');
  });
  it('appends ", ..." for variadic (maxParams === Infinity)', () => {
    expect(buildSignatureLabel(sig({ name: 'Max', maxParams: Infinity }))).toBe('Max(dim, idx, ...)');
  });
  it('renders empty param list as Name()', () => {
    expect(buildSignatureLabel(sig({ name: 'Now', params: [] }))).toBe('Now()');
  });
});

describe('buildSnippetInsertText', () => {
  it('returns Name() for zero-param signature', () => {
    expect(buildSnippetInsertText(sig({ name: 'Now', params: [] }))).toBe('Now()');
  });
  it('wraps string-typed params in single quotes', () => {
    const out = buildSnippetInsertText(sig());
    expect(out).toBe("DimNm('${1:dim}', ${2:idx})");
  });
  it('emits only minParams placeholders for variadic', () => {
    const out = buildSnippetInsertText(sig({
      name: 'Max',
      params: [{ name: 'a', type: 'numeric' }, { name: 'b', type: 'numeric' }, { name: 'c', type: 'numeric' }],
      minParams: 2,
      maxParams: Infinity,
    }));
    expect(out).toBe('Max(${1:a}, ${2:b})');
  });
  it('caps placeholder count to params.length even when minParams larger', () => {
    const out = buildSnippetInsertText(sig({
      name: 'Foo',
      params: [{ name: 'x', type: 'numeric' }],
      minParams: 5,
      maxParams: Infinity,
    }));
    expect(out).toBe('Foo(${1:x})');
  });
});

describe('buildMarkdownDoc', () => {
  it('renders fenced TI signature block', () => {
    const out = buildMarkdownDoc(sig());
    expect(out).toContain('```ti\nDimNm(dim, idx)\n```');
  });
  it('includes description when present', () => {
    expect(buildMarkdownDoc(sig({ description: 'Get name.' }))).toContain('Get name.');
  });
  it('omits Parameter section for empty params', () => {
    const out = buildMarkdownDoc(sig({ name: 'Now', params: [] }));
    expect(out).not.toContain('**Parameters:**');
  });
  it('renders parameter list with type and doc', () => {
    const out = buildMarkdownDoc(sig({
      params: [{ name: 'dim', type: 'string', doc: 'Dimension name' }, { name: 'idx', type: 'numeric' }],
    }));
    expect(out).toContain('- `dim` *(string)* — Dimension name');
    expect(out).toContain('- `idx` *(numeric)*');
  });
  it('includes return type', () => {
    expect(buildMarkdownDoc(sig())).toContain('**Returns:** *string*');
  });
  it('adds variadic note when maxParams Infinity', () => {
    const out = buildMarkdownDoc(sig({ maxParams: Infinity, minParams: 2 }));
    expect(out).toContain('Variadic: at least 2 arguments');
  });
  it('adds deprecation warning when deprecatedInV12', () => {
    expect(buildMarkdownDoc(sig({ deprecatedInV12: true }))).toContain('TM1 v12');
  });
  it('appends IBM docs link when docUrl set', () => {
    const out = buildMarkdownDoc(sig({ docUrl: 'https://example.test/docs' }));
    expect(out).toContain('[IBM Docs](https://example.test/docs)');
  });
});

describe('getFuncArgContext', () => {
  it('returns null when no open string at end', () => {
    expect(getFuncArgContext("DimNm('Product'")).toBeNull();
    expect(getFuncArgContext('plain text')).toBeNull();
  });
  it('detects 0th arg in fresh call', () => {
    expect(getFuncArgContext("DimNm('")).toEqual({ funcName: 'dimnm', argIdx: 0, args: [] });
  });
  it('detects argIdx 1 after first completed string arg', () => {
    const out = getFuncArgContext("DimNm('Product', '");
    expect(out).toEqual({ funcName: 'dimnm', argIdx: 1, args: ['Product'] });
  });
  it('collects multiple completed string args', () => {
    const out = getFuncArgContext("AttrS('Region', 'EMEA', '");
    expect(out).toEqual({ funcName: 'attrs', argIdx: 2, args: ['Region', 'EMEA'] });
  });
  it('lowercases funcName', () => {
    expect(getFuncArgContext("DB('")!.funcName).toBe('db');
  });
  it('returns null when no function name before paren', () => {
    expect(getFuncArgContext("('")).toBeNull();
  });
  it('skips nested parens at deeper depth', () => {
    const out = getFuncArgContext("DimNm(1 + (2 * 3), '");
    expect(out).toEqual({ funcName: 'dimnm', argIdx: 1, args: [] });
  });
});

describe('buildCubeInsertText', () => {
  it('returns name with closing quote for zero-dim cube', () => {
    expect(buildCubeInsertText('Plan', [], new Set())).toEqual({
      insertText: "Plan'",
      isSnippet: false,
    });
  });
  it('emits placeholders for non-rule dims', () => {
    const out = buildCubeInsertText('Plan', ['Region', 'Period'], new Set());
    expect(out).toEqual({
      insertText: "Plan', '${1:Region}', '${2:Period}'",
      isSnippet: true,
    });
  });
  it('uses !Dim for dims in the rule cube (case-insensitive)', () => {
    const ruleDims = new Set(['region']);
    const out = buildCubeInsertText('Plan', ['Region', 'Period'], ruleDims);
    expect(out.insertText).toBe("Plan', !Region, '${1:Period}'");
    expect(out.isSnippet).toBe(true);
  });
  it('isSnippet false when ALL dims are rule-resolved (no placeholders)', () => {
    const ruleDims = new Set(['region', 'period']);
    const out = buildCubeInsertText('Plan', ['Region', 'Period'], ruleDims);
    expect(out.insertText).toBe("Plan', !Region, !Period");
    expect(out.isSnippet).toBe(false);
  });
  it('placeholder index increments only for non-rule dims', () => {
    const ruleDims = new Set(['period']);
    const out = buildCubeInsertText('Plan', ['Region', 'Period', 'Measure'], ruleDims);
    expect(out.insertText).toBe("Plan', '${1:Region}', !Period, '${2:Measure}'");
  });
});
