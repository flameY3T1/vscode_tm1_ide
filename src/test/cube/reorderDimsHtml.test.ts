import { describe, it, expect } from 'vitest';
import { renderReorderDimsBody } from '../../commands/cube/reorderDimsHtml';

const labels = {
  current: 'Current',
  recommended: 'Recommended',
  editable: 'Editable',
  use: 'Use →',
  apply: 'Apply',
  up: 'Up',
  down: 'Down',
  lastWarn: 'Last dimension changed',
};

describe('renderReorderDimsBody', () => {
  const init = {
    current: ['A', 'B', 'C'],
    counts: { A: 30, B: 10, C: 20 },
    recommended: ['B', 'A', 'C'],
  };
  it('includes all dimension names and the column labels', () => {
    const html = renderReorderDimsBody(init, labels);
    expect(html).toContain('Current');
    expect(html).toContain('Recommended');
    expect(html).toContain('Editable');
    for (const d of ['A', 'B', 'C']) {
      expect(html).toContain(d);
    }
  });
  it('embeds the init payload as JSON for the inline script', () => {
    const html = renderReorderDimsBody(init, labels);
    expect(html).toContain('id="reorder-data"');
    expect(html).toContain('"recommended"');
  });
  it('escapes HTML-special chars in dimension names', () => {
    const html = renderReorderDimsBody(
      { current: ['<x>'], counts: { '<x>': 1 }, recommended: ['<x>'] },
      labels,
    );
    expect(html).not.toContain('<x>');
    expect(html).toContain('&lt;x&gt;');
  });
  // Regression guards: brief-spec features that were previously missing
  it('embeds reorder-labels JSON block for up/down label localisation', () => {
    const html = renderReorderDimsBody(init, labels);
    expect(html).toContain('id="reorder-labels"');
  });
});
