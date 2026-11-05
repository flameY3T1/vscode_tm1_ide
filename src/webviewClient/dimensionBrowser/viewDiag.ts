/**
 * State report for the VIEW - callable via Ctrl+Alt+K in the Dimension Browser.
 *
 * Successor of the three diagnostics of the old path (`composeDiag` Ctrl+Alt+K,
 * `depthDiag` Ctrl+Alt+D, `collapseDiag` Ctrl+Alt+C). They reported on the
 * base/delta of the composition, `_allData` parent maps and the collapse marker of the
 * old renderer - quantities that nobody maintains any more in the single load path. A
 * diagnostic that describes a state nobody draws any more is worse than none: it
 * looks like an answer.
 *
 * This one names what actually determines the display: the base, the stack
 * of intents in its order, the expression built from it and what of it is
 * in the window.
 */

import { currentRows, currentTotal, currentAlias, currentMdx, viewOfDiag } from './viewPath';
import { flashBanner } from './banner';

export {};

/** One intent in one line - the same words as in the trail. */
function intentLine(i: unknown): string {
  const o = i as { kind?: string; member?: string; names?: string[]; level?: number; layer?: unknown };
  const parts: string[] = [String(o.kind ?? '?')];
  if (o.member) { parts.push(o.member); }
  if (typeof o.level === 'number') { parts.push(`level ${o.level}`); }
  if (o.names) { parts.push(`${o.names.length} names`); }
  if (o.layer) { parts.push(JSON.stringify(o.layer)); }
  return parts.join(' · ');
}

export function initViewDiag(): void {
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!e.ctrlKey || !e.altKey) { return; }
    if (e.key !== 'k' && e.key !== 'K') { return; }
    e.preventDefault();
    const v = viewOfDiag();
    const rows = currentRows();
    const mdx = currentMdx();
    const head = v
      ? `Base: ${v.base.kind}${v.base.kind === 'mdx' ? ` (${v.base.expr.length} chars)` : ''}`
      : 'no view';
    const stack = v && v.intents.length
      ? v.intents.map((i, n) => `  ${n + 1}. ${intentLine(i)}`).join('\n')
      : '  (empty)';
    const alias = currentAlias();
    const report = [
      head,
      `Intents:\n${stack}`,
      `Display: ${rows.length} rows in the window, total ${currentTotal()}`,
      `Alias: ${alias || '(Name)'}`,
      `Expression:\n${mdx ?? '(none)'}`,
    ].join('\n');
    // Full text to the webview console, short version to the banner line -
    // the same split as with the predecessors.
    console.log('[dimBrowser] view\n' + report);
    flashBanner(`${head} · ${v ? v.intents.length : 0} intents · ${rows.length}/${currentTotal()} rows`);
  });
}
