/**
 * Readable sentence for a network error — the localized counterpart of
 * `networkErrorPure`.
 *
 * Its own module because two very different callers need the same sentence
 * and neither may import the other: the admin-server test in the server
 * dialog (`serverConfig/addServerPanel.ts`) and the error node in the tree
 * (`providers/tm1TreeDataProvider.ts`). The instance path has its own, more
 * detailed sentence in `connection.ts#_connectErrorMessage` — there a
 * `Tm1Config` is at hand, here only a URL.
 */
import * as vscode from 'vscode';
import { classifyNetworkError, hostOf } from './networkErrorPure';
import { errMsg } from './errMsg';
import { isPlainHttpUrl } from './serverUrl';

/**
 * Interprets the cases you actually run into during setup, and leaves
 * everything else in the raw text — a wrong interpretation is worse than
 * none at all.
 */
export function describeNetworkError(err: unknown, url: string): string {
  const host = hostOf(url);
  switch (classifyNetworkError(err)) {
    case 'scheme':
      if (isPlainHttpUrl(url)) {
        return vscode.l10n.t(
          'No plain HTTP on "{0}" — that port expects HTTPS. Change the server URL to https:// and try again.',
          host);
      }
      return vscode.l10n.t(
        'No HTTPS on "{0}" — that port answers in plain HTTP. Change the server URL to http:// and try again.',
        host);
    case 'dns':
      return vscode.l10n.t('Hostname "{0}" could not be resolved. Check the server URL.', host);
    case 'refused':
      return vscode.l10n.t('Connection to "{0}" refused. Is the service running and is the port correct?', host);
    case 'timeout':
      return vscode.l10n.t('Timeout connecting to "{0}". Check network and firewall.', host);
    case 'tls':
      return vscode.l10n.t(
        'TLS certificate for "{0}" cannot be verified. Turn off "Verify SSL certificate" for this entry to accept it anyway.',
        host);
    default:
      return errMsg(err);
  }
}
