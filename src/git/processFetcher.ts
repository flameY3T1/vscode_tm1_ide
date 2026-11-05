import { apiRequest } from '../tm1Rest/client';
import type { Tm1Config } from '../tm1Rest/transport/types';
import type { TM1Process } from './serializer';
import { encodeODataKey } from '../utils/odataKey';
import { PROCESS_FULL_SELECT } from '../tm1Rest/processApi';
import { isOk, Tm1HttpError } from '../tm1Rest/httpError';
import { parseBody } from '../tm1Rest/parseRest';

export class ObjectNotFoundError extends Error {
  constructor(public readonly objectName: string) {
    super(`Object not found: ${objectName}`);
    this.name = 'ObjectNotFoundError';
  }
}

export async function fetchProcess(processName: string, config: Tm1Config, select = PROCESS_FULL_SELECT): Promise<TM1Process> {
  // Explicit field list, not the bare GET: `VariablesUIData` (the
  // ignored source columns) and `UIData` (wizard state) sit
  // outside the default projection and are otherwise missing without a word — the mirror
  // in the repo would be incomplete and a push would delete them on the server.
  // `$select=*` does not help, it truncates complex types.
  const path = `Processes('${encodeODataKey(processName)}')?$select=${select}`;
  const res = await apiRequest('GET', path, undefined, undefined, config);
  if (res.statusCode === 404) {
    throw new ObjectNotFoundError(processName);
  }
  if (!isOk(res)) {
    throw new Tm1HttpError(`HTTP ${res.statusCode}: ${res.body}`, res.statusCode);
  }
  const json = parseBody<{
    Name?: string;
    PrologProcedure?: string;
    MetadataProcedure?: string;
    DataProcedure?: string;
    EpilogProcedure?: string;
    Parameters?: TM1Process['parameters'];
    Variables?: TM1Process['variables'];
    DataSource?: TM1Process['dataSource'];
    HasSecurityAccess?: boolean;
    VariablesUIData?: TM1Process['variablesUiData'];
    UIData?: TM1Process['uiData'];
  }>(res);
  return {
    name: json.Name ?? processName,
    prolog:   json.PrologProcedure   ?? '',
    metadata: json.MetadataProcedure ?? '',
    data:     json.DataProcedure     ?? '',
    epilog:   json.EpilogProcedure   ?? '',
    parameters: json.Parameters ?? [],
    variables:  json.Variables  ?? [],
    dataSource: json.DataSource ?? { Type: 'None' },
    hasSecurity: json.HasSecurityAccess ?? false,
    // No `?? []`: TM1 12 leaves the list out for some processes, and an
    // invented empty one would land in the header (see `TM1Process`).
    variablesUiData: json.VariablesUIData,
    uiData: json.UIData,
    v12: config.version === 'v12',
  };
}
