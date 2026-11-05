import * as vscode from 'vscode';
import { PawGatewayError } from '../tm1Rest/pawGatewayUrl';
import { describeNetworkError } from './networkErrorText';
import { isSaasHost } from './serverUrl';

/** Shared by the probe and tree: authentication is not a reachability failure. */
export function describePawError(error: unknown, url: string): string {
  if (error instanceof PawGatewayError) {
    switch (error.code) {
      case 'url': return vscode.l10n.t('Enter the PAW gateway root URL using HTTP or HTTPS, without a path, query, fragment or embedded credentials.');
      case 'response': return vscode.l10n.t('PAW returned an invalid or incomplete instance list.');
      case 'timeout': return vscode.l10n.t('The PAW discovery request timed out. Check the gateway and network.');
      case 'tenant': return vscode.l10n.t('PA as a Service lists v12 databases here. Enter the tenant ID of the gateway entry.');
      // No special case for 401/403 anymore: the list is fetched anonymously
      // (`/tm1/Servers`), a login hint would point in the wrong direction —
      // in that case, the gateway configuration is what's wrong.
      case 'http':
        if (error.statusCode === 401 && isSaasHost(url)) {
          return vscode.l10n.t('PA as a Service lists its databases only after a browser login. Open the entry and click "Test connection".');
        }
        return vscode.l10n.t('PAW discovery failed with HTTP {0}. Check the gateway URL and configuration.', error.statusCode ?? 0);
    }
  }
  return describeNetworkError(error, url);
}
