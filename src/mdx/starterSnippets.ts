/**
 * Static starter templates for the MDX runner (phase 7).
 * Placeholders such as `Cube`, `Dim` are deliberately generic — the user replaces
 * them after inserting. On first use the MDX linter in Monaco gives
 * syntax highlighting, so it is clear where editing is needed.
 */
export interface StarterSnippet {
  label: string;
  description: string;
  mdx: string;
}

export const STARTER_SNIPPETS: StarterSnippet[] = [
  {
    label: 'Basic — Cols + Rows',
    description: 'Simple crosstab: two dimensions on axes',
    mdx:
`SELECT
  {[Dim1].MEMBERS} ON COLUMNS,
  {[Dim2].MEMBERS} ON ROWS
FROM [Cube]`,
  },
  {
    label: 'NON EMPTY + WHERE',
    description: 'Hide rows with zero values, fix the slicer on one element',
    mdx:
`SELECT
  NON EMPTY {[Kennzahl].MEMBERS} ON COLUMNS,
  NON EMPTY {[Fakultaet].MEMBERS} ON ROWS
FROM [Cube]
WHERE ([Semester].[Alle_Semester])`,
  },
  {
    label: 'Top 10',
    description: 'TOPCOUNT: largest 10 elements by a measure',
    mdx:
`SELECT
  {[Kennzahl].[Ist_SWS]} ON 0,
  TOPCOUNT({[Fakultaet].MEMBERS}, 10, [Kennzahl].[Ist_SWS]) ON 1
FROM [Cube]`,
  },
  {
    label: 'CROSSJOIN',
    description: 'Combine two dimensions on one axis',
    mdx:
`SELECT
  {[Kennzahl].MEMBERS} ON 0,
  NON EMPTY CROSSJOIN(
    {[Fakultaet].MEMBERS},
    {[Version].MEMBERS}
  ) ON 1
FROM [Cube]`,
  },
  {
    label: 'TM1SUBSETALL',
    description: 'All elements of a dimension (TM1 idiom)',
    mdx:
`SELECT
  {[Kennzahl].MEMBERS} ON 0,
  {TM1SUBSETALL([Fakultaet])} ON 1
FROM [Cube]`,
  },
  {
    label: 'Children of element',
    description: 'Only direct children of a consolidation element',
    mdx:
`SELECT
  {[Kennzahl].MEMBERS} ON 0,
  {[Fakultaet].[Alle_Fakultaeten].CHILDREN} ON 1
FROM [Cube]`,
  },
  {
    label: 'DESCENDANTS (Leaves)',
    description: 'All leaf elements under a node (LEAVES flag)',
    mdx:
`SELECT
  {[Kennzahl].MEMBERS} ON 0,
  DESCENDANTS([Fakultaet].[Alle_Fakultaeten], , LEAVES) ON 1
FROM [Cube]`,
  },
  {
    label: 'FILTER by attribute',
    description: 'TM1FILTERBYPATTERN for elements with a pattern in the name',
    mdx:
`SELECT
  {[Kennzahl].MEMBERS} ON 0,
  TM1FILTERBYPATTERN({[Fakultaet].MEMBERS}, '*wissenschaft*') ON 1
FROM [Cube]`,
  },
];
