/**
 * Pure helpers for the Tm1CompletionProvider.
 *
 * Extracted from `tm1CompletionProvider.ts` (Post-H17 #12 coverage push).
 * No vscode-API access — pure parser over .pro file content.
 */

export interface DsVar { Name: string; Type: string; }

/**
 * Parses datasource variable names from 577/578 blocks in a .pro file header.
 *
 * `.pro` file header format:
 *   577,N      — N variable-name lines follow
 *   578,N      — N type lines follow (1 = Numeric, 2 = String)
 *
 * Both blocks live BEFORE the `572,` (prolog) marker; lines after are TI code.
 * Returns `[]` when no 577/578 block exists.
 */
export function parseDsVariables(content: string): DsVar[] {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  const prologIdx = lines.findIndex(l => /^572,/.test(l));
  const preProlog = prologIdx === -1 ? lines : lines.slice(0, prologIdx);
  let names: string[] = [];
  let types: number[] = [];
  let i = 0;
  while (i < preProlog.length) {
    const m = preProlog[i].match(/^(577|578),(\d+)$/);
    if (m) {
      const count = parseInt(m[2], 10);
      const data = preProlog.slice(i + 1, i + 1 + count);
      if (m[1] === '577') { names = data.map(l => l.trim()); }
      else if (m[1] === '578') { types = data.map(l => parseInt(l.trim(), 10) || 2); }
      i += 1 + count;
      continue;
    }
    i++;
  }
  return names.map((n, idx) => ({ Name: n, Type: (types[idx] ?? 2) === 1 ? 'Numeric' : 'String' }));
}
