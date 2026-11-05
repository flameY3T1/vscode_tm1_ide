/**
 * Extracts a release notes section from markdown.
 * Returns markdown `## [<version>]` section (header through before next `## `, EOF).
 * No exact match → first `## [` section. No `## ` section → `null`.
 */
function matchIndex(lines: string[], version: string): number {
  const want = version.trim().replace(/^v/i, '');
  for (let i = 0; i < lines.length; i++) {
    const m = /^##\s+\[([^\]]+)\]/.exec(lines[i]);
    if (m && m[1].trim().replace(/^v/i, '') === want) {
      return i;
    }
  }
  return -1;
}

/**
 * Index of first `## [...]` (top/newest) section header, -1 if not found.
 */
function firstSectionIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\[/.test(lines[i])) {
      return i;
    }
  }
  return -1;
}

export function extractVersionSection(md: string, version: string): string | null {
  const lines = md.split('\n');
  let start = matchIndex(lines, version);
  if (start < 0) {
    start = firstSectionIndex(lines);
  }
  if (start < 0) {
    return null;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}
