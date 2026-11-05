import { describe, expect, it } from 'vitest';
import { planSectionEdits } from '../../webviewClient/processEditorMonaco/fileModePure';

const cur = { prolog: 'p', metadata: 'm', data: 'line1\nline2', epilog: 'e' };

describe('planSectionEdits', () => {
  it('plans nothing for unchanged sections', () => {
    expect(planSectionEdits(cur, { ...cur })).toEqual([]);
  });
  it('plans one minimal edit for a changed section', () => {
    expect(planSectionEdits(cur, { data: 'line1\nLINE2' })).toEqual([
      { section: 'data', edit: { offset: 6, length: 4, text: 'LINE' } },
    ]);
  });
  it('leaves sections missing from next alone', () => {
    expect(planSectionEdits(cur, { prolog: 'P' }).map(e => e.section)).toEqual(['prolog']);
  });
});
