import { describe, it, expect } from 'vitest';
import { rewriteMdxSlicer } from '../webviewClient/cubeViewerMonaco/mdxSlicerPure';

describe('rewriteMdxSlicer', () => {
  it('replaces an existing WHERE slicer with current title assignments', () => {
    const mdx = 'SELECT {} ON COLUMNS, {} ON ROWS FROM [Sales] WHERE ([Time].[Time].[2023])';
    const out = rewriteMdxSlicer(mdx, { Time: '2024' });
    expect(out).toBe('SELECT {} ON COLUMNS, {} ON ROWS FROM [Sales]\nWHERE ([Time].[Time].[2024])');
  });

  it('appends a WHERE when none exists', () => {
    const mdx = 'SELECT {} ON COLUMNS, {} ON ROWS FROM [Sales]';
    const out = rewriteMdxSlicer(mdx, { Time: '2024' });
    expect(out).toBe('SELECT {} ON COLUMNS, {} ON ROWS FROM [Sales]\nWHERE ([Time].[Time].[2024])');
  });

  it('preserves WITH MEMBER and SELECT axes verbatim', () => {
    const mdx = 'WITH MEMBER [M].[x] AS 1 SELECT {[M].[x]} ON COLUMNS, {} ON ROWS FROM [Sales] WHERE ([Ver].[Ver].[Actual])';
    const out = rewriteMdxSlicer(mdx, { Ver: 'Budget' });
    expect(out).toBe('WITH MEMBER [M].[x] AS 1 SELECT {[M].[x]} ON COLUMNS, {} ON ROWS FROM [Sales]\nWHERE ([Ver].[Ver].[Budget])');
  });

  it('drops the WHERE when titleAssignments is empty', () => {
    const mdx = 'SELECT {} ON COLUMNS, {} ON ROWS FROM [Sales] WHERE ([Time].[Time].[2023])';
    expect(rewriteMdxSlicer(mdx, {})).toBe('SELECT {} ON COLUMNS, {} ON ROWS FROM [Sales]');
  });

  it('escapes ] as ]] in dim and member names', () => {
    const out = rewriteMdxSlicer('SELECT {} ON 0, {} ON 1 FROM [C]', { 'Sa]les': 'M]x' });
    expect(out).toBe('SELECT {} ON 0, {} ON 1 FROM [C]\nWHERE ([Sa]]les].[Sa]]les].[M]]x])');
  });

  it('is a no-op for bare-set MDX with no FROM', () => {
    const mdx = '{ [Time].[2024] }';
    expect(rewriteMdxSlicer(mdx, { Ver: 'Actual' })).toBe(mdx);
  });

  it('keeps multiple title dims in the slicer tuple', () => {
    const mdx = 'SELECT {} ON 0, {} ON 1 FROM [Sales]';
    const out = rewriteMdxSlicer(mdx, { Time: '2024', Ver: 'Actual' });
    expect(out).toBe('SELECT {} ON 0, {} ON 1 FROM [Sales]\nWHERE ([Time].[Time].[2024], [Ver].[Ver].[Actual])');
  });
});
