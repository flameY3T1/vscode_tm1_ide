// src/webviewClient/tm1Top/protocol.ts
//
// Messages between the TM1 Top window and its host (commands/tm1Top.ts).

/** One native Top row (subset of tm1top/tm1TopPure#Tm1TopRow, restated so the bundle stays leaf). */
export interface Tm1TopRowView {
  threadId: string;
  session: string;
  principal: string;
  context: string;
  state: string;
  details: string[];
  elapsed: string;
  stateClass: string;
}

export type WebviewToHost =
  | { command: 'refresh' }
  | { command: 'locate' }
  | { command: 'pause'; paused: boolean }
  | { command: 'invalidate' }
  | { command: 'verify'; username: string; password: string }
  | { command: 'kill'; threadId: string };

/** Each field optional: the host posts only what changed. */
export interface HostToWebview {
  rows?: Tm1TopRowView[];
  error?: string;
  locate?: boolean;
  verified?: boolean;
  busy?: boolean;
}

/** window.prefill + window.labels, set by the host through the shell's globals. */
export interface Tm1TopBootstrap {
  prefill: { user: string; saved: boolean };
  labels: {
    refresh: string; locate: string; pause: string; user: string; password: string; verify: string;
    kill: string; verified: string; unverified: string; empty: string; columns: string[];
  };
}
