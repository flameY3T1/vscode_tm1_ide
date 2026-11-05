import { apiRequest } from './client';
import { parseBody, odataErrorMessage } from './parseRest';
import type { ODataError } from './odataTypes';
import type { Tm1Config } from './transport/types';
import { encodeODataKey } from '../utils/odataKey';
import {
  buildTupleBind, TRACE_ONE_LEVEL_QUERY, mapCalcNode, mapFeederTrace, mapFedCell,
  type CalcNode, type FeederTraceResult, type FedCell,
} from './cellTraceTypes';
import { isOk, Tm1HttpError } from './httpError';

export class TraceHttpError extends Tm1HttpError {
  constructor(statusCode: number, message: string) {
    super(message, statusCode);
    this.name = 'TraceHttpError';
  }
}

function extractError(body: string, statusCode: number): string {
  try {
    const msg = odataErrorMessage(JSON.parse(body) as ODataError);
    if (msg) { return msg; }
  } catch { /* fall through */ }
  return `HTTP ${statusCode}`;
}

async function post(cube: string, action: string, query: string, dims: string[], coords: string[], config: Tm1Config) {
  const path = `Cubes('${encodeODataKey(cube)}')/tm1.${action}?${query}`;
  const body = JSON.stringify({ 'Tuple@odata.bind': buildTupleBind(dims, coords) });
  const res = await apiRequest('POST', path, body, 0, config);
  if (!isOk(res)) {
    throw new TraceHttpError(res.statusCode, extractError(res.body, res.statusCode));
  }
  return res;
}

/**
 * The cell and its direct children only — see `TRACE_ONE_LEVEL_QUERY`. Deeper
 * levels are fetched one call per expanded node; the full tree of a high
 * consolidation was 144 MB in one answer.
 */
export async function traceRule(cube: string, dims: string[], coords: string[], config: Tm1Config): Promise<CalcNode> {
  const res = await post(cube, 'TraceCellCalculation', TRACE_ONE_LEVEL_QUERY, dims, coords, config);
  return mapCalcNode(parseBody<unknown>(res));
}

export async function traceFeeders(cube: string, dims: string[], coords: string[], config: Tm1Config): Promise<FeederTraceResult> {
  const res = await post(cube, 'TraceFeeders', '$expand=FedCells/Tuple($select=Name)', dims, coords, config);
  return mapFeederTrace(parseBody<unknown>(res));
}

export async function checkFeeders(cube: string, dims: string[], coords: string[], config: Tm1Config): Promise<FedCell[]> {
  const res = await post(cube, 'CheckFeeders', '$expand=Tuple($select=Name)', dims, coords, config);
  const parsed = parseBody<{ value?: unknown[] }>(res);
  return Array.isArray(parsed.value) ? parsed.value.map(mapFedCell) : [];
}
