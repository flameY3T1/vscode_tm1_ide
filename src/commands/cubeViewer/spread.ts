import { describeNetworkError } from '../../utils/networkErrorText';
import type { Tm1Config } from '../../tm1Rest/transport/types';
import { classifyWriteError, type WriteError } from '../../cubeViewer/cellWrite';
import { spreadCell } from '../../cubeViewer/cubeSpreadApi';
import type { SpreadMethod } from '../../cubeViewer/spreadMethods';
import { isOk } from '../../tm1Rest/httpError';

export interface SpreadArgs {
  cubeName: string;
  dimensions: string[];
  coordinates: string[];
  method: SpreadMethod;
  value: number;
  ri: number;
  ci: number;
  config: Tm1Config;
}

export type SpreadResult =
  | { ok: true;  ri: number; ci: number }
  | { ok: false; ri: number; ci: number; error: WriteError };

/** Server-side handler for the `spread` webview message. Thin wrapper around
 *  `spreadCell` + `classifyWriteError`. The dispatcher calls this and — on
 *  success — triggers a full `_executeView` refresh separately. */
export async function handleSpreadMessage(a: SpreadArgs): Promise<SpreadResult> {
  try {
    const res = await spreadCell(a.cubeName, a.method, a.dimensions, a.coordinates, a.value, a.config);
    if (isOk(res)) {
      return { ok: true, ri: a.ri, ci: a.ci };
    }
    return { ok: false, ri: a.ri, ci: a.ci, error: classifyWriteError(res.statusCode, res.body) };
  } catch (err) {
    return {
      ok: false, ri: a.ri, ci: a.ci,
      error: { kind: 'network', message: describeNetworkError(err, a.config.serverUrl) },
    };
  }
}
