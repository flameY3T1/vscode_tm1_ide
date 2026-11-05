// The search branch shared by Bulk Deploy and Bulk Delete: list the chosen
// kinds, apply the name pattern and the control-object switch, answer with the
// request's generation. Both pages carried it line for line (review 2026-10-03, B8).
import type { Tm1Config } from '../tm1Rest/transport/types';
import { errMsg } from '../utils/errMsg';
import { listObjectRows, type ListKind, type ObjectRow } from '../tm1Rest/objectListingApi';
import { matchesPattern } from './bulkObjectsPure';

export interface BulkSearchRequest<K extends ListKind> {
  kinds: K[];
  pattern: string;
  includeControl: boolean;
  gen: number;
}

export type BulkSearchReply<K extends ListKind> =
  | { type: 'busy'; on: boolean; label?: string; gen: number }
  | { type: 'rows'; rows: ObjectRow<K>[]; failedKinds: K[]; gen: number }
  | { type: 'error'; message: string; gen: number };

/**
 * The host serializes nothing: two searches may answer in reverse order, and
 * the renderer uses `gen` to tell which answer still belongs to its table.
 */
export async function handleBulkSearch<K extends ListKind>(
  cfg: Tm1Config, msg: BulkSearchRequest<K>, loadingLabel: string,
  post: (out: BulkSearchReply<K>) => void,
): Promise<void> {
  const { gen } = msg;
  post({ type: 'busy', on: true, label: loadingLabel, gen });
  try {
    const { rows, failed } = await listObjectRows(cfg, msg.kinds);
    // Pattern and control-object switch already here: what falls through does
    // not have to travel through the message into the renderer first.
    const shown = rows.filter(r =>
      (msg.includeControl || !r.isControl) && matchesPattern(r.name, msg.pattern));
    post({ type: 'rows', rows: shown, failedKinds: failed, gen });
  } catch (err) {
    post({ type: 'error', message: errMsg(err), gen });
  } finally {
    post({ type: 'busy', on: false, gen });
  }
}
