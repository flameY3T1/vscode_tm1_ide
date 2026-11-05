import { apiRequest, apiRequestBinary } from './client';
import type { Tm1Config } from './transport/types';
import { parseEnvelopeBody } from './parseRest';
import { escapeODataKey } from '../utils/odataKey';

export interface Tm1File {
  Name: string;
  Size?: number;
  LastUpdated?: string;
  /** Folder instead of file — occurs only on v12 (`Files` has subfolders). */
  isFolder?: boolean;
}

function q(s: string): string { return escapeODataKey(s); }

/**
 * The file space depends on the version (measured 2026-09-22):
 *  - v11: `Contents('Blobs')`, flat. `Files` does not exist (404).
 *  - v12: `Contents('Files')`, with folders. `Blobs` does answer there, but
 *    is only an alias for the internal folder `Files/.blobs`.
 * `folder` is the folder names below the root.
 */
export function folderPath(config: Pick<Tm1Config, 'version'>, folder: readonly string[]): string {
  const root = config.version === 'v12' ? 'Files' : 'Blobs';
  return [`Contents('${root}')`, ...folder.map(seg => `Contents('${encodeURIComponent(q(seg))}')`)].join('/');
}
function entryPath(config: Tm1Config, folder: readonly string[], name: string, suffix = ''): string {
  return `${folderPath(config, folder)}/Contents('${encodeURIComponent(q(name))}')${suffix}`;
}

function assertSuccess(statusCode: number, body: string | Buffer, op: string): void {
  if (statusCode >= 200 && statusCode < 300) { return; }
  const detail = typeof body === 'string'
    ? body.slice(0, 300)
    : (body ? body.toString('utf8').slice(0, 300) : '');
  throw new Error(`${op} failed (HTTP ${statusCode})${detail ? `: ${detail}` : ''}`);
}

export async function listFiles(config: Tm1Config, folder: readonly string[] = []): Promise<Tm1File[]> {
  // No $select — Size is on the Document subtype and can't be selected on
  // the polymorphic Entry collection.
  const res = await apiRequest('GET', `${folderPath(config, folder)}/Contents`, undefined, undefined, config);
  assertSuccess(res.statusCode, res.body, 'Load files');
  interface BlobEntry {
    '@odata.type'?: string;
    Name?: string;
    ID?: string;
    Size?: number;
    LastUpdated?: string;
  }
  return parseEnvelopeBody<BlobEntry>(res)
    .filter((e) => e?.['@odata.type'] === '#ibm.tm1.api.v1.Document'
      || e?.['@odata.type'] === '#ibm.tm1.api.v1.Folder'
      || e?.Size !== undefined)
    .map((e) => ({
      Name: String(e.Name ?? e.ID ?? ''),
      Size: typeof e.Size === 'number' ? e.Size : undefined,
      LastUpdated: typeof e.LastUpdated === 'string' ? e.LastUpdated : undefined,
      ...(e['@odata.type'] === '#ibm.tm1.api.v1.Folder' ? { isFolder: true } : {}),
    }));
}

/**
 * Whether a Blobs entry is a file that someone deposited themselves — and not
 * incidental material that TM1 keeps there for its own use. Measured on 11.8
 * (2026-09-22): of 211 entries, ALL were incidental material:
 *  - `}…`: client settings, pick lists, drill.
 *  - `<Name>_<YYYYMMDDHHMMSS>.<ext>`: content of an Applications document. The
 *    entry under Applications is only a reference; deleting here leaves it empty.
 *  - `<Cube>`: rule RTF of the Architect rule editor.
 *  - `<Cube>.<View>[.<User>]`: layout of a view (XML, column widths).
 * The rule RTF and view layout of a DELETED cube no longer reveal the cube name
 * (measured: `<Cube>.<View>.<User>` remained after deletion). The extension
 * makes up for that: a deposited file has a short one (`.csv`, `.xlsx`), a
 * layout ends in a view or user name.
 * ponytail: a view with a short name (`X.Test`) belonging to a deleted cube
 * still stays visible, and likewise a file without an extension is missed —
 * content inspection (XML `<ViewProperties>`) only once that becomes a problem.
 */
export function isUserFile(name: string, cubeNamesLower: ReadonlySet<string>): boolean {
  if (name.startsWith('}')) { return false; }
  if (/_\d{14}\.[A-Za-z0-9]+$/.test(name)) { return false; }
  if (!/\.[A-Za-z0-9]{1,5}$/.test(name)) { return false; }
  const low = name.toLowerCase();
  if (cubeNamesLower.has(low)) { return false; }
  const dot = low.indexOf('.');
  return !(dot > 0 && cubeNamesLower.has(low.slice(0, dot)));
}

export async function downloadFile(name: string, config: Tm1Config, folder: readonly string[] = []): Promise<Buffer> {
  const res = await apiRequestBinary('GET', entryPath(config, folder, name, '/Content'), undefined, config);
  assertSuccess(res.statusCode, res.body, `Load file "${name}"`);
  return res.body;
}

export async function uploadFile(name: string, content: Buffer, config: Tm1Config, folder: readonly string[] = []): Promise<void> {
  const createBody = JSON.stringify({ '@odata.type': '#ibm.tm1.api.v1.Document', Name: name, ID: name });
  const created = await apiRequest('POST', `${folderPath(config, folder)}/Contents`, createBody, undefined, config);
  if (created.statusCode !== 200 && created.statusCode !== 201 && created.statusCode !== 409) {
    assertSuccess(created.statusCode, created.body, `Create file "${name}"`);
  }
  await replaceFile(name, content, config, folder);
}

export async function replaceFile(name: string, content: Buffer, config: Tm1Config, folder: readonly string[] = []): Promise<void> {
  const res = await apiRequestBinary(
    'PUT',
    entryPath(config, folder, name, '/Content'),
    content,
    config,
    { 'Content-Type': 'application/octet-stream' },
  );
  assertSuccess(res.statusCode, res.body, `Replace file "${name}"`);
}

export async function deleteFile(name: string, config: Tm1Config, folder: readonly string[] = []): Promise<void> {
  const res = await apiRequest('DELETE', entryPath(config, folder, name), undefined, undefined, config);
  assertSuccess(res.statusCode, res.body, `Delete file "${name}"`);
}
