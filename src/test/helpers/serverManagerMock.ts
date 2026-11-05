// Stub of the `serverManager` facade for tests that only need `getServerConfig`
// — but now also the guards that build on it.
//
// Without the guards, every test that runs a command with
// `requireServerConfig` fails with "No export is defined on the mock". Rebuilding them
// here ONCE is better than copying them into every test file: the
// rebuilds would otherwise drift apart, and the tests would then check a
// version that does not exist in the product.
import { vi } from 'vitest';

/**
 * @param extra Further exports that the respective test file needs
 *              (`getConnectedIds`, `getServerNameByUrl`, …).
 */
export async function serverManagerMock(
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const vscode = await import('vscode');
  const getServerConfig = vi.fn();

  // Word for word the same as `serverState/requireServerConfig.ts`. The real
  // version is tested on its own there; here all that counts is that the two
  // exits (report + undefined / throw) stay the same.
  const fehlertext = (serverId: string | undefined): string =>
    serverId
      ? 'TM1: No server connected.'
      : 'TM1: This entry carries no server reference — refresh the Explorer and try again.';

  return {
    getServerConfig,
    serverConfigError: fehlertext,
    requireServerConfig: (serverId?: string) => {
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!cfg) { vscode.window.showErrorMessage(fehlertext(serverId)); }
      return cfg;
    },
    requireServerConfigOrThrow: (serverId?: string) => {
      const cfg = serverId ? getServerConfig(serverId) : undefined;
      if (!cfg) { throw new Error(fehlertext(serverId)); }
      return cfg;
    },
    ...extra,
  };
}
