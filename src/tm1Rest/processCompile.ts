import { apiRequest } from './client';
import type { Tm1Config } from './transport/types';
import { encodeODataKey } from '../utils/odataKey';
import { isOk, Tm1HttpError } from './httpError';
import { parseBodySafe } from './parseRest';

export interface ProcessSyntaxError {
  Procedure: 'Prolog' | 'Metadata' | 'Data' | 'Epilog';
  LineNumber: number;
  Message: string;
}

/**
 * Calls TM1 REST `tm1.Compile` to validate the current server-side state of a process.
 * Returns the list of syntax errors (empty array on success).
 */
export async function compileProcess(processName: string, config: Tm1Config): Promise<ProcessSyntaxError[]> {
  const path = `Processes('${encodeODataKey(processName)}')/tm1.Compile`;
  const res = await apiRequest('POST', path, '{}', undefined, config);
  if (!isOk(res)) {
    throw new Tm1HttpError(`Compile failed (HTTP ${res.statusCode}): ${res.body}`, res.statusCode);
  }
  // An answer without the error list is no answer: throw, so the save reports
  // the code as unvalidated instead of clean.
  const json = parseBodySafe<{ value?: unknown } | null>(res, null);
  if (!json || !Array.isArray(json.value)) {
    throw new Error(`Compile answer could not be read (HTTP ${res.statusCode})`);
  }
  return json.value as ProcessSyntaxError[];
}
