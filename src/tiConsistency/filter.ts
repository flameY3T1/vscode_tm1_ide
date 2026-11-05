/**
 * Process-name filter. Each axis holds zero or more terms (comma-separated in
 * the UI, like Find/Replace). A name passes an axis if the axis is empty OR it
 * matches ANY of the axis' terms (OR within an axis); all three axes must pass
 * (AND across axes). Case-insensitive.
 */
export interface NameFilter {
  contains: string[];
  prefix: string[];
  suffix: string[];
  /** Include TM1 control objects (name starts with `}`, case-sensitive). Default (missing/false) excludes them. */
  includeControl?: boolean;
}

function clean(terms: string[]): string[] {
  return terms.map(t => t.trim().toLowerCase()).filter(t => t !== '');
}

export function filterProcessNames(names: string[], f: NameFilter): string[] {
  const contains = clean(f.contains);
  const prefix = clean(f.prefix);
  const suffix = clean(f.suffix);
  const includeControl = f.includeControl ?? false;
  return names.filter((name) => {
    if (!includeControl && name.startsWith('}')) { return false; }
    const lower = name.toLowerCase();
    if (prefix.length && !prefix.some(p => lower.startsWith(p))) { return false; }
    if (suffix.length && !suffix.some(s => lower.endsWith(s))) { return false; }
    if (contains.length && !contains.some(c => lower.includes(c))) { return false; }
    return true;
  });
}
