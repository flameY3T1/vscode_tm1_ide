import { describe, expect, it, vi } from 'vitest';
import {
  initRuleEditorGutterLayout,
  withRuleEditorGutter,
} from '../webviewClient/ruleEditorMonaco/gutterLayout';

describe('initRuleEditorGutterLayout', () => {
  it('adds the same visible glyph strip without changing unrelated editor options', () => {
    expect(withRuleEditorGutter({ lineNumbers: 'on', folding: true })).toEqual({
      lineNumbers: 'on',
      folding: true,
      lineDecorationsWidth: 16,
      glyphMargin: true,
    });
  });

  it('keeps the line-number separator aligned after Monaco layout changes', () => {
    let layout = { lineNumbersLeft: 18, lineNumbersWidth: 31 };
    let onLayoutChange: (() => void) | undefined;
    const setProperty = vi.fn();
    const editor = {
      getLayoutInfo: () => layout,
      onDidLayoutChange: (listener: () => void) => { onLayoutChange = listener; },
    };

    initRuleEditorGutterLayout(editor, { style: { setProperty } });
    expect(setProperty).toHaveBeenLastCalledWith('--tm1-numbers-right', '49px');

    layout = { lineNumbersLeft: 18, lineNumbersWidth: 39 };
    onLayoutChange?.();
    expect(setProperty).toHaveBeenLastCalledWith('--tm1-numbers-right', '57px');
  });
});
