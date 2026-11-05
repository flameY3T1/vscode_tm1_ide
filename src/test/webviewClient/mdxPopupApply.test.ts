// New MDX text in the shared popup as ONE undoable step, not via
// setValue (that emptied the undo stack). Review 2026-09-23, W7.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyMdxToPopup } from '../../webviewClient/_shared/mdxPopupApply';

function rig(opts: { value?: string; withEditor?: boolean } = {}) {
  const textarea = { value: 'alt' };
  const node = {};
  const mount = { contains: (n: unknown) => n === node };
  const calls: string[] = [];
  const editor = {
    getModel: () => ({ getValue: () => opts.value ?? 'alt', getFullModelRange: () => 'ALL' }),
    getContainerDomNode: () => node,
    pushUndoStop: () => { calls.push('stop'); },
    executeEdits: (source: string, edits: Array<{ range: unknown; text: string }>) => {
      calls.push(`edit:${source}:${String(edits[0].range)}:${edits[0].text}`);
    },
  };
  vi.stubGlobal('document', {
    getElementById: (id: string) => (id === 'mdx-text' ? textarea : id === 'mdx-editor' ? mount : null),
  });
  vi.stubGlobal('window', { monaco: { editor: { getEditors: () => (opts.withEditor === false ? [] : [{ getContainerDomNode: () => ({}) }, editor]) } } });
  return { textarea, calls };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('applyMdxToPopup', () => {
  it('replaces the whole model between two undo stops, in the popup editor only', () => {
    const r = rig();
    expect(applyMdxToPopup('neu', true, 'format')).toBe(true);
    expect(r.calls).toEqual(['stop', 'edit:format:ALL:neu', 'stop']);
    expect(r.textarea.value).toBe('neu');
  });

  it('skips an unchanged text so no empty undo step lands', () => {
    const r = rig({ value: 'neu' });
    expect(applyMdxToPopup('neu', true, 'format')).toBe(false);
    expect(r.calls).toEqual([]);
  });

  it('falls back to the textarea when Monaco is not mounted or not found', () => {
    const a = rig();
    expect(applyMdxToPopup('neu', false, 'format')).toBe(false);
    expect(a.textarea.value).toBe('neu');
    expect(a.calls).toEqual([]);
    const b = rig({ withEditor: false });
    expect(applyMdxToPopup('neu', true, 'format')).toBe(false);
    expect(b.calls).toEqual([]);
  });
});
