/** Pure URL builder for the Area/DB Builder element page fetch. No vscode/IO. */
import { escapeODataKey, encodeODataKey } from '../utils/odataKey';

/** OData key: ' → '' then percent-encode. */
function encKey(s: string): string { return encodeODataKey(s); }
/**
 * OData string literal: ' → '', then percent-encoded — `&`, `#`, `%` in the
 * search text would otherwise cut the query string apart (`R&D`).
 */
function escLit(s: string): string { return encodeURIComponent(escapeODataKey(s)); }

/**
 * Build the Elements page path. Default hierarchy = dim name. Fetches
 * `pageSize + 1` rows so the caller can detect `hasMore`.
 */
export function buildElementsPagePath(dim: string, query: string, skip: number, pageSize: number): string {
  const d = encKey(dim);
  const q = query.trim();
  const filter = q ? `&$filter=contains(tolower(Name),'${escLit(q.toLowerCase())}')` : '';
  return `Dimensions('${d}')/Hierarchies('${d}')/Elements?$select=Name,Attributes&$top=${pageSize + 1}&$skip=${skip}${filter}`;
}
