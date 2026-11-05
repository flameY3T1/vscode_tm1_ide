import { describe, it, expect } from 'vitest';
import {
  renderCellSecurityBuilderBody,
} from '../../commands/security/cellSecurityBuilderHtml';

const labels = {
  heading: 'Create Cell Security Cube — Sales',
  hint: 'Fewer dimensions = faster.',
  groupsRow: 'always included (last)',
  create: 'Create',
};

describe('renderCellSecurityBuilderBody', () => {
  const dims = ['Region', 'Time', 'Product'];

  it('renders a checked checkbox per source dim, in order', () => {
    const html = renderCellSecurityBuilderBody('Sales', dims, labels);
    for (const d of dims) {
      expect(html).toContain(d);
    }
    // 3 source dims + 1 }Groups (both checked) = 4 total checked boxes
    expect((html.match(/checked/g) || []).length).toBe(4);
  });

  it('shows a disabled }Groups row', () => {
    const html = renderCellSecurityBuilderBody('Sales', dims, labels);
    expect(html).toContain('}Groups');
    expect(html).toContain(labels.groupsRow);
  });

  it('embeds the source dims as JSON for the inline script', () => {
    const html = renderCellSecurityBuilderBody('Sales', dims, labels);
    expect(html).toContain('id="csb-data"');
    expect(html).toContain('"Region"');
  });

  it('HTML-escapes dim names', () => {
    const html = renderCellSecurityBuilderBody('Sales', ['<x>'], labels);
    expect(html).not.toContain('<x>');
    expect(html).toContain('&lt;x&gt;');
  });

});
