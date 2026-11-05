import { describe, it, expect } from 'vitest';
import {
  buildSnippetInsertText,
  buildMarkdownDoc,
  type FunctionSignature,
} from '../../../webviewClient/_shared/tiSignatureRender';

const sig = (o: Partial<FunctionSignature> = {}): FunctionSignature => ({
  name: 'Foo',
  params: [],
  minParams: 0,
  maxParams: 0,
  returnType: 'numeric',
  ...o,
});

describe('tiSignatureRender — superset semantics (S3)', () => {
  it('0-arg void statement inserts a bare name (no parens)', () => {
    expect(buildSnippetInsertText(sig({ name: 'ProcessBreak', returnType: 'void' }))).toBe('ProcessBreak');
  });

  it('0-arg non-void func still gets Name()', () => {
    expect(buildSnippetInsertText(sig({ name: 'Now', returnType: 'numeric' }))).toBe('Now()');
  });

  it('renders the performance-note hint when present', () => {
    const out = buildMarkdownDoc(sig({
      name: 'CellGetN',
      performanceNote: { recommended: 'Data', reason: 'Cell-Loop' },
    }));
    expect(out).toContain('💡 **Performance:**');
    expect(out).toContain('`Data`');
    expect(out).toContain('Cell-Loop');
  });

  it('omits the performance hint when absent', () => {
    expect(buildMarkdownDoc(sig())).not.toContain('Performance:');
  });
});
