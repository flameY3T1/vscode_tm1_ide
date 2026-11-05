import { apiRequest, apiRequestBinary } from './client';
import type { Tm1Config } from './transport/types';
import { parseBody, parseEnvelopeBody } from './parseRest';
import { escapeODataKey } from '../utils/odataKey';
import { isOk, Tm1HttpError } from './httpError';

// TM1 11.8 (live-verified 2026-07-01): Contents('Applications') is a recursive
// folder store. Entry key = ID (Folder: ID==Name; DocumentReference: <name>.blob;
// Link: <name>.extr). Private entries live in a sibling PrivateContents collection
// at each level. $expand=Document on a mixed collection → 400, so list plain.

export type AppEntryType =
  | 'folder' | 'document' | 'link'
  | 'cubeRef' | 'viewRef' | 'dimensionRef' | 'subsetRef' | 'processRef' | 'choreRef'
  | 'unknown';

export interface AppTarget {
  cubeName?: string; viewName?: string; processName?: string;
  choreName?: string; dimensionName?: string; subsetName?: string;
}

export interface AppEntry {
  id: string;
  name: string;
  type: AppEntryType;
  isPrivate: boolean;
  url?: string;
  target?: AppTarget;
}

function q(s: string): string { return escapeODataKey(s); }

/** OData path for a folder's child collection (folders addressed via public Contents). */
export function appContentsPath(
  folderPath: string[],
  container: 'Contents' | 'PrivateContents',
  key?: string,
): string {
  let p = "Contents('Applications')";
  for (const seg of folderPath) { p += `/Contents('${encodeURIComponent(q(seg))}')`; }
  p += `/${container}`;
  if (key !== undefined) { p += `('${encodeURIComponent(q(key))}')`; }
  return p;
}

export function mapAppType(odataType: string): AppEntryType {
  const t = (odataType || '').replace('#ibm.tm1.api.v1.', '');
  switch (t) {
    case 'Folder':            return 'folder';
    case 'DocumentReference': return 'document';
    case 'Link':              return 'link';
    case 'CubeReference':     return 'cubeRef';
    case 'ViewReference':     return 'viewRef';
    case 'DimensionReference':return 'dimensionRef';
    case 'SubsetReference':   return 'subsetRef';
    case 'ProcessReference':  return 'processRef';
    case 'ChoreReference':    return 'choreRef';
    default:                  return 'unknown';
  }
}

interface RawEntry { '@odata.type'?: string; ID?: string; Name?: string; URL?: string }

function mapRawEntry(e: RawEntry, isPrivate: boolean): AppEntry {
  const type = mapAppType(e['@odata.type'] ?? '');
  const entry: AppEntry = {
    id: e.ID ?? e.Name ?? '',
    name: e.Name ?? e.ID ?? '',
    type,
    isPrivate,
  };
  if (type === 'link' && e.URL) { entry.url = e.URL; }
  return entry;
}

export function parseAppEntries(res: { body: string }, isPrivate: boolean): AppEntry[] {
  return parseEnvelopeBody<RawEntry>(res).map((e) => mapRawEntry(e, isPrivate));
}

/** List one container (public Contents or private PrivateContents) at a folder level.
 *  A non-2xx PrivateContents (e.g. 401 — no private store) is tolerated → []. */
async function listContainer(
  folderPath: string[],
  container: 'Contents' | 'PrivateContents',
  config: Tm1Config,
): Promise<AppEntry[]> {
  const res = await apiRequest('GET', appContentsPath(folderPath, container), undefined, undefined, config);
  if (!isOk(res)) {
    if (container === 'PrivateContents') { return []; } // tolerate no private store
    throw new Tm1HttpError(`Load applications failed (HTTP ${res.statusCode})`, res.statusCode);
  }
  return parseAppEntries(res, container === 'PrivateContents');
}

/** Merged public + private entries (public first), each flagged with isPrivate. */
export async function listApplications(folderPath: string[], config: Tm1Config): Promise<AppEntry[]> {
  const [pub, priv] = await Promise.all([
    listContainer(folderPath, 'Contents', config),
    listContainer(folderPath, 'PrivateContents', config),
  ]);
  return [...pub, ...priv];
}

/** One non-folder entry of the whole Applications tree, for the overview page. */
export interface AppTreeEntry extends AppEntry {
  /** Folder path from the Applications root ([] = root). */
  folderPath: string[];
  /** Document size in bytes (documents only). */
  size?: number;
  /** Document last change, ISO timestamp (documents only). */
  lastUpdated?: string;
  /** Reference target could not be resolved (object deleted or renamed). */
  broken?: boolean;
}

// Type-cast $expand DOES work on the mixed collection (live 11.8, 2026-09-27:
// 200 in 12 ms, 22 calls for the whole tree); only the plain `$expand=Document`
// is rejected. One call per folder and container instead of one per entry.
const TREE_EXPAND = [
  'tm1.DocumentReference/Document($select=Size,LastUpdated)',
  'tm1.ViewReference/View($select=Name;$expand=Cube($select=Name))',
  'tm1.CubeReference/Cube($select=Name)',
  'tm1.DimensionReference/Dimension($select=Name)',
  'tm1.SubsetReference/Subset($select=Name)',
  'tm1.ProcessReference/Process($select=Name)',
  'tm1.ChoreReference/Chore($select=Name)',
].join(',');

// The same targets per entry, for the fallback below: on a single entry the
// type cast is rejected (`278 "…DocumentReference is not a derived type of
// …CubeReference"`), the plain navigation works (live 11.8, 2026-09-28).
const ENTRY_EXPAND: Partial<Record<string, string>> = {
  document: 'Document($select=Size,LastUpdated)',
  viewRef: 'View($select=Name;$expand=Cube($select=Name))',
  cubeRef: 'Cube($select=Name)',
  dimensionRef: 'Dimension($select=Name)',
  subsetRef: 'Subset($select=Name)',
  processRef: 'Process($select=Name)',
  choreRef: 'Chore($select=Name)',
};

interface RawTreeEntry extends RawEntry {
  Document?: { Size?: number; LastUpdated?: string } | null;
  View?: { Name?: string; Cube?: { Name?: string } | null } | null;
  Cube?: { Name?: string } | null;
  Dimension?: { Name?: string } | null;
  Subset?: { Name?: string } | null;
  Process?: { Name?: string } | null;
  Chore?: { Name?: string } | null;
}

/** Map one expanded raw entry; exported for tests. */
export function toTreeEntry(e: RawTreeEntry, folderPath: string[], isPrivate: boolean): AppTreeEntry {
  const base = mapRawEntry(e, isPrivate);
  const out: AppTreeEntry = { ...base, folderPath };
  const name = (o: { Name?: string } | null | undefined) => o?.Name;
  switch (base.type) {
    case 'document':
      out.size = e.Document?.Size;
      out.lastUpdated = e.Document?.LastUpdated;
      break;
    case 'viewRef':
      out.target = { cubeName: e.View?.Cube?.Name, viewName: name(e.View) };
      out.broken = !out.target.viewName;
      break;
    case 'cubeRef': out.target = { cubeName: name(e.Cube) }; out.broken = !out.target.cubeName; break;
    case 'dimensionRef': out.target = { dimensionName: name(e.Dimension) }; out.broken = !out.target.dimensionName; break;
    case 'subsetRef': out.target = { subsetName: name(e.Subset) }; out.broken = !out.target.subsetName; break;
    case 'processRef': out.target = { processName: name(e.Process) }; out.broken = !out.target.processName; break;
    case 'choreRef': out.target = { choreName: name(e.Chore) }; out.broken = !out.target.choreName; break;
    default: break; // folder / link / unknown carry no target
  }
  return out;
}

/**
 * One folder's entries with their targets; `null` when the folder cannot be read.
 * One reference to a deleted object fails the expanded list of the whole folder
 * (`400 Code 42 "Unable to resolve cube reference."`, live 11.8, 2026-09-28) —
 * then the plain list, and each entry's target on its own: a failing one is the
 * broken reference.
 */
async function listTreeFolder(
  folderPath: string[], container: 'Contents' | 'PrivateContents', config: Tm1Config,
): Promise<RawTreeEntry[] | null> {
  const path = appContentsPath(folderPath, container);
  const res = await apiRequest('GET', `${path}?$expand=${TREE_EXPAND}`, undefined, undefined, config);
  if (isOk(res)) { return parseEnvelopeBody<RawTreeEntry>(res); }
  const plain = await apiRequest('GET', path, undefined, undefined, config);
  if (!isOk(plain)) { return null; }
  return Promise.all(parseEnvelopeBody<RawTreeEntry>(plain).map(async (raw) => {
    const expand = ENTRY_EXPAND[mapAppType(raw['@odata.type'] ?? '')];
    if (!expand || raw.ID === undefined) { return raw; }
    const one = await apiRequest('GET', `${appContentsPath(folderPath, container, raw.ID)}?$expand=${expand}`, undefined, undefined, config);
    return isOk(one) ? parseBody<RawTreeEntry>(one) : raw;
  }));
}

/**
 * Walk the whole Applications tree (public folders, public + private entries)
 * with document sizes and resolved reference targets. Folders are returned
 * too (for counting) and walked. A reference whose target is gone comes back without the expanded
 * object — not measured live (no such entry on the test server), so any missing
 * target name counts as broken.
 */
export async function walkApplications(config: Tm1Config): Promise<AppTreeEntry[]> {
  // Both containers and all sibling folders load in parallel — the transport
  // caps requests per server (`requestGate`, default 4), so this cannot flood
  // it. Was strictly serial: 100 folders = 200+ roundtrips one after another.
  // Results are joined in tree order, so the output order stays as before.
  const walk = async (folderPath: string[]): Promise<AppTreeEntry[]> => {
    const lists = await Promise.all((['Contents', 'PrivateContents'] as const).map(async container => {
      const raws = await listTreeFolder(folderPath, container, config);
      if (!raws) {
        if (container === 'PrivateContents') { return []; }
        throw new Error(`Load applications failed for folder "${folderPath.join('/') || 'Applications'}"`);
      }
      return raws.map(raw => toTreeEntry(raw, folderPath, container === 'PrivateContents'));
    }));
    const entries = lists.flat();
    // Private folders are not addressable via the public Contents path.
    const folders = lists[0].filter(e => e.type === 'folder');
    const below = await Promise.all(folders.map(f => walk([...folderPath, f.id])));
    return [...entries, ...below.flat()];
  };
  return walk([]);
}

/** The TM1 server name, as workbooks write it in front of a cube (`Server:Cube`). */
export async function fetchServerName(config: Tm1Config): Promise<string> {
  const res = await apiRequest('GET', 'Configuration?$select=ServerName', undefined, undefined, config);
  if (!isOk(res)) { return ''; }
  return parseBody<{ ServerName?: string }>(res).ServerName ?? '';
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** POST a new entry (Folder/Link) into a folder's public/private collection. */
async function post(
  folderPath: string[],
  container: 'Contents' | 'PrivateContents',
  payload: object,
  op: string,
  config: Tm1Config,
): Promise<void> {
  const res = await apiRequest('POST', appContentsPath(folderPath, container), JSON.stringify(payload), undefined, config, JSON_HEADERS);
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Tm1HttpError(`${op} failed (HTTP ${res.statusCode}): ${res.body.slice(0, 200)}`, res.statusCode);
  }
}

/** Create a sub-folder in the given folder (public or private container). */
export function createFolder(folderPath: string[], name: string, isPrivate: boolean, config: Tm1Config): Promise<void> {
  return post(folderPath, isPrivate ? 'PrivateContents' : 'Contents', { '@odata.type': '#ibm.tm1.api.v1.Folder', Name: name }, `Create folder "${name}"`, config);
}

/** Create a URL link in the given folder (public or private container). */
export function createLink(folderPath: string[], name: string, url: string, isPrivate: boolean, config: Tm1Config): Promise<void> {
  return post(folderPath, isPrivate ? 'PrivateContents' : 'Contents', { '@odata.type': '#ibm.tm1.api.v1.Link', Name: name, URL: url }, `Create link "${name}"`, config);
}

export type RefType = 'Cube' | 'View' | 'Dimension' | 'Subset' | 'Process' | 'Chore';

// LIVE-VERIFIED (TM1 11.8, 2026-07-01):
// - Document upload is TWO steps (inline base64 Content → 400 "Content property is
//   of type stream"): (A) POST the folder collection with body
//   {"@odata.type":"#ibm.tm1.api.v1.Document","Name":X} → 201; the response JSON
//   `ID` is "<name>.blob". (B) PUT the raw file bytes to
//   …/Contents('<id>')/Document/Content with header Content-Type: <mime> → 204.
// - Object reference: single POST with body
//   {"@odata.type":"#ibm.tm1.api.v1.<Type>Reference","Name":X,"<Type>@odata.bind":"<bind>"}
//   → 201. Binds: Cube→Cubes('C'); View→Cubes('C')/Views('V'); Dimension→Dimensions('D');
//   Subset→Dimensions('D')/Hierarchies('H')/Subsets('S'); Process→Processes('P');
//   Chore→Chores('C'). OData-key-escape ('→'') is applied by the CALLER that assembles
//   `bind` (mirrors createLink, which passes its URL through untouched).
// - Rename / move / (un)publish: bound action `tm1.Move` (LIVE-VERIFIED TM1 11.8,
//   2026-07-08). POST Contents('<id>')/tm1.Move body { Name?, Target@odata.bind?,
//   Private? } → 201; works on Document/Link/Reference AND Folder, params combinable.
//   PATCH/PUT on the entry itself both return 400 "not supported" — Move is the ONLY
//   rename/move path. $metadata: "Moves an Entry to a new parent folder, renames an
//   Entry, and publishes or privatizes it."

/** Upload a document: POST the entry, then PUT the raw bytes to /Document/Content. */
export async function uploadDocument(
  folderPath: string[],
  name: string,
  content: Buffer,
  contentType: string,
  isPrivate: boolean,
  config: Tm1Config,
): Promise<void> {
  const container = isPrivate ? 'PrivateContents' : 'Contents';
  // Step A — create the Document entry (JSON). Response ID is "<name>.blob".
  const entry = await apiRequest(
    'POST',
    appContentsPath(folderPath, container),
    JSON.stringify({ '@odata.type': '#ibm.tm1.api.v1.Document', Name: name }),
    undefined,
    config,
    JSON_HEADERS,
  );
  if (entry.statusCode !== 200 && entry.statusCode !== 201) {
    throw new Tm1HttpError(`Create document "${name}" failed (HTTP ${entry.statusCode}): ${entry.body.slice(0, 200)}`, entry.statusCode);
  }
  let id = `${name}.blob`;
  try {
    const parsed = JSON.parse(entry.body) as { ID?: string };
    if (parsed.ID) { id = parsed.ID; }
  } catch { /* keep fallback id */ }
  // Step B — stream the raw bytes to the blob's content.
  const put = await apiRequestBinary(
    'PUT',
    `${appContentsPath(folderPath, container, id)}/Document/Content`,
    content,
    config,
    { 'Content-Type': contentType },
  );
  if (!isOk(put)) {
    throw new Tm1HttpError(`Upload document "${name}" failed (HTTP ${put.statusCode})`, put.statusCode);
  }
}

/** Create an object reference (Cube/View/Dimension/Subset/Process/Chore).
 * `bind` must be a pre-escaped OData navigation path (e.g. `Cubes('Sales')`). */
export function createReference(
  folderPath: string[],
  name: string,
  refType: RefType,
  bind: string,
  isPrivate: boolean,
  config: Tm1Config,
): Promise<void> {
  const payload = {
    '@odata.type': `#ibm.tm1.api.v1.${refType}Reference`,
    Name: name,
    [`${refType}@odata.bind`]: bind,
  };
  return post(folderPath, isPrivate ? 'PrivateContents' : 'Contents', payload, `Create reference "${name}"`, config);
}

/** Options for {@link moveApplication}. All optional and combinable in one call. */
export interface MoveOpts {
  /** New display name (rename). Server re-derives the id suffix (.blob/.cube/…). */
  name?: string;
  /** Destination folder path from the Applications root ([] = root). Omit to keep parent. */
  targetFolderPath?: string[];
  /** Publish (false) / privatize (true). Omit to keep current visibility. */
  makePrivate?: boolean;
}

/** OData reference to a folder Entry, used for `Target@odata.bind`. `[]` = root. */
function appFolderRef(folderPath: string[]): string {
  let p = "Contents('Applications')";
  for (const seg of folderPath) { p += `/Contents('${encodeURIComponent(q(seg))}')`; }
  return p;
}

/**
 * Rename / move / (un)publish an application entry via the bound `tm1.Move` action.
 * See the header note: PATCH/PUT are unsupported; `tm1.Move` is the only path.
 * `folderPath`/`id` address the entry in its CURRENT container.
 */
export async function moveApplication(
  folderPath: string[],
  id: string,
  isPrivate: boolean,
  opts: MoveOpts,
  config: Tm1Config,
): Promise<void> {
  const container = isPrivate ? 'PrivateContents' : 'Contents';
  const payload: Record<string, unknown> = {};
  if (opts.name !== undefined) { payload.Name = opts.name; }
  if (opts.targetFolderPath !== undefined) { payload['Target@odata.bind'] = appFolderRef(opts.targetFolderPath); }
  if (opts.makePrivate !== undefined) { payload.Private = opts.makePrivate; }
  const res = await apiRequest(
    'POST',
    `${appContentsPath(folderPath, container, id)}/tm1.Move`,
    JSON.stringify(payload),
    undefined,
    config,
    JSON_HEADERS,
  );
  if (res.statusCode !== 200 && res.statusCode !== 201 && res.statusCode !== 204) {
    throw new Tm1HttpError(`Move failed (HTTP ${res.statusCode}): ${res.body.slice(0, 200)}`, res.statusCode);
  }
}

/** Delete an application entry by id from the given folder's container. */
export async function deleteApplication(folderPath: string[], id: string, isPrivate: boolean, config: Tm1Config): Promise<void> {
  const container = isPrivate ? 'PrivateContents' : 'Contents';
  const res = await apiRequest('DELETE', appContentsPath(folderPath, container, id), undefined, undefined, config);
  if (res.statusCode !== 204 && res.statusCode !== 200) {
    throw new Tm1HttpError(`Delete failed (HTTP ${res.statusCode})`, res.statusCode);
  }
}

/** Download a DocumentReference's blob content. */
export async function getDocumentContent(
  folderPath: string[],
  id: string,
  isPrivate: boolean,
  config: Tm1Config,
): Promise<Buffer> {
  const container = isPrivate ? 'PrivateContents' : 'Contents';
  const path = `${appContentsPath(folderPath, container, id)}/Document/Content`;
  const res = await apiRequestBinary('GET', path, undefined, config);
  if (!isOk(res)) {
    throw new Tm1HttpError(`Load document failed (HTTP ${res.statusCode})`, res.statusCode);
  }
  return res.body;
}
