/**
 * Bundle control objects into clusters.
 *
 * When control objects are shown, several hundred `}`-names on a real server
 * tip into the same folder as the twenty objects the user actually cares
 * about. But they do not all belong together: `}bedrock.*` is an installed
 * third-party package, `}ElementAttributes_*` is a family, `}Clients` is a
 * single item.
 *
 * This file only decides which name belongs to which cluster and in which
 * order the clusters stand. No vscode, no state.
 */

export {};

export type ControlClusterKind = 'package' | 'stem' | 'rest';

export interface ControlCluster {
  /**
   * Display name of the group in the spelling of its first member, or
   * `null` for the catch-all bucket — its label is the caller's concern,
   * because it is translated.
   */
  key: string | null;
  kind: ControlClusterKind;
  names: string[];
}

/**
 * From how many members a word stem gets its own group.
 *
 * A group for a single object would only hide it behind one extra click.
 * The cap does NOT apply to packages: there, the name before the dot is a
 * statement from the vendor, not an arbitrary word start.
 */
const MIN_STEM_MEMBERS = 2;

/** First CamelCase word: `CubeProperties` → `Cube`, `Clients` → `Clients`. */
const FIRST_WORD = /^[A-Za-z][a-z0-9]*/;

interface Bucket {
  key: string | null;
  kind: ControlClusterKind;
  names: string[];
}

/**
 * Determine the cluster key of a single control object.
 *
 * Order of the rules:
 *  1. Dot in the name → package (the piece before the first dot), e.g. `}bedrock.x`.
 *  2. Underscore → family (the piece before the first underscore), e.g.
 *     `}ElementAttributes_Region`.
 *  3. otherwise the first CamelCase word, e.g. `}CubeProperties` → `Cube`.
 *  4. if none of these apply (`}`, `}_x`, `}.a`), the name stays ungrouped.
 */
function classify(name: string): { key: string; kind: 'package' | 'stem' } | null {
  const rest = name.slice(1);
  const dot = rest.indexOf('.');
  if (dot > 0) { return { key: rest.slice(0, dot), kind: 'package' }; }

  const underscore = rest.indexOf('_');
  if (underscore > 0) { return { key: rest.slice(0, underscore), kind: 'stem' }; }

  const word = FIRST_WORD.exec(rest);
  if (word && word[0].length > 0) { return { key: word[0], kind: 'stem' }; }
  return null;
}

/**
 * Group control objects. Names without `}` are ignored — they are not
 * control objects and have no business in a cluster.
 *
 * Order: packages (alphabetical), then word stems (alphabetical), then the
 * rest. Within a group, the input order is kept, so the caller determines
 * the sort order it has already applied anyway.
 */
export function clusterControlObjects(names: string[]): ControlCluster[] {
  const buckets = new Map<string, Bucket>();
  const rest: string[] = [];

  for (const name of names) {
    if (!name.startsWith('}')) { continue; }
    const hit = classify(name);
    if (!hit) { rest.push(name); continue; }
    const id = `${hit.kind}:${hit.key.toLowerCase()}`;
    const bucket = buckets.get(id);
    // The spelling of the FIRST member wins: `}Pulse.a` and `}pulse.b` are
    // the same package, and a server usually spells itself consistently.
    if (bucket) { bucket.names.push(name); }
    else { buckets.set(id, { key: hit.key, kind: hit.kind, names: [name] }); }
  }

  const packages: Bucket[] = [];
  const stems: Bucket[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.kind === 'package') { packages.push(bucket); continue; }
    if (bucket.names.length < MIN_STEM_MEMBERS) { rest.push(...bucket.names); continue; }
    stems.push(bucket);
  }

  const byKey = (a: Bucket, b: Bucket) =>
    String(a.key).toLowerCase().localeCompare(String(b.key).toLowerCase());
  packages.sort(byKey);
  stems.sort(byKey);

  const out: ControlCluster[] = [...packages, ...stems];
  if (rest.length > 0) { out.push({ key: null, kind: 'rest', names: rest }); }
  return out;
}

/**
 * Split a filtered name list into ordinary objects and control clusters.
 *
 * Expects the list that the visibility filter has already passed through:
 * if control objects are hidden, it contains no `}`-names, `clusters` is
 * empty and the tree looks the way it did before.
 */
export function splitControlObjects(names: string[]): { plain: string[]; clusters: ControlCluster[] } {
  const plain: string[] = [];
  const control: string[] = [];
  for (const name of names) {
    if (name.startsWith('}')) { control.push(name); } else { plain.push(name); }
  }
  return { plain, clusters: control.length > 0 ? clusterControlObjects(control) : [] };
}

/**
 * Stable identifier of a group — goes into the node `id` and thus into the
 * stored expand-state memory.
 *
 * Must tell apart a package and a word stem of the same name, and must not
 * collide with a stem that happens to be named `rest`.
 */
export function controlClusterId(cluster: ControlCluster): string {
  if (cluster.kind === 'rest') { return '#rest'; }
  return `${cluster.kind === 'package' ? 'pkg' : 'stem'}:${String(cluster.key).toLowerCase()}`;
}
