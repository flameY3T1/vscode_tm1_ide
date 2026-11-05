import {
  initGutterNumbersRightVar,
  type GutterLayoutEditor,
  type GutterLayoutMount,
} from '../_shared/gutterLayout';

/** Adds the Process Editor's complete gutter footprint, without interactions. */
export function withRuleEditorGutter<T extends object>(options: T): T & {
  lineDecorationsWidth: number;
  glyphMargin: boolean;
} {
  return {
    ...options,
    lineDecorationsWidth: 16,
    glyphMargin: true,
  };
}

/** Keeps the full-height separator aligned with Monaco's line-number column. */
export function initRuleEditorGutterLayout(
  editor: GutterLayoutEditor,
  mount: GutterLayoutMount,
): void {
  initGutterNumbersRightVar(editor, mount);
}
