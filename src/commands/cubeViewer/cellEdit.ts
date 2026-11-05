import { updateCells } from '../../tm1Client';
import { describeNetworkError } from '../../utils/networkErrorText';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { classifyWriteError, type WriteError } from '../../cubeViewer/cellWrite';
import { describePicklistRejection } from './picklistWriteError';
import { isOk } from '../../tm1Rest/httpError';

export interface CellEditArgs {
  cubeName: string;
  dimensions: string[];
  coordinates: string[];
  value: number | string;
  ri: number;
  ci: number;
  config: Tm1Config;
  /** Raw picklist definition for this cell (`pickDefinitionForCell` in the
   *  webview, the same check as the arrow) — `null`/`undefined` when the cell
   *  does not carry one. Feeds into `classifyWriteError` to interpret TM1's
   *  uninformative 285 error as a picklist violation, and into
   *  `describePicklistRejection` to include the allowed values in the
   *  message. Both the single-edit path and the bulk path (`cellEditBulk`,
   *  Ctrl+V and Delete via `bulkWrite.ts`) pass this through PER TARGET — a
   *  delete has no value that could be checked against the list up front, so
   *  the message must still take effect there. */
  picklistDef?: string | null;
}

export type CellEditResult =
  | { ok: true;  ri: number; ci: number }
  | { ok: false; ri: number; ci: number; error: WriteError };

/** Server-side endpoint for the cellEdit message handler. Exported for unit tests;
 *  the panel's message routing calls this function and passes the result back. */
export async function handleCellEditMessage(a: CellEditArgs): Promise<CellEditResult> {
  try {
    const res = await updateCells(
      a.cubeName,
      [{ Dimensions: a.dimensions, Coordinates: a.coordinates, Value: a.value }],
      a.config,
    );
    if (isOk(res)) {
      return { ok: true, ri: a.ri, ci: a.ci };
    }
    let error = classifyWriteError(res.statusCode, res.body, !!a.picklistDef);
    if (error.kind === 'picklist') {
      error = await describePicklistRejection(a.config, a.picklistDef ?? null);
    }
    return { ok: false, ri: a.ri, ci: a.ci, error };
  } catch (err) {
    return {
      ok: false, ri: a.ri, ci: a.ci,
      error: { kind: 'network', message: describeNetworkError(err, a.config.serverUrl) },
    };
  }
}
