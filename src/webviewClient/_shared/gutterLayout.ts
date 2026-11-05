/**
 * Reports the right edge of the line numbers as a CSS variable to the editor —
 * shared computation for the process and rule editors (CSS side:
 * `src/webviews/monacoGutterCss.ts`).
 *
 * The third divider line of the gutter (numbers | fold column) cannot be
 * attached to a Monaco element like the other two: there is no node of its own
 * for the number column, only a `div.line-numbers` per line — an edge on those
 * ended at the last line instead of at the bottom edge. It is therefore drawn as
 * a gradient on `.margin`, and for that the stylesheet has to know the edge.
 *
 * `onDidLayoutChange`, not once: the width depends on the digit count of the
 * largest line number and jumps when switching between sections
 * (99 lines of Prolog, 1200 lines of Data).
 */
export interface GutterLayoutEditor {
  getLayoutInfo(): { lineNumbersLeft: number; lineNumbersWidth: number };
  onDidLayoutChange(listener: () => void): unknown;
}

export interface GutterLayoutMount {
  style: { setProperty(name: string, value: string): void };
}

export function initGutterNumbersRightVar(
  editor: GutterLayoutEditor,
  mount: GutterLayoutMount,
): void {
  const apply = (): void => {
    const li = editor.getLayoutInfo();
    mount.style.setProperty('--tm1-numbers-right', `${li.lineNumbersLeft + li.lineNumbersWidth}px`);
  };
  apply();
  editor.onDidLayoutChange(apply);
}
