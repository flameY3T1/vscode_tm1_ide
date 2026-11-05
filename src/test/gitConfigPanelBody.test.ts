import { describe, it, expect } from 'vitest';
import { buildGitConfigBody } from '../commands/git/gitConfigPanelBody';

describe('buildGitConfigBody', () => {
  it('renders the form controls', () => {
    const html = buildGitConfigBody();
    expect(html).toContain('id="git-enabled"');
    expect(html).toContain('id="git-repoPath"');
    expect(html).toContain('id="git-includeServerFolder"');
    expect(html).toContain('id="git-parallelFetch"');
    expect(html).toContain('id="git-save"');
  });

  it('contains no script tag (scripts go via shell inlineScript)', () => {
    expect(buildGitConfigBody()).not.toContain('<script');
  });
});
