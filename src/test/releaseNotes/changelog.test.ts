import { describe, it, expect } from 'vitest';
import { extractVersionSection } from '../../commands/releaseNotes/changelog';

const MD = [
  '# Changelog',
  '',
  '## [1.0.14] — 2026-07-16',
  '### Cube viewer',
  '- a',
  '- b',
  '',
  '## [1.0.13] — 2026-07-01',
  '### Old',
  '- c',
].join('\n');

describe('extractVersionSection', () => {
  it('returns the matching version section including its header, up to the next ##', () => {
    const s = extractVersionSection(MD, '1.0.14')!;
    expect(s).toContain('## [1.0.14] — 2026-07-16');
    expect(s).toContain('- a');
    expect(s).toContain('- b');
    expect(s).not.toContain('## [1.0.13]');
    expect(s).not.toContain('- c');
  });

  it('matches tolerating a leading v and whitespace', () => {
    expect(extractVersionSection(MD, 'v1.0.14')).toContain('## [1.0.14]');
  });

  it('returns the last section through EOF', () => {
    const s = extractVersionSection(MD, '1.0.13')!;
    expect(s).toContain('## [1.0.13]');
    expect(s).toContain('- c');
  });

  it('falls back to the first (top) section when the version is not found', () => {
    const s = extractVersionSection(MD, '9.9.9')!;
    expect(s).toContain('## [1.0.14]');
    expect(s).not.toContain('## [1.0.13]');
  });

  it('returns null when there is no ## section', () => {
    expect(extractVersionSection('# Changelog\n\njust text', '1.0.0')).toBeNull();
  });
});
