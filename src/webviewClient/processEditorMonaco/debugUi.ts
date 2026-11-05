/**
 * Debug-state status bar UI.
 *
 * Extracted from `index.ts` in Post-H17 #5 split.
 */

import { getDebugMode, getDebugNote, getLastEndStatus } from './debug';
import { getL10n, fmt } from '../_shared/l10n';

export {};

const L = getL10n();

/** Shorten ISO timestamps in log text to just the clock time (`HH:MM:SS`). */
function prettifyDetail(text: string): string {
  return text.replace(/\[\d{4}-\d{2}-\d{2}T(\d{2}:\d{2}:\d{2})(?:\.\d+)?Z?\]/g, '$1').trim();
}

/** A finished run is an error only when its status says so — the log line is
 *  present on success too (TM1 always returns the last message entry). */
function isErrorStatus(status: string): boolean {
  return /error|abort|fail|withmessages|quit/i.test(status);
}

export function updateDebugUi(): void {
  const mode = getDebugMode();
  document.body.classList.toggle('debug-running', mode === 'running');
  document.body.classList.toggle('debug-paused', mode === 'paused');
  const status = document.getElementById('debug-status');
  const detail = document.getElementById('debug-detail');
  if (!status) { return; }

  // Reset the full-width detail line; only the ended branch fills it.
  if (detail) {
    detail.textContent = '';
    detail.classList.remove('visible', 'error');
  }

  if (mode === 'running') {
    status.textContent = L.dbgRunning;
    status.classList.remove('has-error');
  } else if (mode === 'paused') {
    status.textContent = L.dbgPaused;
    status.classList.remove('has-error');
  } else {
    const end = getLastEndStatus();
    if (end.status) {
      const isError = isErrorStatus(String(end.status));
      status.textContent = fmt(L, 'dbgEnded', String(end.status));
      status.classList.toggle('has-error', isError);
      // Detail message (server log) on its own full-width line below the
      // toolbar, with ISO timestamps trimmed to the clock time.
      if (detail && end.error) {
        detail.textContent = prettifyDetail(String(end.error));
        detail.classList.add('visible');
        detail.classList.toggle('error', isError);
      }
    } else {
      status.textContent = '';
      status.classList.remove('has-error');
    }
  }

  // A transient note (discarded action, pause without a known position) must be
  // visible — the alternative is a button press that appears to do nothing.
  const note = getDebugNote();
  if (detail && note && !detail.textContent) {
    detail.textContent = note;
    detail.classList.add('visible');
    detail.classList.remove('error');
  }
}
