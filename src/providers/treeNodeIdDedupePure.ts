/**
 * Last-resort guard against duplicate node `id`s within ONE sibling list.
 *
 * VS Code throws, for two tree nodes with the same `id`,
 * "Element with id ... is already registered" — and not only for the
 * second node: the WHOLE branch then stops rendering. That is exactly what
 * happened on 2026-09-01 on a cube with both a native AND an MDX view named
 * `Standard`: both nodes carried `...:view:Cube B:Standard`, the "Views"
 * branch stayed empty, while the Cube Viewer's selection field (which
 * assigns no ids) showed both views without any trouble.
 *
 * The root-cause fix sits in `_buildId` (the MDX marker belongs in the id).
 * This guard is the class behind it: it is the third occurrence of the same
 * message (review 2026-08-27 finding 1, 2026-08-28 finding 2), and a server
 * may at any time place two identically named objects into one list. A
 * duplicate name should cost one duplicate node, not the whole branch.
 *
 * Deliberately NOT: discarding the duplicate node. It really exists on the
 * server, and a silently vanished object is the worse bug.
 *
 * The `::dup<n>` suffix is appended at the end so the start of the id
 * (server, type, name) stays readable for anything that searches ids by
 * prefix. The ids are purely internal — the user never sees them anywhere.
 */
export function dedupeTreeNodeIds<T extends { id?: string }>(nodes: T[]): T[] {
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = node.id;
    // Without an id, VS Code assigns one itself — no collision risk.
    if (typeof id !== 'string' || id === '') { continue; }
    if (!seen.has(id)) { seen.add(id); continue; }
    let n = 2;
    let candidate = `${id}::dup${n}`;
    while (seen.has(candidate)) { candidate = `${id}::dup${++n}`; }
    node.id = candidate;
    seen.add(candidate);
  }
  return nodes;
}
