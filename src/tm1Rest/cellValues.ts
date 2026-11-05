// src/tm1Rest/cellValues.ts
//
// Read cell values via MDX, in ONE call: `POST ExecuteMDX` with
// `$expand=Cells`. That still creates a cellset on the server, which lives
// until the end of the session without a `DELETE` — so this helper always
// deletes it right away (follow-up review 2026-09-23 F5; `defaultMemberApi`
// never deleted it before).
//
// For axes, pages or formatting: `mdx/executeMdx.ts`.
import { apiRequest } from './client';
import type { Tm1Config } from './transport/types';
import { parseBody } from './parseRest';
import { isOk } from './httpError';
import { logRestBestEffort } from './bestEffort';

export interface CellValue { Ordinal: number; Value: unknown }

export type CellValuesResult =
  | { ok: true; cells: CellValue[] }
  | { ok: false; statusCode: number; body: string };

export async function readCellValues(cfg: Tm1Config, mdx: string, timeoutMs = 60000): Promise<CellValuesResult> {
  const res = await apiRequest('POST', 'ExecuteMDX?$expand=Cells($select=Ordinal,Value)',
    JSON.stringify({ MDX: mdx }), timeoutMs, cfg);
  if (!isOk(res)) {
    return { ok: false, statusCode: res.statusCode, body: res.body };
  }
  const body = parseBody<{ ID?: string; Cells?: CellValue[] }>(res);
  if (body.ID) {
    await apiRequest('DELETE', `Cellsets('${encodeURIComponent(body.ID)}')`, undefined, 10000, cfg).catch((e: unknown) => logRestBestEffort('cellValues', 'delete cellset', e));
  }
  return { ok: true, cells: body.Cells ?? [] };
}
