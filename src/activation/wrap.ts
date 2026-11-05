import * as vscode from 'vscode';
import { errMsg } from '../utils/errMsg';

/**
 * Wrap a command handler so that any thrown error surfaces as a TM1 error
 * notification instead of an unhandled rejection.
 */
export function wrap<A extends any[]>(label: string, fn: (...args: A) => Promise<void> | void) {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (err) {
      const msg = errMsg(err);
      vscode.window.showErrorMessage(vscode.l10n.t('TM1 {0} error: {1}', label, msg));
    }
  };
}
