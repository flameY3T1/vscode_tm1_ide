// Pure: true if one of the row/col dims has an active element/subset filter.
type Sel = { kind: string; names?: string[]; expression?: string };

export function hasAxisElementFilter(
  rowDims: string[],
  colDims: string[],
  dimSelections: Record<string, Sel>,
): boolean {
  return [...rowDims, ...colDims].some((d) => {
    const s = dimSelections[d];
    if (!s) { return false; }
    if (s.kind === 'elements') { return Array.isArray(s.names) && s.names.length > 0; }
    if (s.kind === 'consolidation') { return true; }
    // "All" is a statement about the axis even if it carries no names: the MDX
    // view has to be rebuilt, otherwise the refresh would only rewrite the
    // slicer and the axis would remain that of the saved view.
    if (s.kind === 'all') { return true; }
    // An expression is the strongest statement about the axis there is: it
    // REPLACES it. Without this branch the axis of the saved view would remain
    // and the refresh would only rewrite the slicer.
    if (s.kind === 'expression') { return !!s.expression; }
    return false;
  });
}
