import { apiRequest } from './client';
import type { Tm1Config } from './transport/types';
import { encodeODataKey } from '../utils/odataKey';
import { isOk, Tm1HttpError } from './httpError';

export interface RuleSyntaxError {
  LineNumber: number;
  Message: string;
}

/**
 * Pre-validates the given rules text against a cube using TM1 REST `tm1.CheckRules`.
 * Unlike `tm1.Compile` for processes, this action accepts the new rules as payload
 * — no deploy-then-revert needed.
 */
export async function checkRules(cubeName: string, rulesText: string, config: Tm1Config): Promise<RuleSyntaxError[]> {
  const path = `Cubes('${encodeODataKey(cubeName)}')/tm1.CheckRules`;
  const body = JSON.stringify({ Rules: rulesText });
  const res = await apiRequest('POST', path, body, undefined, config);
  if (!isOk(res)) {
    throw new Tm1HttpError(`CheckRules failed (HTTP ${res.statusCode}): ${res.body}`, res.statusCode);
  }
  try {
    const json = JSON.parse(res.body);
    return Array.isArray(json.value) ? (json.value as RuleSyntaxError[]) : [];
  } catch {
    return [];
  }
}
