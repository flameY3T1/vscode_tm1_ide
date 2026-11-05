/**
 * Gutter for Monaco editors (process and rule editor): visual
 * glyph column | line numbers | folding column | code.
 *
 * Monaco builds a strip on the left (.margin) of three columns and lets them run
 * into each other unseparated: the line numbers stuck to the code, and the
 * breakpoint column could not be recognized as an area of its own at all. Both
 * borders therefore get a line, the breakpoint column additionally a
 * light tone.
 *
 * .margin is exactly as wide as contentLeft, so its right edge lies
 * exactly where the editable text begins. The inner .glyph-margin
 * covers exactly the breakpoint column (Monaco sets width and position
 * itself, see viewParts/margin). Both are Monaco's own elements —
 * no nodes of our own, no calculation in JS. In the rule editor the
 * glyph column stays without breakpoint interaction, the rule is the same anyway.
 *
 * Shades of gray instead of theme colors: the lines should stay quiet in light and dark
 * themes alike; a theme border (panel-border) looked too
 * heavy in the dark.
 *
 * The main edge sits behind the NUMBERS, not at the start of the text: the
 * folding column belongs to the code — its arrows refer to blocks in the
 * text, not to the gutter — and stood on the wrong side in front of the edge.
 * To the right of the line lies thus everything that belongs to the source text;
 * to the left only what addresses it (breakpoint, line number).
 *
 * Drawn as a gradient because there is no node of its own for the number column
 * (only one div.line-numbers per line, whose edge ended at the last line
 * instead of at the bottom edge). init.ts (or
 * gutterLayout.ts in the rule editor) reports the spot as --tm1-numbers-right; if it is missing,
 * the gradient falls back to 0px and is invisible.
 *
 * No border-right on .margin: a second line at the start of the text would have
 * boxed in the folding column again, exactly what was supposed to go here.
 *
 * The number column is right-aligned and exactly lineNumbersWidth wide: without
 * padding the number ends exactly at the edge to the folding column and sticks to the
 * arrow. box-sizing explicitly, because Monaco sets the width as an inline style
 * — with content-box the padding would push the number TO THE RIGHT into the
 * neighbouring column instead of inwards.
 */
export const MONACO_GUTTER_CSS = `
  .monaco-editor .margin {
    background-image: linear-gradient(to right,
      transparent 0, transparent calc(var(--tm1-numbers-right, 0px) - 1px),
      rgba(128, 128, 128, 0.28) calc(var(--tm1-numbers-right, 0px) - 1px),
      rgba(128, 128, 128, 0.28) var(--tm1-numbers-right, 0px),
      transparent var(--tm1-numbers-right, 0px));
  }
  .monaco-editor .margin .glyph-margin {
    background: rgba(128, 128, 128, 0.08);
    border-right: 1px solid rgba(128, 128, 128, 0.18);
  }
  .monaco-editor .margin-view-overlays .line-numbers {
    box-sizing: border-box;
    padding-right: 8px;
  }
`;
