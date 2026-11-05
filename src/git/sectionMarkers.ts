export interface TiSections {
  prolog: string;
  metadata: string;
  data: string;
  epilog: string;
}

const SECTIONS: ReadonlyArray<keyof TiSections> = ['prolog', 'metadata', 'data', 'epilog'];
const SECTION_SET = new Set<string>(SECTIONS);
const TITLE: Record<keyof TiSections, string> = { prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog' };

const OPEN_RE = /^#region (\w+)$/;
const CLOSE_RE = /^#endregion(?: (?:prolog|metadata|data|epilog))?$/;

/** The tab a line opens: native `#region Prolog` or the former `#region prolog`. */
function openedTab(line: string): keyof TiSections | undefined {
  const m = OPEN_RE.exec(line.trim());
  if (!m) { return undefined; }
  const name = m[1].toLowerCase();
  return SECTION_SET.has(name) && (m[1] === name || m[1] === TITLE[name as keyof TiSections])
    ? name as keyof TiSections
    : undefined;
}

/**
 * Reads TM1's native `Code` blob (`GET Processes('x')/Code/$value`):
 * `#region Prolog` … `#endregion`, tabs in fixed order, empty tabs omitted.
 * Also reads the extension's former layout (`#region prolog` …
 * `#endregion prolog`).
 *
 * The user's own folds (`#Region: text` … `#EndRegion`) sit INSIDE a tab:
 * 94 of 366 processes on the 11.8 test server have them, and 2 leave one
 * open. Counting depth therefore fails on real data. A tab ends instead at
 * the server's exact `#endregion` line that is followed (blank lines aside)
 * by the opening of a LATER tab or by the end of the file — the shape the
 * server writes. Any other `#endregion` is code.
 *
 * The line break before a bare `#endregion` depends on the server (`v12`),
 * mirroring `joinSections`: 12 always writes one, so it is the separator and
 * dropped. 11.x writes one only when the tab does not already end with one, so
 * it belongs to the code and stays — the same split TM1 11.8 itself makes on
 * `PATCH {Code}` (measured 2026-10-12: `x;` comes back as `x;` plus CRLF,
 * longer endings unchanged). Dropping it there lost one trailing line per
 * push in 126 of 366 processes. The former layout (`#endregion prolog`)
 * never added a break, so nothing is dropped or kept there.
 *
 * `undefined` instead of guessing: no tab at all, code outside a tab, a tab
 * out of order or twice, a later tab opening inside a tab (its `#endregion`
 * was deleted), or a tab that never closes. Each of these would
 * otherwise come back as an empty or truncated tab and wipe code on save.
 */
export function splitSections(text: string, v12 = false): TiSections | undefined {
  const result: TiSections = { prolog: '', metadata: '', data: '', epilog: '' };
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nextNonBlank = (from: number) => {
    let k = from;
    while (k < lines.length && lines[k].trim() === '') { k++; }
    return k;
  };
  let last = -1;
  let i = nextNonBlank(0);
  while (i < lines.length) {
    const tab = openedTab(lines[i]);
    if (!tab || SECTIONS.indexOf(tab) <= last) { return undefined; }
    let j = i + 1;
    for (;; j++) {
      if (j >= lines.length) { return undefined; }
      if (!CLOSE_RE.test(lines[j].trim())) {
        // A later tab opening with no `#endregion` before it: the close was
        // deleted, and reading on would pull that tab into this one.
        const inner = openedTab(lines[j]);
        if (inner && SECTIONS.indexOf(inner) > SECTIONS.indexOf(tab)) { return undefined; }
        continue;
      }
      const k = nextNonBlank(j + 1);
      const following = k < lines.length ? openedTab(lines[k]) : undefined;
      if (k === lines.length || (following && SECTIONS.indexOf(following) > SECTIONS.indexOf(tab))) { break; }
      // The same or an earlier tab right after an `#endregion`: out of order or twice.
      if (following) { return undefined; }
    }
    const code = lines.slice(i + 1, j);
    const keepBreak = !v12 && code.length > 0 && lines[j].trim() === '#endregion';
    result[tab] = code.join('\n') + (keepBreak ? '\n' : '');
    last = SECTIONS.indexOf(tab);
    i = nextNonBlank(j + 1);
  }
  return last >= 0 ? result : undefined;
}

/**
 * Writes the native layout, LF. Two server dialects, both measured:
 *
 * - 11.x (default): a line break goes before `#endregion` only when the tab
 *   does not already end with one — so the blob cannot tell `x;` from `x;`
 *   plus a trailing newline, and `splitSections` returns the longer, as TM1's
 *   own `Code` PATCH does. A process with no code still gets an empty Prolog
 *   region.
 * - 12 (`v12`): ALWAYS a line break before `#endregion`, so a tab ending in a
 *   newline shows a blank line there. 102 of 102 processes on 12.5.9
 *   (2026-10-11). One deliberate difference: 12 sends an empty blob for a
 *   process without code; this still writes the empty Prolog region, because
 *   `splitSections` refuses an empty file — a truncated `.ti` must not push
 *   as "delete all code".
 */
export function joinSections(sections: TiSections, v12 = false): string {
  const present = SECTIONS.filter(s => sections[s] !== '');
  return (present.length > 0 ? present : ['prolog' as const])
    .map(s => {
      const code = sections[s];
      return `#region ${TITLE[s]}\n${code}${code === '' || (!v12 && code.endsWith('\n')) ? '' : '\n'}#endregion`;
    })
    .join('\n');
}
