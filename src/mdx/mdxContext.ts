export type MdxContext =
  | { kind: 'cube';           prefix: string }
  | { kind: 'dim';            cube: string | null; prefix: string }
  | { kind: 'memberFunction'; dim: string;         prefix: string }
  | { kind: 'member';         dim: string;         hier: string | null; prefix: string }
  | { kind: 'function';       prefix: string };

/**
 * Regex-based, minimal-state parser. Identifies what the user is typing at
 * `offset` so the completion provider can return the right list.
 *
 * Returns `null` when the cursor sits outside any known completion context
 * (inside a fully-closed `[X].[Y]`, mid-string literal, mid-comment, etc.).
 */
export function getMdxContext(text: string, offset: number): MdxContext | null {
  if (text.length === 0) { return null; }
  const before = text.slice(0, offset);

  // Return null if cursor sits right after a closing ']' — nothing sensible
  // to complete at that point.
  if (/\]$/.test(before)) { return null; }

  // Current cube (from FROM [..] anywhere in the whole text, not just `before`).
  const fromMatch = /FROM\s+\[([^\]\n]+)\]/i.exec(text);
  const currentCube = fromMatch ? fromMatch[1] : null;

  // 1. FROM [<prefix>$  → cube
  const fromPrefix = /FROM\s*\[([^\]\n]*)$/i.exec(before);
  if (fromPrefix) { return { kind: 'cube', prefix: fromPrefix[1] }; }

  // 2. ]\s*.<prefix>$   → memberFunction (dim from preceding [X])
  const memFunc = /\[([^\]\n]+)\]\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
  if (memFunc) {
    return { kind: 'memberFunction', dim: memFunc[1], prefix: memFunc[2] ?? '' };
  }

  // 3. [Dim].[<prefix>$ or [Dim].[Hier].[<prefix>$  → member of that hierarchy
  //    (one segment: default hierarchy, same name as the dimension). A longer
  //    path `[Dim].[Hier].[Parent].[` still names Dim and Hier in its FIRST
  //    two segments, not in the two right before the cursor.
  const member = /((?:\[[^\]\n]+\]\s*\.\s*)+)\[([^\]\n]*)$/.exec(before);
  if (member) {
    const [dim, hier] = [...member[1].matchAll(/\[([^\]\n]+)\]/g)].map(m => m[1]);
    return { kind: 'member', dim, hier: hier ?? null, prefix: member[2] };
  }

  // 4. [<prefix>$ not preceded by FROM  → dim
  const dimPrefix = /\[([^\]\n]*)$/.exec(before);
  if (dimPrefix) {
    return { kind: 'dim', cube: currentCube, prefix: dimPrefix[1] };
  }

  // 5. bare word (outside any bracket) → function
  const word = /([A-Za-z_][A-Za-z0-9_]*)?$/.exec(before);
  if (word) { return { kind: 'function', prefix: word[1] ?? '' }; }

  return null;
}

/**
 * Members to offer for a `member` context: infix match, capped. A dimension
 * can carry 100k+ elements; the editor filters further as the user types.
 */
export const MEMBER_COMPLETION_MAX = 500;

export function pickMembers(names: string[], prefix: string, max = MEMBER_COMPLETION_MAX): string[] {
  const p = prefix.toLowerCase();
  const out: string[] = [];
  for (const n of names) {
    if (p === '' || n.toLowerCase().includes(p)) {
      out.push(n);
      if (out.length >= max) { break; }
    }
  }
  return out;
}
