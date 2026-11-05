import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import { ObjectNotFoundError } from './processFetcher';
import { encodeODataKey } from '../utils/odataKey';
import { isOk, Tm1HttpError } from '../tm1Rest/httpError';
import { parseBody } from '../tm1Rest/parseRest';

export async function fetchRulesText(cubeName: string, config: Tm1Config): Promise<string> {
  const path = `Cubes('${encodeODataKey(cubeName)}')/Rules`;
  const res = await apiRequest('GET', path, undefined, undefined, config);
  if (res.statusCode === 404) { throw new ObjectNotFoundError(cubeName); }
  if (!isOk(res)) {
    throw new Tm1HttpError(`HTTP ${res.statusCode}: ${res.body}`, res.statusCode);
  }
  if (!res.body) { return ''; }
  try {
    const json = parseBody<{ value?: unknown; Rules?: unknown }>(res);
    if (typeof json.value === 'string') { return json.value; }
    if (typeof json.Rules === 'string') { return json.Rules; }
    if (typeof json === 'string') { return json; }
    return '';
  } catch {
    return res.body;
  }
}

export async function pushRulesText(cubeName: string, rulesText: string, config: Tm1Config): Promise<void> {
  const path = `Cubes('${encodeODataKey(cubeName)}')`;
  const body = JSON.stringify({ Rules: rulesText });
  const res = await apiRequest('PATCH', path, body, undefined, config);
  if (res.statusCode === 404) { throw new ObjectNotFoundError(cubeName); }
  if (!isOk(res)) {
    throw new Tm1HttpError(`HTTP ${res.statusCode}: ${res.body}`, res.statusCode);
  }
}
