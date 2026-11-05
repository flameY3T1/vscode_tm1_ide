import { apiRequest } from './client';
import { parseBodySafe } from './parseRest';
import type { Tm1Config } from './transport/types';
import { isOk } from './httpError';

export interface MessageLogEntry {
  timestamp: string;
  level: string;
  message: string;
}

interface RawLogEntry {
  TimeStamp?: string;
  Timestamp?: string;
  Message?: string;
  Text?: string;
  Level?: string;
}

/**
 * GET /MessageLogEntries — fetches entries since `since` whose Message contains
 * the (lowercased) process name. Returns chronologically ordered.
 * Returns [] on non-2xx.
 */
export async function fetchProcessMessageLog(
  processName: string,
  since: Date,
  top = 200,
  config: Tm1Config,
): Promise<MessageLogEntry[]> {
  const res = await apiRequest(
    'GET',
    `MessageLogEntries?$orderby=TimeStamp desc&$top=${top}`,
    undefined,
    10000,
    config,
  );
  if (!isOk(res)) { return []; }
  const parsed = parseBodySafe<{ value?: RawLogEntry[] }>(res, {});
  const entries: RawLogEntry[] = parsed.value ?? [];
  const sinceMs = since.getTime();
  const nameLower = processName.toLowerCase();
  return entries
    .filter(e => {
      const ts = e.TimeStamp ?? e.Timestamp ?? '';
      const entryMs = ts ? new Date(ts).getTime() : 0;
      const msg = (e.Message ?? e.Text ?? '').toLowerCase();
      return entryMs >= sinceMs && msg.includes(nameLower);
    })
    .reverse()
    .map(e => ({
      timestamp: e.TimeStamp ?? e.Timestamp ?? '',
      level: (e.Level ?? '').toUpperCase(),
      message: e.Message ?? e.Text ?? '',
    }));
}
