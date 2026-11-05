// Pure, vscode-free grouping + folder-list mutation helpers for the optional
// "server folders" feature. serverManager wires these to globalState; the tree
// provider uses groupServersByFolder for rendering. Kept pure so the logic is
// unit-testable without VS Code.

/** Minimal shape the folder logic needs — decoupled from ServerProfile. */
export interface ServerLike {
  id: string;
  name: string;
  folder?: string;
}

export interface FolderGroup<T extends ServerLike = ServerLike> {
  name: string;
  servers: T[];
}

export interface GroupedServers<T extends ServerLike = ServerLike> {
  folders: FolderGroup<T>[];
  ungrouped: T[];
}

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

/**
 * Split servers into folder groups + an ungrouped (root) list.
 *
 * Folder names are the union of `folderList` (so empty folders persist) and the
 * distinct `folder` values found on the servers. Folders are alpha-sorted; the
 * servers inside each folder and the ungrouped list are alpha-sorted by name.
 */
export function groupServersByFolder<T extends ServerLike>(servers: T[], folderList: string[]): GroupedServers<T> {
  const sorted = [...servers].sort(byName);
  const ungrouped = sorted.filter(s => !s.folder);

  const names = new Set<string>(folderList.filter(n => !!n));
  for (const s of sorted) {
    if (s.folder) { names.add(s.folder); }
  }

  const folders = [...names]
    .sort((a, b) => a.localeCompare(b))
    .map(name => ({ name, servers: sorted.filter(s => s.folder === name) }));

  return { folders, ungrouped };
}

/** Append a trimmed folder name; no-op for empty or duplicate names. */
export function addFolder(list: string[], name: string): string[] {
  const n = name.trim();
  if (!n || list.includes(n)) { return list; }
  return [...list, n];
}

/**
 * Rename a folder in the list and reassign every server pointing at the old
 * name. Dedupes if the new name already exists. No-op on an empty new name.
 */
export function renameFolder<T extends ServerLike>(
  list: string[],
  servers: T[],
  oldName: string,
  newName: string,
): { folders: string[]; servers: T[] } {
  const n = newName.trim();
  if (!n) { return { folders: list, servers }; }
  const folders = [...new Set(list.map(f => (f === oldName ? n : f)))];
  const updated = servers.map(s => (s.folder === oldName ? { ...s, folder: n } : s));
  return { folders, servers: updated };
}

/** Remove a folder from the list; its servers fall back to ungrouped (folder cleared). */
export function deleteFolder<T extends ServerLike>(
  list: string[],
  servers: T[],
  name: string,
): { folders: string[]; servers: T[] } {
  const folders = list.filter(f => f !== name);
  const updated = servers.map(s => (s.folder === name ? { ...s, folder: undefined } : s));
  return { folders, servers: updated };
}

/** Assign (or, with empty/undefined folder, clear) the folder of one server by id. */
export function assignFolder<T extends ServerLike>(servers: T[], id: string, folder: string | undefined): T[] {
  return servers.map(s => (s.id === id ? { ...s, folder: folder || undefined } : s));
}
