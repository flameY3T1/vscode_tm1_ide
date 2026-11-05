// src/webviewClient/transactionLog/protocol.ts
// Messages between the transaction log window and the host (`commands/transactionLog.ts`).

/** One row, as the host delivers it from `TransactionLogEntries`. */
export interface TxRow {
  TimeStamp?: string;
  User?: string;
  Cube?: string;
  Tuple?: string[];
  OldValue?: string | number | null;
  NewValue?: string | number | null;
  StatusMessage?: string | null;
}

/** What goes to the host when rolling back — congruent with `UndoEntry`. */
export type TxUndoEntry = Pick<TxRow, 'TimeStamp' | 'Cube' | 'Tuple' | 'OldValue' | 'NewValue'>;

export type WebviewToHost =
  | {
      type: 'load'; fromLocal?: string; toLocal?: string; hours?: number; top: number;
      cube: string; user: string; element: string; includeControl: boolean; seq?: number;
    }
  | { type: 'openCell'; cube: string; tuple: string[] }
  | { type: 'undo'; entries: TxUndoEntry[] };

export interface HostToWebview {
  seq?: number;
  entries?: TxRow[];
  total?: number;
  fromLocal?: string;
  toLocal?: string;
  error?: string;
  undoDone?: boolean;
  reload?: boolean;
}

/** `window.__tx`: texts and threshold from the host, so that the window has no second source. */
export interface TxBootstrap {
  texts: {
    empty: string; loading: string; undo: string; shown: string; inWindow: string;
    truncated: string; load: string; wideSpan: string;
  };
  warnSpanHours: number;
}
